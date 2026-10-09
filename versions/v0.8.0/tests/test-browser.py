"""Chromium integration on synthetic chats. NO Douyin network or real sends."""
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
import re
import time

ROOT=Path(__file__).parents[1]
SCRIPT=ROOT/'douyin-spark.user.js'
HTML=r'''<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:sans-serif;margin:0;display:flex;height:100vh;}#list{width:320px;overflow-y:auto;border-right:1px solid #ddd}
.conversationConversationItemwrapper{padding:14px;cursor:pointer;border-bottom:1px solid #eee}
.conversationConversationItemwrapper[aria-selected="true"]{background:#def}.conversationConversationItemtitle{display:flex;justify-content:space-between}
#chat{flex:1;min-width:350px;margin:24px}.compose{border:1px solid #ccc;padding:8px;margin-top:20px}
[data-slate-editor]{padding:15px;min-height:26px;border:1px solid #ccc}
.MessageItemTextcontainer{margin:12px;padding:10px;background:#dfeee7;max-width:450px}
</style></head><body><aside id="list"></aside><section id="chat">
<div class="RightPanelHeadertitleContainer"><span class="nickname" id="header-name">小雨</span></div>
<div id="messages"></div><div class="compose"><div id="editor" data-slate-editor="true" contenteditable="true">\u200B</div>
<button id="send-douyin"><svg class="e2e-send-msg-btn" width="18" height="18"><path d="M0 0L8 8" /></svg></button></div></section>
<script>
window.__fakeNames=['小雨','小林','测试群','AI分身'];
window.__msgStore={};window.__sendClicks=[];window.__dontCreateBubble=false;
window.__setNames=names=>{window.__fakeNames=names;showRows();};
function showRows(){let holder=document.querySelector('#list');holder.replaceChildren();
window.__fakeNames.forEach((n,i)=>{
 let row=document.createElement('div');row.className='conversationConversationItemwrapper';row.setAttribute('data-e2e','conversation-item');
 row.setAttribute('data-conversation-type',n==='测试群'?'group-chat':'person-chat');row.setAttribute('aria-selected',i===0?'true':'false');row.dataset.who=n;
 const title=document.createElement('div');title.className='conversationConversationItemtitle';
 const nick=document.createElement('span');nick.className='nickname';nick.textContent=n;
 const date=document.createElement('span');date.className='weekday';date.textContent='周日';title.append(nick,date);row.append(title);
 row.onclick=()=>{document.querySelectorAll('[data-e2e="conversation-item"]').forEach(el=>el.setAttribute('aria-selected','false'));
 row.setAttribute('aria-selected','true');document.querySelector('#header-name').textContent=n;
 document.querySelector('#messages').replaceChildren();for(const m of (window.__msgStore[n]||[]))renderMsg(m);
 document.querySelector('#editor').textContent='\u200B';};holder.append(row);});
}
function renderMsg(text){const m=document.createElement('div');m.className='MessageItemTextcontainer MessageItemTextisFromMe';
 const t=document.createElement('span');t.className='TextMessageTextpureText';t.textContent=text;m.append(t);document.querySelector('#messages').append(m);}
showRows();
document.querySelector('#send-douyin').addEventListener('click',()=>{
 const selected=document.querySelector('#header-name').textContent;const editor=document.querySelector('#editor');
 const text=editor.textContent.replace(/^\u200B+|\u200B+$/g,'');window.__sendClicks.push({to:selected,text});
 if(window.__dontCreateBubble)return;
 window.__msgStore[selected]??=[];window.__msgStore[selected].push(text);renderMsg(text);editor.textContent='\u200B';
});
</script></body></html>'''
HTML=HTML.replace('>\\u200B</div>', '>\u200B</div>')
BOOT="""
window.__GMStore={};
window.GM_getValue=(k,d)=>Object.prototype.hasOwnProperty.call(window.__GMStore,k)?window.__GMStore[k]:d;
window.GM_setValue=(k,v)=>{window.__GMStore[k]=structuredClone(v)};
window.GM_listValues=()=>Object.keys(window.__GMStore);
window.GM_registerMenuCommand=()=>{};
window.__callbacks=[];window.GM_xmlhttpRequest=(opts)=>window.__callbacks.push(opts);
// The about:blank synthetic fixture is an insecure origin. Emulate the Web Locks API.
Object.defineProperty(navigator,'locks',{value:{request:async (_name,_options,callback)=>await callback({name:_name})},configurable:true});
"""

