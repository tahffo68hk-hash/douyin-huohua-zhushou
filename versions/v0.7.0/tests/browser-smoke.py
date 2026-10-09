from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=(ROOT/'douyin-spark.user.js').read_text(encoding='utf-8')
html='''<!doctype html><html><meta charset="utf-8"><style>
body{font:14px sans-serif}.sidebar{width:290px;height:450px;overflow:auto;float:left}.conversationConversationItemwrapper{padding:15px;height:65px;border-bottom:1px solid #ddd;cursor:pointer}.conversationConversationItemtitle{display:flex}.nickname{font-weight:bold}.date{margin-left:14px}.commonIMAvataravatarContainer img{width:20px}.right{margin-left:320px}.RightPanelHeadertitleContainer{font-weight:bold;padding:20px}.editorbox{margin:10px;border:1px solid #aaa;padding:10px}.editor{min-height:60px;border:1px solid #aaa}.MessageItemTextcontainer{padding:6px;background:#e9f0ff}.messages{min-height:200px}
</style><body><div class=sidebar id=sidebar>
<div class=conversationConversationItemwrapper data-name="好友甲"><div class=commonIMAvataravatarContainer><img src="data:image/png;base64,iVBORw0KGgo="/></div><div class=conversationConversationItemtitle><span class=nickname>好友甲</span><span class=date>周日</span></div></div>
<div class=conversationConversationItemwrapper data-name="好友乙"><div class=commonIMAvataravatarContainer><img src="data:image/png;base64,iVBORw0KGgo="/></div><div class=conversationConversationItemtitle><span class=nickname>好友乙</span><span class=date>周六</span></div></div>
<div class=conversationConversationItemwrapper data-name="群聊甲"><span class=commonConversationIconnoDrag>群</span><div class=conversationConversationItemtitle><span class=nickname>群聊甲</span></div></div>
<div class=conversationConversationItemwrapper data-name="AI分身"><span class=commonIMAvataravatarContainer><img src="data:image/png;base64,iVBORw0KGgo="/></span><div class=conversationConversationItemtitle><span class=nickname>AI分身</span></div></div>
</div><div class=right><div class=RightPanelHeadertitleContainer id=head>好友甲</div><div class=messages id=messages></div><div class=editorbox><div class=editor data-slate-editor="true" contenteditable="true"></div><button id=official-send aria-label="发送">发送</button></div></div>
<script>window.__sent=[];document.querySelectorAll('[data-name]').forEach(r=>r.onclick=()=>{document.getElementById('head').textContent=r.dataset.name;document.getElementById('messages').innerHTML='';document.querySelector('.editor').textContent='';});
const dispatchSend=()=>{let editor=document.querySelector('.editor'),name=document.getElementById('head').textContent,body=editor.textContent;
if(!body || window.__failSend)return;let el=document.createElement('div');el.className='MessageItemTextcontainer MessageItemTextisFromMe';let t=document.createElement('div');t.className='TextMessageTextpureText';t.textContent=body;el.append(t);document.getElementById('messages').append(el);window.__sent.push({name,body});editor.textContent='';};
document.getElementById('official-send').onclick=dispatchSend;
</script></body></html>'''
passes=[]
def ck(n,ok):
 passes.append(bool(ok));print(('PASS' if ok else 'FAIL')+' '+n,flush=True)
