from pathlib import Path
import os
from playwright.sync_api import sync_playwright
from browser_utils import chromium_executable

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / 'douyin-spark.user.js').read_text(encoding='utf-8')
HTML = '''<!doctype html><html><meta charset="utf-8"><style>
.sidebar{width:260px;height:280px;overflow:auto}.conversationConversationItemwrapper{padding:10px}
.RightPanelHeaderconvHeader{font-weight:bold}.messageMsgInputcontainer{margin-top:20px}
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
    <div class="messageEditorimChatEditorContainer"><div class="zone-container editor-kit-container messageEditorinputArea notranslate chrome window chrome88" data-slate-editor="true" contenteditable="true"><div class="ace-line"><span>\u200b</span></div></div></div>
    <div class="messageMsgInputinputAction"><svg class="messageMsgInputpublishBtn e2e-send-msg-btn"></svg></div>
  </div></div></div>
</div>
<script>
window.__sent=[];window.__keyboardTrust=[];window.__sendClicks=0;window.__sendTargets=[];
const editor=document.querySelector('[data-slate-editor="true"]');
const submit=()=>{const body=editor.textContent.replace(/\u200b/g,'').trim();if(!body)return;const row=document.createElement('div');row.className='MessageItemTextcontainer MessageItemTextisFromMe';const text=document.createElement('div');text.className='TextMessageTextpureText';text.textContent=body;row.append(text);document.querySelector('#messages').append(row);window.__sent.push(body);editor.textContent='\u200b';};
document.querySelector('.e2e-send-msg-btn').addEventListener('click',event=>{window.__sendClicks++;window.__sendTargets.push(event.target===event.currentTarget?'svg-target':'unexpected-target');submit();});
editor.addEventListener('keydown',e=>{window.__keyboardTrust.push(e.isTrusted);if(e.key==='Enter'&&e.isTrusted)submit();});
</script></body></html>'''

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=chromium_executable(), args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1100, 'height': 760})
    console_messages = []
    confirmations = []
    page.on('console', lambda message: console_messages.append(message.text))
    def accept_dialog(dialog):
        confirmations.append(dialog.message)
        dialog.accept()
    page.on('dialog', accept_dialog)
    page.set_content(HTML)
    page.evaluate('''() => {
      window.__gm=new Map();
      window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;
      window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));
      window.GM_listValues=()=>[...window.__gm.keys()];
      window.GM_registerMenuCommand=()=>{};
      Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_name,_options,fn)=>fn({name:'test-lock'})}});
    }''')
    page.add_script_tag(content=SCRIPT)
    root = page.locator('#spark-full-root')
    root.locator('.chip').click()
    page.wait_for_timeout(1400)
    root.locator('[data-select-key]').check()
    root.locator('#spark-final-draft').fill('REGRESSION_ONLY')
    root.locator('[data-action="batch-send"]').click()
    page.wait_for_timeout(7000)
    sent = page.evaluate('window.__sent')
    intents = page.evaluate('window.GM_getValue("spark-full:v2:simple:v1:send-intents",{})')
    result_text = root.locator('.body').inner_text()
    message_count = page.locator('#messages .MessageItemTextcontainer').count()
    debug = page.evaluate('''() => {const s=document.querySelector('#spark-full-root')?.shadowRoot;return {status:s?.querySelector('.warning')?.textContent||'',panelText:s?.querySelector('.panel')?.textContent?.slice(-180)||'',scanCount:s?.querySelectorAll('[data-select-key]').length||0,checked:s?.querySelectorAll('[data-select-key]:checked').length||0,batchEnabled:!!s?.querySelector('[data-action="batch-send"]')&&!s.querySelector('[data-action="batch-send"]').disabled,editor:[...document.querySelector('[data-slate-editor="true"]')?.textContent||''].map(c=>c.codePointAt(0)),sendIcons:document.querySelectorAll('.e2e-send-msg-btn').length,sendClicks:window.__sendClicks,sendTargets:window.__sendTargets,keyboardEvents:window.__keyboardTrust}}''')
    browser.close()

if sent == ['REGRESSION_ONLY'] and '已确认 1' in result_text and len(intents) == 1 and message_count == 2 and not debug['keyboardEvents'] and debug['sendTargets'] == ['svg-target'] and len(confirmations) == 1 and '没有稳定 ID' in confirmations[0]:
    print('PASS zero-width editor, SVG send target, and historical duplicate message are handled safely')
else:
    print('FAIL zero-width editor, SVG send target, and historical duplicate message are handled safely')
    print(f'  sent_count={len(sent)} intent_count={len(intents)} bubbles={message_count} confirmed={"已确认 1" in result_text} synthetic_keys={len(debug["keyboardEvents"])}')
    print(f'  editor_codepoints={debug["editor"]} send_icons={debug["sendIcons"]} send_clicks={debug["sendClicks"]} send_targets={debug["sendTargets"]} synthetic_keys={debug["keyboardEvents"]}')
    print(f'  scan_count={debug["scanCount"]} checked={debug["checked"]} batch_enabled={debug["batchEnabled"]} panel_tail={debug["panelText"].encode("unicode_escape").decode("ascii")}')
    print(f'  console={str(console_messages).encode("unicode_escape").decode("ascii")}')
    raise SystemExit(1)

SECOND_ROW = '''<div class="conversationConversationItemwrapper">
  <div class="commonIMAvataravatarContainer"><img src="data:image/png;base64,iVBORw0KGgo=" /></div>
  <div class="conversationConversationItemrowArea1"><div class="conversationConversationItemtitle">另一个会话</div></div>
  <div class="conversationConversationItemrowArea2"><span class="conversationConversationItemtime">周六</span></div>
</div>'''
MULTI_HTML = HTML.replace('</div></div>\n<div class="RightPanelHeaderconvHeader">', '</div>' + SECOND_ROW + '</div>\n<div class="RightPanelHeaderconvHeader">', 1)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=chromium_executable(), args=['--no-sandbox', '--disable-dev-shm-usage'])
    page = browser.new_page(viewport={'width': 1100, 'height': 760})
    page.on('dialog', lambda dialog: dialog.accept())
    page.set_content(MULTI_HTML)
    page.evaluate('''() => {
      window.__gm=new Map();
      window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;
      window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));
      window.GM_listValues=()=>[...window.__gm.keys()];
      window.GM_registerMenuCommand=()=>{};
      Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (_name,_options,fn)=>fn({name:'test-lock'})}});
    }''')
    page.add_script_tag(content=SCRIPT)
    root = page.locator('#spark-full-root')
    root.locator('.chip').click()
    page.wait_for_timeout(1400)
    root.locator('[data-select-key]').nth(0).check()
    root.locator('[data-select-key]').nth(1).check()
    root.locator('#spark-final-draft').fill('REGRESSION_ONLY')
    root.locator('[data-action="batch-send"]').click()
    page.wait_for_timeout(900)
    sent_count = page.evaluate('window.__sent.length')
    intent_count = page.evaluate('Object.keys(window.GM_getValue("spark-full:v2:simple:v1:send-intents",{})).length')
    warning = root.locator('.toast').inner_text() if root.locator('.toast').count() else ''
    browser.close()

if sent_count == 0 and intent_count == 0 and '稳定' in warning:
    print('PASS no-ID multiple contacts are blocked before any send intent')
else:
    print(f'FAIL no-ID multiple contacts are blocked before any send intent sent={sent_count} intents={intent_count} warning={warning.encode("unicode_escape").decode("ascii")}')
    raise SystemExit(1)
