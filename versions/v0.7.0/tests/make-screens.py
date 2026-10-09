from pathlib import Path
from playwright.sync_api import sync_playwright
import os
ROOT=Path(__file__).resolve().parents[1]
text=(ROOT/'tests/browser-smoke.py').read_text()
html=text.split("html='''",1)[1].split("'''",1)[0]
script=(ROOT/'douyin-spark.user.js').read_text()
with sync_playwright() as p:
 b=p.chromium.launch(headless=True,executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
 page=b.new_page(viewport={'width':1366,'height':860});page.set_content(html)
 page.evaluate('''()=>{window.__gm=new Map();window.GM_getValue=(k,d)=>window.__gm.get(k)??d;window.GM_setValue=(k,v)=>window.__gm.set(k,v);window.GM_listValues=()=>[...window.__gm.keys()];window.GM_registerMenuCommand=()=>{};}''')
 page.add_script_tag(content=script);root=page.locator('#spark-full-root')
 root.locator('.chip').click();page.wait_for_timeout(1300)
 root.locator('[data-select-key]').nth(0).check();root.locator('[data-select-key]').nth(1).check()
 root.locator('.body').evaluate('(el)=>el.scrollTop=0');root.locator('.panel').screenshot(path=str(ROOT/'docs/today.png'))
 root.locator('[data-action="tab"][data-value="advanced"]').click();root.locator('[data-action="plugin-open"]').click()
 root.locator('.panel').screenshot(path=str(ROOT/'docs/advanced.png'))
 b.close()