def sh(page,s):return page.locator('#spark-full-root').locator(s)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=browser.new_page(viewport={'width':1250,'height':850})
 page.on('dialog',lambda d:d.accept())
 errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
 page.set_content(html)
 page.evaluate('''() => {
 window.__gm=new Map();window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;
 window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));
 window.GM_listValues=()=>[...window.__gm.keys()];window.GM_registerMenuCommand=()=>{};
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async t=>window.__copied=t}});Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (name,opt,fn)=>fn({name})}});
 }''')
 page.add_script_tag(content=SCRIPT)
 sh(page,'.chip').click()
 page.wait_for_timeout(1400)
 ck('auto scan four conversations',sh(page,'[data-select-key]').count()==4)
 ck('nickname excludes date',sh(page,'.scan-results').get_by_text('好友甲',exact=True).count()==1 and sh(page,'.scan-results').get_by_text('好友甲周日',exact=True).count()==0)
 ck('group and bot disabled',sh(page,'[data-candidate]').nth(2).locator('input').is_disabled() and sh(page,'[data-candidate]').nth(3).locator('input').is_disabled())
 ck('no default selected',sh(page,'[data-select-key]:checked').count()==0)
 sh(page,'[data-select-key]').nth(0).check()
 sh(page,'[data-select-key]').nth(1).check()
 ck('checkbox select two',sh(page,'[data-select-key]:checked').count()==2)
 ck('batch send appears and enabled',sh(page,'[data-action="batch-send"]').is_enabled())
 ck('advanced navigation only today advanced',sh(page,'[role="tab"]').count()==2)
 sh(page,'[data-action="tab"][data-value="advanced"]').click()
 sh(page,'[data-action="plugin-open"]').click()
 ck('eight plugin toggles in advanced window',sh(page,'[data-plugin]').count()==8)
 sh(page,'[data-plugin="library"]').check()
 sh(page,'[data-plugin="history"]').check()
 sh(page,'[data-plugin="pacing"]').check()
 ck('advanced settings actually saved',page.evaluate('Object.assign({},window.GM_getValue("spark-full:v2:simple:v1:state").plugins).history'))
 sh(page,'[data-action="drawer-close"]').click()
 sh(page,'[data-action="tab"][data-value="today"]').click()
 ck('enabled library appears in workspace',sh(page,'[data-action="library-open"]').count()==1)
 sh(page,'#spark-final-draft').fill('测试续火🔥')
 # Not pending content, genuine send action, automatic navigation across two selected.
 sh(page,'[data-action="batch-send"]').click()
 page.wait_for_timeout(8500)
 actual=page.evaluate('window.__sent')
 ck('automatic switch + send exactly two',len(actual)==2 and [x['name'] for x in actual]==['好友甲','好友乙'])
 ck('text exact preserved',all(x['body']=='测试续火🔥' for x in actual))
 ck('two confirmations',page.evaluate('document.querySelector("#spark-full-root").shadowRoot.querySelector(".body").textContent.includes("已确认 2")'))
 ck('delivery records collected',len(page.evaluate('window.GM_getValue("spark-full:v2:simple:v1:state").deliveryLog'))==2)
 ck('existing auto schedule remains OFF',page.evaluate('window.GM_getValue("spark-full:v2:settings").autoEnabled') is False)
 
 # status is CHECKED, second click button disabled. Journal blocks if someone clears state or reloads.
 ck('batch button disabled after confirmation',sh(page,'[data-action="batch-send"]').is_disabled())
 ck('same-day send intent journal records two',len(page.evaluate('Object.keys(window.GM_getValue("spark-full:v2:simple:v1:send-intents",{}))'))==2)
 ck('no unexpected browser exceptions',not errs)
 # Test failed acknowledgement on a fresh page and isolated GM storage, fail-closed.
 page2=browser.new_page(viewport={'width':1250,'height':850});page2.on('dialog',lambda d:d.accept());page2.set_content(html)
 page2.evaluate('''() => {window.__failSend=true;window.__gm=new Map();window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));window.GM_listValues=()=>[...window.__gm.keys()];window.GM_registerMenuCommand=()=>{};Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (name,opt,fn)=>fn({name})}});}''')
 page2.add_script_tag(content=SCRIPT);sh(page2,'.chip').click();page2.wait_for_timeout(1000)
 sh(page2,'[data-select-key]').nth(0).check();sh(page2,'[data-select-key]').nth(1).check();sh(page2,'[data-action="batch-send"]').click();page2.wait_for_timeout(8500)
 ck('unknown send stops queue',page2.evaluate('window.__sent.length')==0 and page2.evaluate('Object.keys(window.GM_getValue("spark-full:v2:simple:v1:send-intents",{})).length')==1)
 ck('unknown send disclosed', '待核对' in sh(page2,'.panel').inner_text())
 # screenshot 
 sh(page,'.panel').screenshot(path=str(ROOT/'docs'/'mock-ui-v07.png'))
 browser.close()
 print(f'BROWSER RESULT {sum(passes)}/{len(passes)}',flush=True)
 if not all(passes):raise SystemExit(1)
