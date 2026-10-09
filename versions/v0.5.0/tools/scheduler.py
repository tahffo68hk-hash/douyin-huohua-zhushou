#!/usr/bin/env python3
"""本地浏览器 Profile 调度器。负责启动浏览器，不采集 Cookies 或绕过登录检查。"""
from __future__ import annotations
import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse
from callback_server import CallbackServer

ROOT=Path(__file__).resolve().parent
CONFIG=ROOT/'config.json'
BROWSERS={'chrome','edge','firefox','firefox-esr','centbrowser'}
PLAT=sys.platform

def log(message:str):
    line=f'[{dt.datetime.now():%Y-%m-%d %H:%M:%S}] {message}'
    print(line,flush=True)
    out=ROOT/'logs';out.mkdir(exist_ok=True)
    with (out/f'scheduler_{dt.date.today():%Y%m%d}.log').open('a',encoding='utf-8') as fh: fh.write(line+'\n')

def load_config(path=CONFIG):
    if not Path(path).exists():
        raise FileNotFoundError(f'找不到配置文件：{path}。请复制 config.example.json 为 config.json 后填写')
    cfg=json.loads(Path(path).read_text(encoding='utf-8-sig'))
    if not isinstance(cfg.get('accounts'),list): raise ValueError('accounts 应为数组')
    url=cfg.get('target_url','')
    target=urlparse(url)
    if target.scheme!='https' or target.netloc!='www.douyin.com' or not target.path.startswith('/chat'):
        raise ValueError('target_url 必须是 https://www.douyin.com/chat 页面')
    accounts=cfg['accounts']
    names=[a['name'] for a in accounts]
    if len(set(names))!=len(names):raise ValueError('账号名称不可重复')
    for a in accounts:
        if a.get('browser',cfg.get('default_browser','chrome')) not in BROWSERS:raise ValueError('未知浏览器类型')
        try:dt.time.fromisoformat(a.get('send_time',cfg.get('send_time','20:30')))
        except ValueError:raise ValueError(f"账号 {a.get('name')} 的发送时间无效")
        token=a.get('callback_token','')
        if not isinstance(token,str) or len(token)<16 or '请替换' in token:raise ValueError(f"账号 {a.get('name')} 缺少有效回调鉴权令牌")
    return cfg

def resolve_profile(profile):
    target=Path(os.path.expandvars(os.path.expanduser(profile)))
    if not target.is_absolute():target=ROOT/target
    target=target.resolve()
    if target==ROOT or target==Path.home():raise ValueError('Profile 路径不可设为工作目录或用户主目录')
    target.mkdir(parents=True,exist_ok=True)
    return target

def browser_executable(name,custom):
    if custom:
        p=Path(os.path.expandvars(os.path.expanduser(custom)))
        if p.exists():return str(p)
        f=shutil.which(custom)
        if f:return f
        raise FileNotFoundError(f'自定义浏览器路径无效：{custom}')
    choices={
        'chrome':['google-chrome','google-chrome-stable','chromium','chrome'],
        'edge':['microsoft-edge','microsoft-edge-stable','msedge'],
        'firefox':['firefox'],
        'firefox-esr':['firefox-esr','firefox'],
        'centbrowser':['centbrowser']
    }
    for name1 in choices.get(name,[]):
        path=shutil.which(name1)
        if path:return path
    if PLAT=='win32':
        pf=os.environ.get('PROGRAMFILES','C:/Program Files')
        pfx=os.environ.get('PROGRAMFILES(X86)','C:/Program Files (x86)')
        lad=os.environ.get('LOCALAPPDATA','')
        paths={
            'chrome':[f'{pf}/Google/Chrome/Application/chrome.exe',f'{lad}/Google/Chrome/Application/chrome.exe'],
            'edge':[f'{pf}/Microsoft/Edge/Application/msedge.exe',f'{pfx}/Microsoft/Edge/Application/msedge.exe'],
            'firefox':[f'{pf}/Mozilla Firefox/firefox.exe'],
            'firefox-esr':[f'{pf}/Mozilla Firefox ESR/firefox.exe'],
            'centbrowser':[f'{pf}/CentBrowser/Application/chrome.exe',f'{pfx}/CentBrowser/Application/chrome.exe']
        }
        for x in paths.get(name,[]):
            if Path(x).exists():return x
    if PLAT=='darwin':
        paths={'chrome':'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
               'edge':'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
               'firefox':'/Applications/Firefox.app/Contents/MacOS/firefox'}
        if name in paths and Path(paths[name]).exists():return paths[name]
    raise FileNotFoundError(f'未检测到浏览器 {name}，请在 config.json 的 browser_paths 填写可执行文件路径')

