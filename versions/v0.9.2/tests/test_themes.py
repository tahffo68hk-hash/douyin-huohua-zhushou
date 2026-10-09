#!/usr/bin/env python3
"""Visual-only theme regression: all colors, day/night toggle, persistence, no sends."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from test_browser import HTML

ROOT=Path(__file__).resolve().parents[1]
SCRIPT=ROOT/'douyin-spark.user.js'

def prepare_page(browser, store=None):
    page=browser.new_page(viewport={'width':1260,'height':900})
    page.goto('about:blank')
    page.set_content(HTML, wait_until='domcontentloaded')
    import json
    source=json.dumps(store or {},ensure_ascii=False)
    page.evaluate("""(source)=>{
      window.__gm=JSON.parse(source);
      window.GM_getValue=(k,f)=>Object.prototype.hasOwnProperty.call(window.__gm,k)?window.__gm[k]:f;
      window.GM_setValue=(k,v)=>{window.__gm[k]=JSON.parse(JSON.stringify(v));};
      window.GM_listValues=()=>Object.keys(window.__gm);
      window.GM_deleteValue=k=>delete window.__gm[k];
      window.GM_registerMenuCommand=()=>{};window.GM_notification=()=>{};window.GM_xmlhttpRequest=()=>{};
    }""",source)
    return page

def main():
    with sync_playwright() as p:
        browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
        page=prepare_page(browser)
        errors=[]
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.add_script_tag(path=str(SCRIPT))
        page.wait_for_function("document.querySelectorAll('[data-spark-name]').length===3",timeout=8000)
        assert page.locator('#spark-theme-quick').is_visible()
        assert page.locator('#spark-auto-on').is_checked() is False
        assert page.locator('#dy-fire-send').get_attribute('disabled') is not None
        page.locator('[data-spark-name="小明"]').check()
        page.locator('[data-spark-name="小雨"]').check()
        page.locator('#spark-message').fill('主题切换不影响原有正文🔥')
        page.locator('#spark-message').dispatch_event('change')
        assert page.locator('#spark-selected-count').inner_text()=='2'
        page.locator('[data-spark-tab="advanced"]').click()
        assert page.locator('[data-spark-theme-choice]').count()==6
        expected={
          'daylight':('rgb(255, 255, 255)','rgb(24, 37, 56)'),
          'midnight':('rgb(21, 27, 39)','rgb(240, 244, 250)'),
          'ocean':('rgb(12, 35, 48)','rgb(232, 247, 251)'),
          'forest':('rgb(248, 252, 247)','rgb(28, 56, 42)'),
          'sakura':('rgb(255, 250, 252)','rgb(80, 51, 68)'),
          'amber':('rgb(255, 252, 245)','rgb(72, 55, 39)')
        }
        for name,colors in expected.items():
            page.locator(f'[data-spark-theme-choice="{name}"]').click()
            data=page.evaluate("""()=>({
                name:document.documentElement.dataset.sparkUiTheme,
                background:getComputedStyle(document.querySelector('#dy-fire-helper')).backgroundColor,
                foreground:getComputedStyle(document.querySelector('#dy-fire-helper')).color,
                control:getComputedStyle(document.querySelector('#spark-scan-btn')).backgroundColor,
                stored:GM_getValue('spark:reference-ui:v1').theme,
                selects:[...document.querySelectorAll('[data-spark-theme-choice][aria-pressed=true]')].length,
            })""")
            assert data['name']==name and data['stored']==name,data
            assert data['background']==colors[0] and data['foreground']==colors[1],data
            assert data['selects']==1,data
            assert page.locator('#spark-auto-on').is_checked() is False
            assert page.evaluate('window.fixture.sends.length')==0
            if name in ('midnight','ocean'):
                assert data['control']!='rgb(255, 255, 255)',data
        # Last dark and light palette are remembered during quick toggle.
        page.locator('[data-spark-theme-choice="ocean"]').click()
        page.locator('[data-spark-theme-choice="forest"]').click()
        page.locator('#spark-theme-quick').click()
        assert page.evaluate('document.documentElement.dataset.sparkUiTheme')=='ocean'
        page.locator('#spark-theme-quick').click()
        assert page.evaluate('document.documentElement.dataset.sparkUiTheme')=='forest'
        # Visual snapshot for convenient comparison; theme is not a send trigger.
        page.locator('[data-spark-theme-choice="midnight"]').click()
        page.locator('[data-spark-tab="today"]').click()
        assert page.locator('#spark-selected-count').inner_text()=='2'
        assert page.locator('#spark-message').input_value()=='主题切换不影响原有正文🔥'
        page.screenshot(path=str(ROOT/'docs'/'theme-night-today.png'),full_page=False)
        page.locator('[data-spark-tab="advanced"]').click()
        (ROOT/'docs').mkdir(exist_ok=True)
        page.screenshot(path=str(ROOT/'docs'/'theme-night.png'),full_page=False)
        page.locator('[data-spark-theme-choice="sakura"]').click()
        page.screenshot(path=str(ROOT/'docs'/'theme-sakura.png'),full_page=False)
        stored=page.evaluate('window.__gm')
        page.close()
        page=prepare_page(browser,stored)
        page.on('pageerror',lambda e: errors.append(str(e)))
        page.add_script_tag(path=str(SCRIPT))
        page.wait_for_function("!!document.querySelector('#spark-theme-quick')",timeout=6000)
        page.wait_for_function("document.documentElement.dataset.sparkUiTheme==='sakura'",timeout=6000)
        assert page.locator('#spark-theme-quick').inner_text()=='🌙 夜间'
        assert page.evaluate("GM_getValue('spark:reference-ui:v1').theme")=='sakura'
        assert page.locator('#spark-auto-on').is_checked() is False
        assert page.evaluate('window.fixture.sends.length')==0
        assert errors==[],errors
        print('PASS: six themes have distinct computed colors and correct selected state')
        print('PASS: day/night toggle remembers last light and dark palettes')
        print('PASS: theme persists across reinitialization; scheduling disabled; zero sends')
        print('PASS: JS page errors: 0')
        browser.close()
if __name__=='__main__':main()
