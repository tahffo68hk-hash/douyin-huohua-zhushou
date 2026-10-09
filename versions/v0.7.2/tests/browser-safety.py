from pathlib import Path
from playwright.sync_api import sync_playwright
import re,os
from browser_utils import chromium_executable
ROOT=Path(__file__).resolve().parents[1]
base=(ROOT/'tests/browser-smoke.py').read_text(encoding='utf-8')
html=base.split("html='''",1)[1].split("'''",1)[0]
script=(ROOT/'douyin-spark.user.js').read_text(encoding='utf-8')
checks=[]
def check(name, condition):
 checks.append(bool(condition));print(('PASS ' if condition else 'FAIL ')+name,flush=True)
def shadow(page,s):return page.locator('#spark-full-root').locator(s)
def setup(browser, old=None):
 page=browser.new_page(viewport={'width':1100,'height':760});page.set_content(html);page.on('dialog',lambda d:d.accept());
 page.evaluate('''(old)=>{window.__gm=new Map(old||[]);window.GM_getValue=(k,d)=>window.__gm.has(k)?JSON.parse(JSON.stringify(window.__gm.get(k))):d;window.GM_setValue=(k,v)=>window.__gm.set(k,JSON.parse(JSON.stringify(v)));window.GM_listValues=()=>[...window.__gm.keys()];window.GM_registerMenuCommand=()=>{};Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async (n,opt,fn)=>fn({name:n})}});}''', old)
 page.add_script_tag(content=script);shadow(page,'.chip').click();page.wait_for_timeout(800);return page
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,executable_path=chromium_executable(),args=['--no-sandbox','--disable-dev-shm-usage'])
 # Existing drafted content prevents submission, even if user clicked the one-click send action.
 pg=setup(browser)
 pg.evaluate('''() => document.querySelector('[data-name="好友甲"]').addEventListener('click',()=>{document.querySelector('.editor').textContent='已经写好的私人草稿';})''')
 shadow(pg,'[data-select-key]').nth(0).check();shadow(pg,'[data-action="batch-send"]').click();pg.wait_for_timeout(2000)
 check('existing editor draft not replaced',pg.locator('.editor').inner_text()=='已经写好的私人草稿')
 check('existing editor draft prevented any external send',pg.evaluate('window.__sent.length')==0)
 check('pre-submit failure created no intent record',pg.evaluate('window.GM_getValue("spark-full:v2:simple:v1:send-intents",{})')=={})
 pg.close()
 # When route navigates to wrong display title, do not write or send a message.
 pg=setup(browser)
 pg.evaluate('''() => document.querySelector('[data-name="好友甲"]').addEventListener('click',()=>{document.getElementById('head').textContent='其他人';})''')
 shadow(pg,'[data-select-key]').nth(0).check();shadow(pg,'[data-action="batch-send"]').click();pg.wait_for_timeout(4000)
 check('wrong header prevents any send',pg.evaluate('window.__sent.length')==0)
 check('wrong header did not consume outgoing intent',pg.evaluate('window.GM_getValue("spark-full:v2:simple:v1:send-intents",{})')=={})
 pg.close()
 # A page change immediately after submission makes the result UNKNOWN and halts later contacts.
 pg=setup(browser)
 pg.evaluate('''() => {const b=document.getElementById('official-send'),send=b.onclick;b.onclick=()=>{send();document.getElementById('head').textContent='其他人';};}''')
 shadow(pg,'[data-select-key]').nth(0).check();shadow(pg,'[data-select-key]').nth(1).check()
 shadow(pg,'[data-action="batch-send"]').click();pg.wait_for_timeout(700)
 intents=pg.evaluate('window.GM_getValue("spark-full:v2:simple:v1:send-intents",{})')
 check('page switch during confirmation stops the remaining queue',pg.evaluate('window.__sent.length')==1 and len(intents)==1 and '结果不明确' in shadow(pg,'.panel').inner_text())
 pg.close()
 # Overlong/multiline batch sends are blocked before talking to the website.
 pg=setup(browser);shadow(pg,'[data-select-key]').nth(0).check()
 shadow(pg,'#spark-final-draft').fill('a'*901);shadow(pg,'[data-action="batch-send"]').click();pg.wait_for_timeout(250)
 check('overlong batch text blocked',pg.evaluate('window.__sent.length')==0)
 shadow(pg,'#spark-final-draft').fill('第一行\n第二行');shadow(pg,'[data-action="batch-send"]').click();pg.wait_for_timeout(250)
 check('multiline batch text blocked with no side effects',pg.evaluate('window.__sent.length')==0 and pg.evaluate('window.GM_getValue("spark-full:v2:simple:v1:send-intents",{})')=={})
 pg.close()
 # Successful send, then run newly installed script on same saved GM values and select same one again.
 pg=setup(browser);shadow(pg,'[data-select-key]').nth(0).check();shadow(pg,'#spark-final-draft').fill('续火测试🔥')
 shadow(pg,'[data-action="batch-send"]').click();pg.wait_for_timeout(1500)
 check('original send succeeded',pg.evaluate('window.__sent.length')==1)
 store=pg.evaluate('[...window.__gm.entries()]');pg.close()
 pg=setup(browser,store);shadow(pg,'[data-select-key]').nth(0).check();shadow(pg,'[data-action="batch-send"]').click();pg.wait_for_timeout(800)
 check('restart same-day repeat refused',pg.evaluate('window.__sent.length')==0)
 check('restart repeat surfaced pending verification','待核对' in shadow(pg,'.panel').inner_text())
 pg.close()
 browser.close()
print(f'SAFETY RESULT {sum(checks)}/{len(checks)}',flush=True)
if not all(checks):raise SystemExit(1)
