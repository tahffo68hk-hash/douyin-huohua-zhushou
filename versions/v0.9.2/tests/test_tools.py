import importlib.util
import json
from pathlib import Path
import queue
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

ROOT=Path(__file__).parents[1]/'tools'
def load(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module
s=load('scheduler');m=load('manager')
class Tools(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.path=Path(self.tmp.name)/'config.json';self.cfg=m.init_config(self.path)
    def tearDown(self):self.tmp.cleanup()
    def test_secret_random_initialization(self):self.assertGreaterEqual(len(self.cfg['callback_token']),24)
    def test_config_load(self):self.assertEqual(s.load_config(self.path)['send_time'],'20:30')
    def test_invalid_send_clock(self):
        self.cfg['send_time']='99:99';m.save_config(self.path,self.cfg)
        with self.assertRaises(ValueError):s.load_config(self.path)
    def test_duplicate_accounts(self):
        a={'id':'test','profile_dir':'profiles/test'};self.cfg['accounts']=[a,a];m.save_config(self.path,self.cfg)
        with self.assertRaises(ValueError):s.load_config(self.path)
    def test_dry_run_does_not_launch_browser(self):
        self.cfg['accounts']=[{'id':'tester','profile_dir':'profiles/tester','browser':'not-real-chrome','enabled':True}]
        m.save_config(self.path,self.cfg)
        self.assertEqual(s.run_once(self.path,dry_run=True)[0]['status'],'DRY_RUN')
        self.assertFalse((self.path.parent/'profiles/tester').exists())
    def test_time_until_next_run(self):self.assertTrue(0<s.seconds_to_next_clock('23:59')<=86400)
    def test_authenticated_callback(self):
        events=queue.Queue();server=s.ThreadingHTTPServer(('127.0.0.1',0),s.make_handler(self.cfg['callback_token'],events))
        t=threading.Thread(target=server.serve_forever,daemon=True);t.start();url=f'http://127.0.0.1:{server.server_port}/done'
        try:
            data=json.dumps({'account':'tester','status':'DONE','confirmed':1,'failed':0,'unknown':0,'at':int(time.time()*1000)}).encode()
            request=urllib.request.Request(url,data=data,headers={'X-Spark-Token':self.cfg['callback_token'],'Content-Type':'application/json'},method='POST')
            with urllib.request.urlopen(request,timeout=4) as r:self.assertEqual(r.status,200)
            self.assertEqual(events.get(timeout=2)['account'],'tester')
        finally:server.shutdown();server.server_close()
    def test_unauthorized_callback_rejected(self):
        events=queue.Queue();server=s.ThreadingHTTPServer(('127.0.0.1',0),s.make_handler(self.cfg['callback_token'],events))
        threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            url=f'http://127.0.0.1:{server.server_port}/done'
            data=json.dumps({'account':'tester','status':'DONE','confirmed':1,'failed':0,'unknown':0,'at':int(time.time()*1000)}).encode()
            request=urllib.request.Request(url,data=data,headers={'X-Spark-Token':'wrong'},method='POST')
            with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(request,timeout=4)
            self.assertEqual(e.exception.code,403);self.assertTrue(events.empty())
        finally:server.shutdown();server.server_close()
    def test_stale_callback_rejected(self):
        events=queue.Queue();server=s.ThreadingHTTPServer(('127.0.0.1',0),s.make_handler(self.cfg['callback_token'],events));threading.Thread(target=server.serve_forever,daemon=True).start()
        try:
            url=f'http://127.0.0.1:{server.server_port}/done'
            data=json.dumps({'account':'tester','status':'DONE','confirmed':1,'failed':0,'unknown':0,'at':1}).encode()
            req=urllib.request.Request(url,data=data,headers={'X-Spark-Token':self.cfg['callback_token']},method='POST')
            with self.assertRaises(urllib.error.HTTPError) as e:urllib.request.urlopen(req,timeout=4)
            self.assertEqual(e.exception.code,400)
        finally:server.shutdown();server.server_close()
if __name__=='__main__':unittest.main(verbosity=2)
