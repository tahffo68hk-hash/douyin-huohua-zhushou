#!/usr/bin/env python3
"""仅监听本机的任务完成回调，要求与浏览器脚本一致的随机令牌。"""
from __future__ import annotations
import argparse
import hmac
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MAX_BYTES = 12_000

class CallbackServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True
    def __init__(self, port: int, token: str):
        super().__init__(("127.0.0.1", port), CallbackHandler)
        if not token or len(token) < 16:
            self.server_close()
            raise ValueError("回调令牌长度至少 16 字符")
        self.token = token
        self.payload = None
        self.event = threading.Event()

class CallbackHandler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != '/done':
            self.send_error(404)
            return
        try:
            length=int(self.headers.get('Content-Length','0'))
        except ValueError:
            self.send_error(400); return
        if length<=0 or length>MAX_BYTES:
            self.send_error(413); return
        try:
            obj=json.loads(self.rfile.read(length))
            if not isinstance(obj,dict): raise ValueError('object expected')
            token=obj.get('token')
            if not isinstance(token,str) or not hmac.compare_digest(token,self.server.token):
                self.send_error(403);return
            if obj.get('status') not in {'success','partial','all_failed','unknown'}:
                self.send_error(400);return
            clean={k:v for k,v in obj.items() if k!='token'}
            self.server.payload=clean
            self.server.event.set()
            self.send_response(200)
            self.send_header('Content-Type','application/json')
            self.end_headers()
            self.wfile.write(b'{"ok":true}')
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
            self.send_error(400)

def serve_once(port: int, token: str, timeout: int) -> dict | None:
    server=CallbackServer(port,token)
    try:
        th=threading.Thread(target=server.serve_forever,daemon=True)
        th.start()
        server.event.wait(timeout)
        return server.payload
    finally:
        server.shutdown()
        server.server_close()

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('port',type=int,nargs='?',default=7788)
    ap.add_argument('timeout',type=int,nargs='?',default=300)
    ap.add_argument('--token',required=True)
    args=ap.parse_args()
    try:
        result=serve_once(args.port,args.token,args.timeout)
        if result is None:print('超时：未接收到有效回调',file=sys.stderr);return 1
        print(json.dumps(result,ensure_ascii=False));return 0
    except Exception as e:
        print(f'回调服务错误: {e}',file=sys.stderr);return 2
if __name__=='__main__':sys.exit(main())
