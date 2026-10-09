"""无需外部网络/抖音账号的调度器和回调测试。"""
import importlib.util
import json
import os
import secrets
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request,urlopen
ROOT=Path(__file__).resolve().parents[1]/'tools';sys.path.insert(0,str(ROOT))
from callback_server import CallbackServer
from scheduler import next_at,load_config,resolve_profile

class TestScheduler(unittest.TestCase):
 def test_next_run_future(self):
  import datetime as dt
  now=dt.datetime(2026,10,8,23,3)
  t=next_at('22:00',now)
  self.assertEqual((t.date().isoformat(),t.hour,t.minute),('2026-10-09',22,0))
 def test_next_run_same_day(self):
  import datetime as dt
  t=next_at('23:00',dt.datetime(2026,10,8,22,50))
  self.assertEqual((t.day,t.hour),(8,23))
 def test_invalid_url_rejected(self):
  data={'target_url':'https://example.com','accounts':[]}
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'config.json';p.write_text(json.dumps(data))
   with self.assertRaises(ValueError):load_config(p)
 def test_empty_token_rejected(self):
  data={'target_url':'https://www.douyin.com/chat','accounts':[{'name':'a','callback_token':'short'}]}
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'config.json';p.write_text(json.dumps(data))
   with self.assertRaises(ValueError):load_config(p)
 def test_duplicate_account_rejected(self):
  data={'target_url':'https://www.douyin.com/chat','accounts':[{'name':'a','callback_token':'A'*32},{'name':'a','callback_token':'B'*32}]}
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/'config.json';p.write_text(json.dumps(data))
   with self.assertRaises(ValueError):load_config(p)
 def test_callback_rejects_bad_token(self):
  server=CallbackServer(0,'a'*32);port=server.server_address[1]
  th=threading.Thread(target=server.serve_forever,daemon=True);th.start()
  try:
   req=Request(f'http://127.0.0.1:{port}/done',data=json.dumps({'token':'wrong','status':'success'}).encode(),headers={'Content-Type':'application/json'},method='POST')
   with self.assertRaises(HTTPError) as ctx:urlopen(req,timeout=3)
   self.assertEqual(ctx.exception.code,403)
   self.assertIsNone(server.payload)
  finally:server.shutdown();server.server_close()
 def test_callback_accepts_valid_token(self):
  server=CallbackServer(0,'a'*32);port=server.server_address[1]
  th=threading.Thread(target=server.serve_forever,daemon=True);th.start()
  try:
   req=Request(f'http://127.0.0.1:{port}/done',data=json.dumps({'token':'a'*32,'status':'partial','sentCount':2}).encode(),headers={'Content-Type':'application/json'},method='POST')
   result=json.loads(urlopen(req,timeout=3).read());self.assertTrue(result['ok'])
   self.assertTrue(server.event.wait(.5))
   self.assertEqual(server.payload['sentCount'],2)
   self.assertNotIn('token',server.payload)
  finally:server.shutdown();server.server_close()
 def test_callback_rejects_oversize(self):
  server=CallbackServer(0,'a'*32);port=server.server_address[1]
  th=threading.Thread(target=server.serve_forever,daemon=True);th.start()
  try:
   req=Request(f'http://127.0.0.1:{port}/done',data=b'X'*13000,headers={'Content-Type':'application/json'},method='POST')
   with self.assertRaises(HTTPError) as ctx:urlopen(req,timeout=3)
   self.assertEqual(ctx.exception.code,413)
  finally:server.shutdown();server.server_close()

if __name__=='__main__':unittest.main(verbosity=2)
