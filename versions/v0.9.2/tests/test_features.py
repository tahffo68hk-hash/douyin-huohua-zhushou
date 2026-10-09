#!/usr/bin/env python3
"""Optional modules on a fixture, not live Douyin."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_browser import HTML
ROOT=Path(__file__).resolve().parents[1]
with sync_playwright() as p:
 b=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=b.new_page(viewport={'width':1200,'height':800})
 errors=[];dialogs=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.on('dialog',lambda d:(dialogs.append(d.message),d.dismiss()))
 page.add_init_script("""window.__gm={};window.__requests=[];
 window.GM_getValue=(k,f)=>Object.prototype.hasOwnProperty.call(__gm,k)?__gm[k]:f;
 window.GM_setValue=(k,v)=>{__gm[k]=JSON.parse(JSON.stringify(v));};
 window.GM_listValues=()=>Object.keys(__gm);
 window.GM_deleteValue=k=>delete __gm[k];
 window.GM_registerMenuCommand=()=>{}; window.GM_notification=()=>{};
 window.GM_xmlhttpRequest=args=>{__requests.push(args);args.onload?.({status:200});};""")
 page.goto('about:blank');page.set_content(HTML)
 page.add_script_tag(path=str(ROOT/'douyin-spark.user.js'))
 page.wait_for_function("document.querySelectorAll('[data-spark-name]').length===3",timeout=5000)
 page.locator('[data-spark-tab="advanced"]').click()
 page.locator('#spark-new-material').fill('文案 A 🔥')
 page.locator('#spark-add-material').click()
 page.locator('#spark-new-material').fill('文案 B ❤️')
 page.locator('#spark-add-material').click()
 assert page.locator('[data-spark-use]').count()==2
 page.locator('#spark-rotate-on').check()
 page.locator('#spark-account-id').fill('test_account')
 page.locator('#spark-account-id').dispatch_event('change')
 page.locator('#spark-callback-token').fill('a'*32)
 page.locator('#spark-callback-token').dispatch_event('change')
 page.locator('#spark-callback-on').check()
 page.locator('#spark-delay').fill('3');page.locator('#spark-delay').dispatch_event('change')
 page.locator('[data-spark-tab="today"]').click()
 page.locator('[data-spark-name="小明"]').check()
 page.locator('[data-spark-name="小雨"]').check()
 page.locator('#dy-fire-send').click()
 page.wait_for_function("window.fixture.sends.length===2",timeout=28000)
 data=page.evaluate('window.fixture')
 assert data['sends']==[{'to':'小明','text':'文案 A 🔥'},{'to':'小雨','text':'文案 B ❤️'}],data
 page.wait_for_function("window.__requests.length===1",timeout=8000)
 result=page.evaluate("({url:__requests[0].url,headers:__requests[0].headers,data:JSON.parse(__requests[0].data)})")
 assert result['url']=='http://127.0.0.1:7788/done',result
 assert result['headers']['X-Spark-Token']=='a'*32,result
 assert result['data']['account']=='test_account' and result['data']['status']=='DONE',result
 assert result['data']['confirmed']==2 and result['data']['failed']==0,result
 assert not errors, errors
 assert not dialogs, dialogs
 print('PASS: advanced presets rotate A/B and original engine sends in one click')
 print('PASS: local callback matches authenticated scheduler payload')
 print('PASS: no per-recipient dialog; JS page errors:',len(errors))
 b.close()