def launch_account(account,cfg):
    name=account.get('browser',cfg.get('default_browser','chrome'))
    profile=resolve_profile(account['profile_path'])
    path=browser_executable(name,cfg.get('browser_paths',{}).get(name,''))
    url=cfg['target_url']
    if name.startswith('firefox'):
        args=[path,'-profile',str(profile),'-no-remote','-new-window',url]
    else:
        args=[path,f'--user-data-dir={profile}','--no-first-run','--new-window',url]
    log(f"启动账号 {account['name']} · {name} · {profile}")
    return subprocess.Popen(args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)

def stop_started(process):
    if not process or process.poll() is not None:return
    try:
        process.terminate()
        process.wait(timeout=8)
    except (OSError, subprocess.TimeoutExpired):
        try:process.kill()
        except OSError:pass

def run_account(a,cfg):
    timeout=int(cfg.get('timeout_seconds',300));port=int(cfg.get('callback_port',7788))
    if not 1024<=port<=65535:raise ValueError('回调端口必须处于 1024~65535')
    # 先绑定服务器再启动浏览器，防止回调竞争；finally 保证监听器和浏览器都关闭。
    server=CallbackServer(port,a['callback_token'])
    process=None
    try:
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        process=launch_account(a,cfg)
        server.event.wait(timeout)
        data=server.payload
        if data:
            log(f"{a['name']} 回调：{data.get('status')} / 确认 {data.get('sentCount',0)} / 未知 {data.get('unknownCount',0)} / 失败 {data.get('failCount',0)}")
            return data
        log(f"账号 {a['name']} {timeout} 秒内没有完成回调；检查浏览器登录态/脚本开关/定时设置")
        return None
    finally:
        server.shutdown()
        server.server_close()
        stop_started(process)

def run_once(cfg):
    result=[]
    for a in cfg['accounts']:
        if not a.get('enabled',True):continue
        retries=0
        while True:
            data=run_account(a,cfg);result.append(data)
            if data or retries>=1:break
            retries+=1
            wait=max(1,int(cfg.get('retry_wait_minutes',25)))
            log(f"账号 {a['name']} 没有回调；{wait} 分钟后重试（仅 1 次）")
            time.sleep(wait*60)
    return all(x and x.get('status')=='success' for x in result) if result else False

def next_at(clock,now=None):
    now=now or dt.datetime.now();t=dt.time.fromisoformat(clock)
    candidate=now.replace(hour=t.hour,minute=t.minute,second=t.second,microsecond=0)
    if candidate<=now:candidate+=dt.timedelta(days=1)
    return candidate

def run_daemon(cfg):
    log('本地调度器已启动，需保持电脑开机和会话可用')
    accounts=[a for a in cfg['accounts'] if a.get('enabled',True)]
    if not accounts:raise ValueError('没有启用账号')
    executed=set()
    start=dt.datetime.now()
    # 启动时已经错过的计划，等待明天；运行期间排队的账号不会因为前一个耗时而丢失。
    for a in accounts:
        h,m=map(int,a.get('send_time',cfg.get('send_time','20:30')).split(':')[:2])
        if start.time()>=dt.time(h,m):executed.add((a['name'],start.date()))
    while True:
        now=dt.datetime.now()
        executed={x for x in executed if x[1]>=now.date()-dt.timedelta(days=1)}
        due=[];upcoming=[]
        for a in accounts:
            plan_time=dt.time.fromisoformat(a.get('send_time',cfg.get('send_time','20:30')))
            planned=dt.datetime.combine(now.date(),plan_time)
            key=(a['name'],now.date())
            if key not in executed and planned<=now:due.append((planned,a))
            elif key not in executed:upcoming.append((planned,a))
            else:upcoming.append((planned+dt.timedelta(days=1),a))
        if due:
            _,account=min(due,key=lambda x:x[0])
            executed.add((account['name'],now.date()))
            run_account(account,cfg)
            continue
        when,account=min(upcoming,key=lambda x:x[0])
        log(f"下次运行 {account['name']}：{when.isoformat(sep=' ',timespec='seconds')}")
        remaining=(when-dt.datetime.now()).total_seconds()
        time.sleep(min(max(1,remaining),60))

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('mode',nargs='?',default='once',choices=['once','daemon','check'])
    ap.add_argument('--config',type=Path,default=CONFIG)
    args=ap.parse_args()
    try:
        cfg=load_config(args.config)
        if args.mode=='check':
            for a in cfg['accounts']:
                browser=a.get('browser',cfg.get('default_browser','chrome'))
                browser_executable(browser,cfg.get('browser_paths',{}).get(browser,''))
                resolve_profile(a['profile_path'])
            log(f"配置检查通过：{len(cfg['accounts'])} 个账号");return 0
        if args.mode=='once':return 0 if run_once(cfg) else 1
        run_daemon(cfg)
        return 0
    except KeyboardInterrupt:log('收到退出命令');return 130
    except Exception as e:log(f'错误：{e}');return 2
if __name__=='__main__':sys.exit(main())
