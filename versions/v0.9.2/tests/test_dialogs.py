#!/usr/bin/env python3
"""Visual-only changes: original selection and help dialogs get matching six-theme UI.
Browser fixture never sends Douyin messages; original HELP_TABS copy must be unchanged.
"""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
from test_browser import HTML
ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'douyin-spark.user.js'
original=(ROOT/'vendor'/'reference-original.txt').read_text(encoding='utf-8-sig')
updated=SCRIPT.read_text(encoding='utf-8')

def section(s, beginning, end):
    return s[s.index(beginning):s.index(end,s.index(beginning))]

help_start='let HELP_TABS = ['
help_end='function showHelpPanel() {'
assert section(original, help_start, help_end)==section(updated, help_start, help_end),'Help copy or content changed'
for fn, next_fn, oldclass, newclass in [
    ('showUserSelectPanel','showFireDaysPanel',"panel.className = 'dyfire-modal';","panel.className = 'dyfire-modal spark-themed-dialog spark-target-dialog';"),
    ('showHelpPanel','showSettingsPanel',"panel.className = 'dyfire-modal dyfire-modal-wide';","panel.className = 'dyfire-modal dyfire-modal-wide spark-themed-dialog spark-help-dialog';")
]:
    src=section(original,'function '+fn+'() {','function '+next_fn+'(')
    compiled=section(updated,'function '+fn+'() {','function '+next_fn+'(')
    assert src.replace(oldclass,newclass,1)==compiled,f'{fn} behavior unexpectedly changed'
print('PASS: entire original help content preserved byte-for-byte and both dialog handlers unchanged except CSS class')

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1280,'height':850})
    errors=[]
    page.on('pageerror',lambda e: errors.append(str(e)))
    page.goto('about:blank')
    page.set_content(HTML)
    page.evaluate("""()=>{window.__gm={};
      window.GM_getValue=(k,f)=>Object.prototype.hasOwnProperty.call(__gm,k)?__gm[k]:f;
      window.GM_setValue=(k,v)=>{__gm[k]=JSON.parse(JSON.stringify(v));};
      window.GM_listValues=()=>Object.keys(__gm);
      window.GM_deleteValue=k=>delete __gm[k];
      window.GM_registerMenuCommand=()=>{};window.GM_notification=()=>{};window.GM_xmlhttpRequest=()=>{};
    }""")
    page.add_script_tag(path=str(SCRIPT))
    page.wait_for_function("document.querySelectorAll('[data-spark-name]').length===3",timeout=9000)
    ROOT.joinpath('docs').mkdir(exist_ok=True)
    page.locator('[data-spark-tab="advanced"]').click()
    expected={'daylight':'rgb(255, 255, 255)','midnight':'rgb(21, 27, 39)',
       'ocean':'rgb(12, 35, 48)','forest':'rgb(248, 252, 247)',
       'sakura':'rgb(255, 250, 252)','amber':'rgb(255, 252, 245)'}
    for theme,background in expected.items():
        page.locator(f'[data-spark-theme-choice="{theme}"]').click()
        page.locator('#spark-targets').click()
        page.wait_for_selector('#dy-fire-user-select-panel .user-checkbox')
        assert page.locator('#dy-fire-user-select-panel .user-checkbox').count()==3
        info=page.evaluate("""()=>{const e=document.querySelector('#dy-fire-user-select-panel');return {
          cls:e.className,bg:getComputedStyle(e).backgroundColor,
          first:getComputedStyle(e.querySelector('.dyfire-user-row span[style*=\\"color\\"]')).color,
          header:getComputedStyle(e.querySelector('h3')).color
        }}""")
        assert 'spark-themed-dialog' in info['cls'] and info['bg']==background, (theme,info)
        if theme=='daylight':
            assert info['first']!='rgb(255, 255, 255)',info
            page.screenshot(path=str(ROOT/'docs'/'users-daylight.png'))
        if theme=='midnight':page.screenshot(path=str(ROOT/'docs'/'users-night.png'))
        page.locator('#dy-fire-user-select-close').click()
        page.locator('#spark-help').click()
        page.wait_for_selector('#dy-fire-help-panel .dyfire-settings-nav-item')
        helpinfo=page.evaluate("""()=>{const e=document.querySelector('#dy-fire-help-panel');return {
          bg:getComputedStyle(e).backgroundColor,nav:getComputedStyle(e.querySelector('.dyfire-settings-nav')).backgroundColor,
          section:getComputedStyle(e.querySelector('.dyfire-section')).backgroundColor,
          paragraph:getComputedStyle(e.querySelector('.dyfire-section [style*=\\"color\\"]')).color,
          tabs:e.querySelectorAll('.dyfire-settings-nav-item').length
        }}""")
        assert helpinfo['bg']==background and helpinfo['tabs']>=3, (theme,helpinfo)
        if theme=='daylight':
            assert helpinfo['paragraph']!='rgb(221, 221, 221)',helpinfo
            page.screenshot(path=str(ROOT/'docs'/'help-daylight.png'))
        if theme=='midnight':page.screenshot(path=str(ROOT/'docs'/'help-night.png'))
        page.locator('#dy-fire-help-close').click()
    # Functional old dialog pathways still work: save targets, all/none, help tabs, search/highlight.
    page.locator('[data-spark-theme-choice="daylight"]').click()
    page.locator('#spark-targets').click()
    page.locator('#dy-fire-select-all').click()
    assert page.locator('.user-checkbox:checked').count()==3
    page.locator('#dy-fire-deselect-all').click()
    assert page.locator('.user-checkbox:checked').count()==0
    page.locator('.user-checkbox[value="小明"]').check()
    page.locator('#dy-fire-user-select-add').click()
    assert page.evaluate('window.__gm.userConfig.targetUsernames')=='小明'
    assert page.locator('#dy-fire-user-select-panel').count()==0
    page.locator('#spark-help').click()
    page.locator('#dy-fire-help-search').fill('火花天数')
    page.wait_for_function("document.querySelector('#dy-fire-help-body').textContent.includes('找到')",timeout=5000)
    assert page.locator('#dy-fire-help-body .dyfire-section').count()>0
    page.locator('#dy-fire-help-body .dyfire-section').first.click()
    page.wait_for_timeout(250)
    assert page.locator('#dy-fire-help-panel .dyfire-settings-nav-item.active').count()==1
    page.locator('#dy-fire-help-gotit').click()
    assert page.locator('#dy-fire-help-panel').count()==0
    # Narrow viewport: dialog and help navigation must remain within visible bounds.
    page.set_viewport_size({'width':375,'height':740})
    page.locator('#spark-targets').click()
    rect=page.locator('#dy-fire-user-select-panel').bounding_box()
    assert rect and rect['x']>=0 and rect['x']+rect['width']<=376,rect
    page.screenshot(path=str(ROOT/'docs'/'users-mobile.png'))
    page.locator('#dy-fire-user-select-close').click()
    page.locator('#spark-help').click()
    rect=page.locator('#dy-fire-help-panel').bounding_box()
    assert rect and rect['x']>=0 and rect['x']+rect['width']<=376,rect
    nav=page.locator('#dy-fire-help-nav')
    assert nav.is_visible()
    page.screenshot(path=str(ROOT/'docs'/'help-mobile.png'))
    page.locator('#dy-fire-help-close').click()
    assert page.evaluate('window.fixture.sends.length')==0
    assert errors==[],errors
    print('PASS: both original dialogs inherit all six theme palettes (computed styles)')
    print('PASS: select-all, clear-all, save targets, help search/navigation/highlight, close')
    print('PASS: browser errors 0; no simulated sends')
    browser.close()
