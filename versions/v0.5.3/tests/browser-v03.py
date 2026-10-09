"""v0.3-specific browser tests, local DOM only, no Douyin network."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from runpy import run_path
from browser_support import launch_chromium
smoke=run_path(str(Path(__file__).with_name("browser-smoke.py")))
HTML, ROOT, script = smoke["HTML"], smoke["ROOT"], smoke["script"]

def run():
 with sync_playwright() as p:
  browser=launch_chromium(p,timeout_ms=12000)
  page=browser.new_page(viewport={'width':1280,'height':820})
  page.on('dialog',lambda d:d.accept())
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(HTML,wait_until='domcontentloaded')
  page.evaluate('''()=>{
    window.__mockStore={};
    window.GM_getValue=(k,d)=>Object.prototype.hasOwnProperty.call(window.__mockStore,k)?window.__mockStore[k]:d;
    window.GM_setValue=(k,v)=>{window.__mockStore[k]=v};
    window.__mockStore['spark-full:v2:settings']={collapsed:true,activeTab:'contacts',message:'测试消息🔥',autoEnabled:true,initialDelay:0};
  }''')
  page.add_script_tag(content=script)
  assert page.evaluate("window.__mockStore['spark-full:v2:settings'].autoEnabled") is False
  print('PASS 更新后自动发送关闭')
  page.locator('#spark-full-root .trigger').click()
  panel=page.locator('#spark-full-root .panel')
  assert panel.bounding_box()['width']<=352
  assert panel.bounding_box()['height']<=582
  print('PASS 更紧凑的悬浮面板')
  page.locator('button.tab[data-action="tab"][data-value="health"]').click()
  content=page.locator('#spark-full-root .content')
  assert '聊天页面' in content.inner_text() and '会话列表可见' in content.inner_text()
  print('PASS 健康检查可访问')
  page.evaluate("document.querySelector('.editor').remove()")
  page.locator('button[data-action="health"]').click()
  assert '聊天编辑器可见' in content.inner_text() and '待检查' in content.inner_text()
  print('PASS 缺失编辑器被诊断为待检查')
  page.locator('button[data-action="tab"][data-value="contacts"]').click()
  page.evaluate('''()=>{
    const list=document.querySelector('aside');
    const r=list.querySelector('[data-conversation-id="user1001"]');
    list.appendChild(r.cloneNode(true));
  }''')
  page.locator('button[data-action="scan"]').click()
  page.wait_for_timeout(650)
  assert '重复会话' in page.locator('#spark-full-root .person').first.inner_text()
  print('PASS 相同会话标识出现两次时标记重复')
  assert not errors,errors
  print('PASS 无浏览器异常')
  page.locator('button.tab[data-action="tab"][data-value="health"]').click()
  page.screenshot(path=str(ROOT/'docs'/'browser-v03.png'),full_page=True)
  browser.close()
  print('RESULT 6/6 PASS (mock DOM; not Douyin production)')
if __name__=='__main__':run()
