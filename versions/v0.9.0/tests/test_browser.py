#!/usr/bin/env python3
"""Isolated Chromium DOM fixture: proves UI wiring & original engine sequence, NOT Douyin delivery."""
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'douyin-spark.user.js'
HTML = r'''<!doctype html><html><head><meta charset="UTF-8"/><style>
body{font-family:Arial;margin:10px;background:#f9fbff;min-height:750px}
.conversationConversationItemwrapper{width:260px;padding:12px;border-bottom:1px solid gray;cursor:pointer}
.SearchPanelitemchat_btn{background:#259;border:0;color:white;margin:6px;padding:10px}
#header{font-size:18px;background:#eef;padding:10px}
#editor{border:1px solid #ccc;min-height:45px;width:340px;padding:10px}
#searchbar{padding:8px;width:240px}
</style></head><body>
<div id="fixture"><input id="searchbar" placeholder="搜索" type="text">
<div id="search-results"></div><div class="conversationConversationListwrapper">
<div class="conversationConversationItemwrapper"><div class="conversationConversationItemtitle">小明</div><span class="commonStreaknormalText">12</span></div>
<div class="conversationConversationItemwrapper"><div class="conversationConversationItemtitle">小雨</div><span class="commonStreaknormalText">24</span></div>
<div class="conversationConversationItemwrapper"><div class="conversationConversationItemtitle">小林</div></div>
</div><div class="RightPanelHeadertitleContainer" id="header">尚未打开聊天</div>
<div id="editor" contenteditable="true" data-slate-editor="true">\u200b</div><div id="outgoing"></div></div>
<script>
window.fixture={navigations:[],sends:[],lastTarget:null};
const $=s=>document.querySelector(s);
const header=$('#header'), editor=$('#editor'), out=$('#outgoing');
function openChat(name){window.fixture.lastTarget=name;window.fixture.navigations.push(name);header.textContent=name;editor.textContent='\u200b';out.innerHTML='';}
for(const row of document.querySelectorAll('.conversationConversationItemwrapper'))row.addEventListener('click',()=>openChat(row.querySelector('.conversationConversationItemtitle').textContent));
$('#searchbar').addEventListener('input',e=>{
  const name=e.target.value.trim();const target=$('#search-results');target.replaceChildren();
  if(['小明','小雨','小林'].includes(name)){
    let button=document.createElement('button');button.className='SearchPanelitemchat_btn';button.textContent='聊天';
    button.addEventListener('click',()=>openChat(name));target.appendChild(button);
  }
});
editor.addEventListener('keydown',e=>{
  if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();let text=editor.textContent.replace(/^\u200b+|\u200b+$/g,'');
   if(text.trim()){window.fixture.sends.push({to:window.fixture.lastTarget,text});let row=document.createElement('p');row.className='sent-from-me';row.textContent=text;out.append(row);editor.textContent='\u200b';}
  }
});
</script></body></html>'''

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        context=browser.new_context(viewport={'width':1280,'height':850})
        page=context.new_page()
        errs=[]
        page.on('pageerror',lambda e:errs.append(str(e)))
        page.add_init_script("""window.__gm={};
          window.GM_getValue=(k,f)=>Object.prototype.hasOwnProperty.call(window.__gm,k)?window.__gm[k]:f;
          window.GM_setValue=(k,v)=>{window.__gm[k]=JSON.parse(JSON.stringify(v));};
          window.GM_listValues=()=>Object.keys(window.__gm);
          window.GM_deleteValue=k=>delete window.__gm[k];
          window.GM_registerMenuCommand=()=>{};
          window.GM_notification=()=>{};
          window.GM_xmlhttpRequest=()=>{};""")
        page.goto('about:blank')
        page.set_content(HTML,wait_until='domcontentloaded')
        page.add_script_tag(path=str(SCRIPT))
        page.wait_for_timeout(1500)
        assert not errs,errs
        page.wait_for_function("document.querySelectorAll('[data-spark-name]').length===3", timeout=8000)
        assert page.locator('#spark-auto-on').is_checked() is False,'Schedule must be opt in'
        page.locator('[data-spark-name="小明"]').check()
        page.locator('[data-spark-name="小雨"]').check()
        assert page.locator('#spark-selected-count').inner_text()=='2'
        # One click authorizes a one-time selection and exact selected text.
        page.locator('#spark-message').fill('今天也续火🔥')
        page.locator('#dy-fire-send').click()
        page.wait_for_function("window.fixture.sends.length===2",timeout=28000)
        data=page.evaluate('window.fixture')
        assert data['navigations'][:2]==['小明','小雨'],data
        assert data['sends']==[{'to':'小明','text':'今天也续火🔥'},{'to':'小雨','text':'今天也续火🔥'}],data
        page.wait_for_function("document.querySelector('#dy-fire-user-progress').textContent==='2/2'",timeout=6000)
        assert not page.locator('#spark-auto-on').is_checked()
        page.wait_for_function("!document.querySelector('#dy-fire-send').textContent.includes('正在自动发送')",timeout=4000)
        assert not errs,errs
        (ROOT/'docs').mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT/'docs'/'today.png'),full_page=False)
        page.locator('[data-spark-tab="advanced"]').click()
        assert page.locator('#spark-advanced').is_visible()
        assert page.locator('#spark-today').is_hidden()
        page.screenshot(path=str(ROOT/'docs'/'advanced.png'),full_page=False)
        page.locator('#spark-auto-on').check()
        assert page.evaluate("window.__gm.userConfig.automationEnabled") is True
        page.locator('#spark-auto-on').uncheck()
        assert page.evaluate("window.__gm.userConfig.automationEnabled") is False
        assert not errs,errs
        print('PASS: source-engine search/navigation/Enter -> 2 fixture sends from single click')
        print('PASS: UI scan/checkbox/draft/two tabs and schedule opt-in/out')
        print('PASS: browser page errors:',len(errs))
        browser.close()

if __name__=='__main__':
    main()
