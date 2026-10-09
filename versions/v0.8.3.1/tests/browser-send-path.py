from pathlib import Path

from playwright.sync_api import sync_playwright

from browser_utils import chromium_executable


SCRIPT = (Path(__file__).resolve().parents[1] / 'douyin-spark.user.js').read_text(encoding='utf-8')
HTML = '''<!doctype html><html><meta charset="utf-8"><style>
.sidebar{width:280px}.conversationConversationItemwrapper{padding:12px}
</style><body>
<div class="sidebar"><div class="conversationConversationItemwrapper">
  <div class="commonIMAvataravatarContainer"><img src="data:image/png;base64,iVBORw0KGgo=" /></div>
  <div class="conversationConversationItemrowArea1"><div class="conversationConversationItemtitle">回归联系人</div></div>
  <div class="conversationConversationItemrowArea2"><span class="conversationConversationItemtime">周日</span></div>
</div></div>
<div class="RightPanelHeaderconvHeader"><div class="RightPanelHeadertitle">回归联系人</div></div>
<div class="componentsRightPanelnotHeaderArea">
  <div id="messages"><div class="MessageItemTextcontainer MessageItemTextisFromMe"><div class="TextMessageTextpureText">REGRESSION_ONLY</div></div></div>
  <div class="messageMsgInputcontainer"><div class="messageMsgInputinputColumn"><div class="messageMsgInputinputRow">
    <div class="messageEditorimChatEditorContainer"><div class="zone-container editor-kit-container messageEditorinputArea" data-slate-editor="true" contenteditable="true"><div class="ace-line"><span>\u200b</span></div></div></div>
    <div class="messageMsgInputinputAction"><svg class="messageMsgInputpublishBtn e2e-send-msg-btn"></svg></div>
  </div></div></div>
</div>
<script>
window.__sent=[];window.__keys=[];window.__svgClicks=0;window.__parentClicks=0;
const editor=document.querySelector('[data-slate-editor="true"]');
const submit=()=>{const body=editor.textContent.replace(/\u200b/g,'').trim();if(!body)return;const row=document.createElement('div');row.className='MessageItemTextcontainer MessageItemTextisFromMe';const text=document.createElement('div');text.className='TextMessageTextpureText';text.textContent=body;row.append(text);document.querySelector('#messages').append(row);window.__sent.push(body);editor.textContent='\u200b';};
editor.addEventListener('keydown',e=>{if(e.key!=='Enter'||e.shiftKey)return;window.__keys.push({trusted:e.isTrusted,key:e.key});if(!window.__trustedOnly)submit();});
document.querySelector('.messageMsgInputinputAction').addEventListener('click',e=>{if(e.target===e.currentTarget)window.__parentClicks++});
document.querySelector('.e2e-send-msg-btn').addEventListener('click',()=>{window.__svgClicks++;if(!window.__trustedOnly)submit();});
</script></body></html>'''


def run_case(trusted_only):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, executable_path=chromium_executable(), args=['--no-sandbox'])
        page = browser.new_page(viewport={'width': 1100, 'height': 760})
        page.set_content(HTML)
        page.evaluate('''trustedOnly => {
          window.__trustedOnly=trustedOnly;
          window.__gm=new Map();
          window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;
          window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));
          window.GM_listValues=()=>[...window.__gm.keys()];
          window.GM_registerMenuCommand=()=>{};
          const NativeMouseEvent=window.MouseEvent;
          window.MouseEvent=class extends NativeMouseEvent {constructor(type,init={}){if(init.view)throw TypeError('isolated-world view conversion');super(type,init);}};
          Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_name,_options,fn)=>fn({name:'test-lock'})}});
        }''', trusted_only)
        page.add_script_tag(content=SCRIPT)
        root = page.locator('#spark-full-root')
        root.locator('.chip').click()
        page.wait_for_timeout(1400)
        root.locator('[data-select-key]').check()
        root.locator('#spark-final-draft').fill('REGRESSION_ONLY')
        root.locator('[data-action="batch-send"]').click()
        page.wait_for_timeout(7000)
        result = page.evaluate('''() => ({
          sent:window.__sent,keys:window.__keys,svgClicks:window.__svgClicks,parentClicks:window.__parentClicks,
          editor:document.querySelector('[data-slate-editor="true"]').textContent,
          intents:window.GM_getValue('spark-full:v2:simple:v1:send-intents',{}),
          bubbles:document.querySelectorAll('#messages .MessageItemTextcontainer').length,
          manualButtons:document.querySelector('#spark-full-root').shadowRoot.querySelectorAll('[data-action="check"]').length,
          panel:document.querySelector('#spark-full-root').shadowRoot.querySelector('.body').textContent
        })''')
        browser.close()
        return result


success = run_case(False)
assert success['sent'] == ['REGRESSION_ONLY'], success
assert success['keys'] == [] and success['svgClicks'] == 1 and success['parentClicks'] == 0, success
assert success['bubbles'] == 2 and success['editor'].replace('\u200b', '') == '', success
assert len(success['intents']) == 1 and '已确认 1' in success['panel'], success
print('PASS SVG click submits once and requires a new own message')

unknown = run_case(True)
assert unknown['sent'] == [] and unknown['keys'] == [], unknown
assert unknown['svgClicks'] == 1 and unknown['parentClicks'] == 0, unknown
assert len(unknown['intents']) == 1 and '发送结果未知' in unknown['panel'], unknown
assert unknown['manualButtons'] == 0 and '人工核对' not in unknown['panel'], unknown
print('PASS ignored SVG click remains UNKNOWN without a second submission')
