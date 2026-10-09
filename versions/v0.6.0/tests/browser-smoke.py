from pathlib import Path
from playwright.sync_api import sync_playwright
import json, traceback
ROOT = Path(__file__).resolve().parents[1]
script = (ROOT/'douyin-spark-simple.user.js').read_text(encoding='utf-8')
html = '''<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>
body{margin:0;background:#f2f3f6;font:14px sans-serif}.sidebar{width:320px;background:white;height:100vh;padding:16px;box-sizing:border-box}.conversationConversationItemwrapper{padding:10px;border-bottom:1px solid #ddd}.conversationConversationItemtitle{display:flex;gap:8px}.date{color:#777}.commonIMAvataravatarContainer img{width:24px;height:24px}
.right{position:absolute;left:330px;top:30px;width:calc(100vw - 340px)}.RightPanelHeadertitleContainer{font-weight:bold}.fake-editor{margin-top:70px;border:1px solid #ddd;background:white;min-height:70px;padding:10px}
</style></head><body><div class="sidebar" id="sidebar">
<div class="conversationConversationItemwrapper" data-scenario="friend"><span class="commonIMAvataravatarContainer"><img src="data:image/png;base64,iVBORw0KGgo=" /></span><div class="conversationConversationItemtitle"><span class="nickname">好友甲</span><span class="date">周日</span></div></div>
<div class="conversationConversationItemwrapper" data-scenario="second"><span class="commonIMAvataravatarContainer"><img src="data:image/png;base64,iVBORw0KGgo=" /></span><div class="conversationConversationItemtitle"><span class="nickname">好友乙</span><span class="date">昨天</span></div></div>
<div class="conversationConversationItemwrapper" data-scenario="group"><span class="commonConversationIconnoDrag">群</span><div class="conversationConversationItemtitle"><span class="nickname">数模交流群</span><span class="date">周日</span></div></div>
<div class="conversationConversationItemwrapper" data-scenario="bot"><span class="commonIMAvataravatarContainer"><img src="data:image/png;base64,iVBORw0KGgo=" /></span><div class="conversationConversationItemtitle"><span class="nickname">助手AI分身</span><span class="date">周六</span></div></div>
</div><div class="right"><div class="RightPanelHeadertitleContainer">好友甲</div><div class="fake-editor" data-slate-editor="true" contenteditable="true">抖音已有草稿，不能改写</div></div></body></html>'''
checks = []
def check(name, condition):
    checks.append((name, bool(condition)))
    print(('PASS' if condition else 'FAIL') + ' ' + name)