checks=0
def case(label,fn):
 global checks
 fn();checks+=1;print('PASS',label,flush=True)

def make_page(browser):
 ctx=browser.new_context(viewport={'width':1366,'height':768},accept_downloads=True)
 pg=ctx.new_page()
 pg.set_default_timeout(6000)
 pg.set_content(HTML,wait_until='domcontentloaded')
 pg.evaluate(BOOT)
 pg.add_script_tag(path=str(SCRIPT))
 pg.locator('button.chip').click()
 expect(pg.locator('[data-action="scan"]')).to_be_visible()
 pg.wait_for_timeout(350)
 return ctx,pg

def send_success(browser):
 ctx,page=make_page(browser)
 try:
  assert page.locator('[data-action="select-all"]').count()==1
  page.locator('[data-action="select-all"]').click()
  assert page.locator('input[data-select-key]:checked').count()==2, 'Group + AI never selected'
  page.locator('#spark-final-draft').fill('续火🔥')
  dialogs=[];page.on('dialog',lambda dlg: (dialogs.append(dlg.type),dlg.dismiss()))
  page.locator('[data-action="batch-send"]').click()
  page.wait_for_function('window.__sendClicks.length===2',timeout=18000)
  assert page.evaluate('window.__sendClicks')==[{'to':'小雨','text':'续火🔥'},{'to':'小林','text':'续火🔥'}]
  assert dialogs==[],f'Unexpected confirm/prompt: {dialogs}'
  assert page.evaluate('window.__msgStore["小雨"][0]')=='续火🔥'
  assert page.evaluate('window.__msgStore["小林"][0]')=='续火🔥'
  page.wait_for_timeout(450)
  status=page.locator('[data-action="batch-send"]').inner_text()
  assert '一键自动发送' in status
 finally:ctx.close()

def stop_on_draft(browser):
 ctx,page=make_page(browser)
 try:
  page.locator('[data-action="select-all"]').click()
  page.evaluate("document.querySelector('#editor').textContent='我自己的草稿'")
  page.locator('[data-action="batch-send"]').click()
  page.wait_for_timeout(1700)
  assert page.evaluate('window.__sendClicks.length')==0
  assert page.evaluate("document.querySelector('#editor').textContent")=='我自己的草稿'
 finally:ctx.close()

def stop_on_unknown(browser):
 ctx,page=make_page(browser)
 try:
  page.locator('[data-action="select-all"]').click()
  page.evaluate('window.__dontCreateBubble=true')
  page.locator('[data-action="batch-send"]').click()
  page.wait_for_timeout(7300)
  clicks=page.evaluate('window.__sendClicks');assert len(clicks)==1,clicks
  assert clicks[0]['to']=='小雨'
  assert '待核对' in page.locator('.body').inner_text()
 finally:ctx.close()

def exact_name(browser):
 ctx,page=make_page(browser)
 try:
  page.evaluate("window.__setNames(['小雨','小雨','测试群'])")
  page.locator('[data-action="scan"]').click();page.wait_for_timeout(450)
  assert page.locator('input[data-select-key]:not([disabled])').count()==0
  assert page.evaluate('window.__sendClicks.length')==0
 finally:ctx.close()

def addons(browser):
 ctx,page=make_page(browser)
 try:
  page.locator('[data-action="tab"][data-value="advanced"]').click()
  page.locator('[data-action="plugin-open"]').click()
  for k in ['scheduling','retry','fireManage','history','accounts']:
   page.locator(f'[data-plugin="{k}"]').check()
  page.locator('[data-action="drawer-close"]').click()
  for text in ['每日定时执行','安全失败重试','火花天数管理','多账号调度器回调','执行记录']:
   assert text in page.locator('.body').inner_text(),text
  assert page.locator('[data-auto-toggle="enabled"]').is_checked() is False
 finally:ctx.close()

