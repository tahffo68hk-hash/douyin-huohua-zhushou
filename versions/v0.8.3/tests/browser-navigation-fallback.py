from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_utils import chromium_executable


SCRIPT = (Path(__file__).resolve().parents[1] / 'douyin-spark.user.js').read_text(encoding='utf-8')
HTML = '''<!doctype html><html><meta charset="utf-8"><body>
<input id="search" placeholder="搜索"><div id="results"></div>
<div data-e2e="conversation-item" class="conversationConversationItemwrapper">
  <div class="commonIMAvataravatarContainer"><img src="data:image/png;base64,iVBORw0KGgo=" /></div>
  <div class="conversationConversationItemtitle">回归联系人</div>
</div>
<div class="RightPanelHeaderconvHeader"><div class="RightPanelHeadertitle">另一个会话</div></div>
<div class="messageMsgInputcontainer"><div class="messageEditorimChatEditorContainer">
  <div class="messageEditorinputArea" data-slate-editor="true" contenteditable="true"><span>\u200b</span></div>
</div><div class="messageMsgInputinputAction"><svg class="e2e-send-msg-btn"></svg></div></div>
<div id="messages"></div>
<script>
window.__rowClicks=0;window.__searchClicks=0;window.__svgClicks=0;window.__sent=[];
const row=document.querySelector('[data-e2e="conversation-item"]');
const title=document.querySelector('.RightPanelHeadertitle');
row.addEventListener('click',()=>{window.__rowClicks++}); // This real-page failure forces the search fallback.
const search=document.querySelector('#search');
search.addEventListener('input',()=>{
  document.querySelector('#results').innerHTML=search.value==='回归联系人'
    ? '<div class="SearchPanelgroupbox"><div class="SearchPanelgrouptitle">联系人</div><div class="SearchPanelitembox"><div class="SearchPanelitemtitle">回归联系人</div><div class="SearchPanelitemchat_btn">发消息</div></div></div>' : '';
  const btn=document.querySelector('.SearchPanelitemchat_btn');
  if(btn)btn.addEventListener('click',()=>{window.__searchClicks++;title.textContent='回归联系人';row.classList.add('conversationConversationItemcurConversation');search.value='';document.querySelector('#results').innerHTML='';});
});
const editor=document.querySelector('[data-slate-editor="true"]');
document.querySelector('.e2e-send-msg-btn').addEventListener('click',()=>{
  window.__svgClicks++;
  const message=editor.textContent.replace(/\u200b/g,'').trim();
  if(!message)return;
  const bubble=document.createElement('div');bubble.className='MessageItemTextisFromMe';
  bubble.innerHTML='<span class="TextMessageTextpureText"></span>';
  bubble.querySelector('span').textContent=message;
  document.querySelector('#messages').append(bubble);
  window.__sent.push(message);editor.textContent='\u200b';
});
</script></body></html>'''


with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=chromium_executable(), args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1100, 'height': 760})
    page.set_content(HTML)
    page.evaluate('''() => {
      window.__gm=new Map();
      window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;
      window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));
      window.GM_listValues=()=>[...window.__gm.keys()];
      window.GM_registerMenuCommand=()=>{};
      const NativeMouseEvent=window.MouseEvent;
      window.MouseEvent=class extends NativeMouseEvent {constructor(type,init={}){if(init.view)throw TypeError('isolated-world view conversion');super(type,init);}};
      Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_n,_o,fn)=>fn({name:'test-lock'})}});
    }''')
    page.add_script_tag(content=SCRIPT)
    root = page.locator('#spark-full-root')
    root.locator('.chip').click()
    page.wait_for_timeout(1400)
    root.locator('[data-select-key]').check()
    root.locator('#spark-final-draft').fill('LOCAL_NAV_TEST')
    root.locator('[data-action="batch-send"]').click()
    page.wait_for_timeout(7000)
    result = page.evaluate('''() => ({
      rowClicks:window.__rowClicks,searchClicks:window.__searchClicks,svgClicks:window.__svgClicks,
      sent:window.__sent,header:document.querySelector('.RightPanelHeadertitle').textContent,
      panel:document.querySelector('#spark-full-root').shadowRoot.querySelector('.body').textContent
    })''')
    error_page = browser.new_page(viewport={'width': 1100, 'height': 760})
    error_page.set_content(HTML)
    error_page.evaluate('''() => {
      window.__gm=new Map();
      window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;
      window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));
      window.GM_listValues=()=>[...window.__gm.keys()];
      window.GM_registerMenuCommand=()=>{};
      window.MouseEvent=class {constructor(){throw TypeError('blocked before submission')}};
      Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_n,_o,fn)=>fn({name:'test-lock'})}});
    }''')
    error_page.add_script_tag(content=SCRIPT)
    error_root = error_page.locator('#spark-full-root')
    error_root.locator('.chip').click()
    error_page.wait_for_timeout(1400)
    error_root.locator('[data-select-key]').check()
    error_root.locator('#spark-final-draft').fill('LOCAL_NAV_TEST')
    error_root.locator('[data-action="batch-send"]').click()
    error_result = error_page.evaluate('''() => ({
      rowClicks:window.__rowClicks,svgClicks:window.__svgClicks,
      intents:window.GM_getValue('spark-full:v2:simple:v1:send-intents',{}),
      panel:document.querySelector('#spark-full-root').shadowRoot.querySelector('.body').textContent
    })''')
    browser.close()

assert result['rowClicks'] == 1, result
assert result['searchClicks'] == 1 and result['header'] == '回归联系人', result
assert result['svgClicks'] == 1 and result['sent'] == ['LOCAL_NAV_TEST'], result
assert '已确认 1' in result['panel'], result
print('PASS official contact-search fallback reaches one exact chat and SVG submits once')
assert error_result['rowClicks'] == 0 and error_result['svgClicks'] == 0, error_result
assert error_result['intents'] == {} and '提交前脚本异常' in error_result['panel'], error_result
assert '本次未发送' in error_result['panel'], error_result
print('PASS a pre-submit exception is FAILED and records no send intent')