def shadow(page, selector):
    return page.locator('#spark-full-root').locator(selector)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1366,'height':768},accept_downloads=True)
    page.set_default_timeout(7000)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.on('dialog',lambda d:d.accept())
    page.set_content(html)
    page.evaluate('''() => {
      window.__gm=new Map(); window.GM_getValue=(key,fallback)=>window.__gm.has(key)?JSON.parse(JSON.stringify(window.__gm.get(key))):fallback;
      window.GM_setValue=(key,value)=>window.__gm.set(key,JSON.parse(JSON.stringify(value)));
      window.GM_listValues=()=>[...window.__gm.keys()];
      window.GM_registerMenuCommand=(label,fn)=>{window.__menus=window.__menus||[];window.__menus.push(label)};
      window.__lastCopied=null;
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.__lastCopied=value}}});
      window.GM_setValue('spark-full:v2:settings',{autoEnabled:true,enableScriptBCallback:true,message:'—————每日续火—————\\n[TXTAPI]\\n\\n—————每日一言—————\\n[API]\\n\\n—————专属一言—————\\n[专属一言]\\n\\n🔥 火花已续 [天数] 天'});
      window.GM_setValue('spark-full:v2:tasks',{[new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0')+'-'+String(new Date().getDate()).padStart(2,'0')+'|id:stable_fake']:{status:'UNKNOWN'}});
    }''')
    page.add_script_tag(content=script)
    check('only one menu command without send',page.evaluate('window.__menus')==['打开 / 收起续火助手'])
    check('migrated old autoEnabled=false',page.evaluate('window.GM_getValue("spark-full:v2:settings").autoEnabled') is False)
    check('floating chip exists',shadow(page,'.chip').count()==1)
    shadow(page,'.chip').click()
    check('exactly two tabs',shadow(page,'[role="tab"]').count()==2)
    check('no legacy send or schedule',shadow(page,'[data-action="send"]').count()==0 and '批量发送' not in shadow(page,'.panel').inner_text())
    check('default copy text',shadow(page,'#spark-final-draft').input_value()=='续火🔥')
    check('no selected recipients', '今天还没选择' in shadow(page,'.panel').inner_text())
    shadow(page,'[data-action="add-open"]').first.click()
    check('dates excluded from nickname',shadow(page,'[data-action="add"][data-key]').count() == 4 and shadow(page,'.drawerbody').get_by_text('好友甲',exact=True).count()==1)
    check('group add disabled',shadow(page,'.drawerbody').locator('[data-scenario="group"]').count()==0 and shadow(page,'.drawerbody').get_by_text('数模交流群',exact=True).count()==1 and shadow(page,'.drawerbody').locator('.contact').nth(2).locator('[data-action="add"]').is_disabled())
    check('AI add disabled',shadow(page,'.drawerbody').locator('.contact').nth(3).locator('[data-action="add"]').is_disabled())
    shadow(page,'#spark-contact-search').fill('友甲')
    check('search preserves input focus and filters',shadow(page,'#spark-drawer-results .contact').count()==1 and shadow(page,'#spark-contact-search').input_value()=='友甲')
    shadow(page,'#spark-drawer-results [data-action="add"]').click()
    check('added one target without send', '好友甲' in shadow(page,'.panel').inner_text() and shadow(page,'.contact').count()==1)
    check('official draft untouched',page.locator('.fake-editor').inner_text()=='抖音已有草稿，不能改写')
    shadow(page,'#spark-final-draft').fill('测试文字\n🔥🫶')
    shadow(page,'[data-action="copy"]').click()
    page.wait_for_timeout(100)
    check('copy retains linebreak emoji',page.evaluate('window.__lastCopied')=='测试文字\n🔥🫶')
    check('copy is not confirmation', '待处理' in shadow(page,'.contact').inner_text())
    shadow(page,'#spark-final-draft').fill('x'*901)
    shadow(page,'[data-action="copy"]').click()
    check('overlong content blocked without truncation',page.evaluate('window.__lastCopied')=='测试文字\n🔥🫶' and len(shadow(page,'#spark-final-draft').input_value())==901)
    shadow(page,'#spark-final-draft').fill('测试文字\n🔥🫶')
    check('official editor still untouched after copy',page.locator('.fake-editor').inner_text()=='抖音已有草稿，不能改写')
    shadow(page,'[data-action="check"]').click()
    check('manual check label not fire success','你已核对消息' in shadow(page,'.panel').inner_text() and '火花续上 ✓' not in shadow(page,'.panel').inner_text())
    shadow(page,'[data-action="row-more"]').click()
    shadow(page,'[data-action="undo-check"]').click()
    check('can revoke manual check only', '待处理' in shadow(page,'.contact').inner_text())
    shadow(page,'[data-action="row-more"]').click()
    shadow(page,'[data-action="skip"]').click()
    check('skip is distinct from confirmation', '今天跳过' in shadow(page,'.contact').inner_text())
    shadow(page,'[data-action="row-more"]').click()
    shadow(page,'[data-action="unskip"]').click()
    check('skip reversible', '待处理' in shadow(page,'.contact').inner_text())
    shadow(page,'[data-action="library-open"]').click()
    shadow(page,'#spark-material-new').fill('常用文字😊')
    shadow(page,'[data-action="material-save"]').click()
    check('material saved','常用文字😊' in shadow(page,'.drawerbody').inner_text())
    shadow(page,'[data-action="material-use"]').click()
    check('material fills final draft',shadow(page,'#spark-final-draft').input_value()=='常用文字😊')
    page.evaluate('document.querySelector("#spark-full-root").shadowRoot.querySelector(".body").scrollTop=0')
    shadow(page,'.panel').screenshot(path=str(ROOT/'docs'/'mock-ui.png'))
    shadow(page,'[data-action="library-open"]').click()
    shadow(page,'[data-action="material-delete"]').click()
    check('deletion reversible for five seconds',shadow(page,'[data-action="material-undo"]').count()==1)
    shadow(page,'[data-action="material-undo"]').click()
    check('undo restores material', '常用文字😊' in shadow(page,'.drawerbody').inner_text())
    shadow(page,'[data-action="drawer-close"]').click()
    shadow(page,'[data-action="tab"][data-value="settings"]').click()
    check('settings no send parameters','数据管理' in shadow(page,'.panel').inner_text() and '时间窗口' not in shadow(page,'.panel').inner_text())
    with page.expect_download() as got:
        shadow(page,'[data-action="export"]').click()
    data=json.loads(Path(got.value.path()).read_text(encoding='utf-8'))
    check('backup includes material & document',len(data['data']['materials'])==1 and data['data']['draft']=='常用文字😊')
    check('backup excludes tokens and logs','callbackToken' not in json.dumps(data) and '"logs"' not in json.dumps(data))
    shadow(page,'[data-action="support-toggle"]').click()
    with page.expect_download() as got2:shadow(page,'[data-action="diagnostic"]').click()
    diag=json.loads(Path(got2.value.path()).read_text(encoding='utf-8'))
    check('diagnostic anonymous',diag['candidateCount']==4 and '好友甲' not in json.dumps(diag,ensure_ascii=False))
    shadow(page,'[data-action="tab"][data-value="today"]').click()
    shadow(page,'[data-action="collapse"]').click()
    check('collapsed chip usable',not shadow(page,'.chip').is_hidden() and shadow(page,'.panel').is_hidden())
    # Drag the folded entry: dragged pointer must not accidentally expand it.
    old=shadow(page,'.chip').bounding_box()
    page.mouse.move(old['x']+20,old['y']+15)
    page.mouse.down();page.mouse.move(old['x']-75,old['y']-20,steps=5);page.mouse.up()
    moved=shadow(page,'.chip').bounding_box()
    check('chip is draggable and movement does not activate it',abs(moved['x']-old['x'])>20 and shadow(page,'.panel').is_hidden())
    check('chip position stored safely',page.evaluate('!!window.GM_getValue("spark-full:v2:simple:v1:state").ui.float'))
    shadow(page,'.chip').click()
    page.set_viewport_size({'width':320,'height':568})
    bounds=shadow(page,'.panel').bounding_box()
    check('320px viewport panel inside screen',bounds['x']>=0 and bounds['x']+bounds['width']<=321 and bounds['y']>=0)
    shadow(page,'#spark-final-draft').fill('键盘保留文本')
    shadow(page,'#spark-final-draft').press('Escape')
    check('Escape collapses without deleting draft',shadow(page,'.panel').is_hidden())
    shadow(page,'.chip').click()
    check('draft preserved on reopen',shadow(page,'#spark-final-draft').input_value()=='键盘保留文本')
    # Imported backup is previewed, never silently executed or granted identity.
    shadow(page,'[data-action="tab"][data-value="settings"]').click()
    old_backup={"format":"spark-full-v2","settings":{"autoEnabled":True,"enableScriptBCallback":True,"message":"恢复文案"},"contacts":[{"key":"temp:old-name","name":"旧同名"}],"selected":["temp:old-name"],"materials":[{"id":"valid_12345","kind":"TEXT","title":"恢复示例","content":"恢复用内容"}]}
    upload={"name":"backup.json","mimeType":"application/json","buffer":json.dumps(old_backup,ensure_ascii=False).encode('utf-8')}
    shadow(page,'#spark-import-file').set_input_files(upload)
    page.wait_for_timeout(250)
    shadow(page,'[data-action="restore-yes"]').wait_for(timeout=7000)
    check('old-format restore preview shown before mutation',shadow(page,'[data-action="restore-yes"]').count()==1 and '旧版 Full' in shadow(page,'.panel').inner_text())
    shadow(page,'[data-action="restore-cancel"]').click()
    check('restore cancel leaves draft intact',page.evaluate('window.GM_getValue("spark-full:v2:simple:v1:state").draft')=='键盘保留文本')
    shadow(page,'#spark-import-file').set_input_files(upload)
    shadow(page,'[data-action="restore-yes"]').wait_for(timeout=7000)
    shadow(page,'[data-action="restore-yes"]').click()
    check('restore asks then changes content',page.evaluate('window.GM_getValue("spark-full:v2:simple:v1:state").draft')=='恢复文案')
    check('restore preserves locally frozen UNKNOWN task',page.evaluate('Object.values(window.GM_getValue("spark-full:v2:simple:v1:state").legacyArchive.tasks).some(v=>v.status==="UNKNOWN")'))
    check('restore never re-enables auto settings',page.evaluate('window.GM_getValue("spark-full:v2:settings").autoEnabled') is False)
    check('restore no automatic contact association',page.evaluate('window.GM_getValue("spark-full:v2:simple:v1:state").savedStableChoices.length')==0)
    check('no JS runtime errors',len(errors)==0)
    # UI screenshot was captured before restoring backup, from synthetic people.
    print('SCREENSHOT',ROOT/'docs'/'mock-ui.png')
    # A failed migration must be visible but never offer a working editor or executor.
    fail_page=browser.new_page(viewport={'width':1200,'height':700})
    fail_page.set_content(html)
    fail_page.evaluate('''() => {window.GM_getValue=(k,v)=>v;window.GM_setValue=()=>{throw Error('storage denied')};window.GM_listValues=()=>[];}''')
    fail_page.add_script_tag(content=script)
    fail_page.locator('#spark-full-root .chip').click()
    fail_text=fail_page.locator('#spark-full-root .panel').inner_text()
    check('migration storage failure is fail-closed', '本地迁移暂未完成' in fail_text and fail_page.locator('#spark-final-draft').count()==0)
    fail_page.close()
    print('BROWSER RESULT',sum(v for _,v in checks),'/',len(checks))
    if errors: print('ERRORS',errors)
    browser.close()
    if not all(v for _,v in checks):raise SystemExit(1)