def schedule(browser):
 ctx,page=make_page(browser)
 try:
  page.locator('[data-action="select-all"]').click()
  page.locator('[data-action="tab"][data-value="advanced"]').click()
  page.locator('[data-action="plugin-open"]').click();page.locator('[data-plugin="scheduling"]').check();page.locator('[data-plugin="accounts"]').check();page.locator('[data-action="drawer-close"]').click()
  page.locator('[data-action="schedule-save-targets"]').click()
  assert '已保存 2 位' in page.locator('.toast').inner_text()
  clock=page.evaluate("new Date().toTimeString().slice(0,5)")
  page.locator('[data-auto-field="time"]').fill(clock)
  page.locator('[data-auto-field="accountId"]').fill('test_profile')
  page.locator('[data-auto-field="callbackToken"]').fill('the-test-shared-secret')
  page.locator('[data-auto-toggle="callbackEnabled"]').check()
  page.locator('[data-auto-toggle="enabled"]').check()
  page.wait_for_timeout(17400)
  assert len(page.evaluate('window.__sendClicks'))==2, page.evaluate('window.__sendClicks')
  assert page.evaluate('window.__GMStore["spark-full:v2:simple:v1:state"].automation.lastRunDay')
  callback=page.evaluate('window.__callbacks[0]')
  assert callback is not None, 'Local callback was not made'
  import json
  report=json.loads(callback['data'])
  assert report['account']=='test_profile' and report['status']=='DONE' and report['confirmed']==2, report
 finally:ctx.close()


def fire_management(browser):
 ctx,page=make_page(browser)
 try:
  page.evaluate("""() => {
    const row=document.querySelector('[data-who="小雨"]');
    const fire=document.createElement('span');fire.className='commonStreaknormalText';fire.textContent='66';row.append(fire);
  }""")
  page.locator('[data-action="tab"][data-value="advanced"]').click()
  page.locator('[data-action="plugin-open"]').click()
  page.locator('[data-plugin="fireManage"]').check()
  page.locator('[data-plugin="streak"]').check()
  page.locator('[data-action="drawer-close"]').click()
  page.locator('[data-action="tab"][data-value="today"]').click()
  page.locator('[data-action="scan"]').click()
  page.wait_for_timeout(380)
  record=page.evaluate('window.__GMStore["spark-full:v2:simple:v1:state"].fireRecords["小雨"]')
  assert record['days']==66 and record['source']=='PAGE_ROW',record
  assert '火花 66 天' in page.locator('#spark-scan-results').inner_text()
  page.locator('[data-action="tab"][data-value="advanced"]').click()
  page.locator('#spark-fire-name').fill('小林')
  page.locator('#spark-fire-days').fill('39')
  page.locator('[data-action="fire-save"]').click()
  manual=page.evaluate('window.__GMStore["spark-full:v2:simple:v1:state"].fireRecords["小林"]')
  assert manual['days']==39 and manual['source']=='MANUAL',manual
 finally:ctx.close()

if __name__=='__main__':
 import sys,subprocess
 cases=[('direct','direct click switches and sends 2 real-shape mock recipients',send_success),('draft','existing draft blocks execution',stop_on_draft),('unknown','UNKNOWN stops before second recipient',stop_on_unknown),('duplicate','duplicate name cannot be selected',exact_name),('addons','advanced plugin modules become visible',addons),('schedule','opt-in daily schedule and local callback execute once',schedule),('fire','visible and manual fire days have distinct origins',fire_management)]
 if len(sys.argv)>2 and sys.argv[1]=='--case':
  selected=[x for x in cases if x[0]==sys.argv[2]]
  assert len(selected)==1,'Unknown case'
  with sync_playwright() as p:
   browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-dev-shm-usage'])
   try:case(selected[0][1],lambda:selected[0][2](browser))
   finally:browser.close()
 else:
  for key,name,_ in cases:
   print('RUN',name,flush=True)
   result=subprocess.run([sys.executable,str(Path(__file__)), '--case',key],timeout=50)
   if result.returncode:
    raise RuntimeError(f'BROWSER FAIL {key}: exit={result.returncode}')
  print(f'BROWSER {len(cases)}/{len(cases)} PASS',flush=True)
