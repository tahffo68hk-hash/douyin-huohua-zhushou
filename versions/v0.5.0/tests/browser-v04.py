"""V0.4 material library + per-contact schedules, fake chat DOM only."""
from pathlib import Path
from playwright.sync_api import sync_playwright
from runpy import run_path
base=run_path(str(Path(__file__).with_name('browser-smoke.py')))
HTML,ROOT,script=base['HTML'],base['ROOT'],base['script']

def run():
 with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,
   args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking'],timeout=18000)
  page=browser.new_page(viewport={'width':1320,'height':880})
  page.on('dialog',lambda d:d.accept())
  errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(HTML,wait_until='domcontentloaded')
  page.evaluate('''()=>{
   window.__mockStore={};
   window.GM_getValue=(k,d)=>Object.prototype.hasOwnProperty.call(window.__mockStore,k)?window.__mockStore[k]:d;
   window.GM_setValue=(k,v)=>{window.__mockStore[k]=v};
   window.__mockStore['spark-full:v2:migrated-v03']=true;
   window.__mockStore['spark-full:v2:settings']={collapsed:true,activeTab:'contacts',autoEnabled:true,confirmEachRun:false,initialDelay:0,interUserDelay:1};
  }''')
  page.add_script_tag(content=script)
  assert page.evaluate("window.__mockStore['spark-full:v2:settings'].autoEnabled") is False
  print('PASS V04 upgrader safely disables automatic send')
  page.locator('#spark-full-root .trigger').click()
  page.locator('button.tab[data-value="materials"]').click()
  body=page.locator('#spark-full-root .content')
  assert '新增素材' in body.inner_text()
  print('PASS 素材库入口存在')
  def create_material(title,kind,content):
   body.locator('input[maxlength="60"]').fill(title)
   body.locator('select').first.select_option(kind)
   body.locator('textarea').fill(content)
   body.locator('button[data-action="saveMaterial"]').click()
  create_material('早上好','TEXT','早安 [昵称] 🔥')
  assert '早上好' in body.inner_text()
  create_material('晚安','EMOJI','晚安 🫶')
  create_material('开心猫猫','STICKER','开心猫猫')
  assert body.locator('.material-item').count()==3
  print('PASS 素材新增与三种类型存储')
  body.locator('.material-item').first.locator('button[data-action="editMaterial"]').click()
  assert body.locator('input[maxlength="60"]').input_value()=='早上好'
  body.locator('input[maxlength="60"]').fill('每日早安')
  body.locator('button[data-action="saveMaterial"]').click()
  assert '每日早安' in body.inner_text()
  print('PASS 编辑素材并保存')
  page.locator('button.tab[data-value="contacts"]').click()
  page.locator('#spark-full-root .person').first.locator('input[type="checkbox"]').check()
  page.locator('#spark-full-root .person').first.locator('button[data-action="editRule"]').click()
  assert page.locator('button.tab.active').get_attribute('data-value')=='plans'
  print('PASS 从会话列表进入好友独立计划')
  plan=page.locator('#spark-full-root .content')
  plan.locator('select').nth(1).select_option('rotate')
  checkboxes=plan.locator('.material-choices input[type="checkbox"]')
  assert checkboxes.count()==3
  checkboxes.nth(0).check()
  checkboxes.nth(1).check()
  plan.locator('select').nth(2).select_option('custom')
  plan.locator('input[type="time"]').fill('20:15')
  rule=page.evaluate("window.__mockStore['spark-full:v2:contactRules']['id:user1001']")
  assert rule['mode']=='rotate' and rule['schedule']=='custom' and rule['time']=='20:15'
  assert len(rule['materialIds'])==2
  print('PASS 会话专属轮换素材和发送时间保存')
  plan.locator('button[data-action="previewRule"]').click()
  assert '早安 小林' in page.locator('#spark-rule-preview').inner_text()
  print('PASS 个性化预览应用昵称变量')
  # Manually send to a single selected person; no Douyin requests are made.
  page.locator('button.tab[data-value="send"]').click()
  page.locator('button[data-action="send"]').click()
  page.wait_for_timeout(3400)
  assert page.locator('.messageMessageItem.outgoing').count()==1
  assert '早安 小林' in page.locator('.messageMessageItem.outgoing').last.inner_text()
  print('PASS 手动发送使用好友专属素材而非全局模板（模拟 DOM）')
  # Check second message position advanced only after confirmation.
  key='spark-full:v2:rotation:id%3Auser1001'
  rotation=page.evaluate('key => window.__mockStore[key]',key)
  assert rotation['nextIndex']==1
  print('PASS 发送结果确认后才推进素材轮换')
  page.locator('button.tab[data-value="materials"]').click()
  item=page.locator('.material-item').filter(has_text='开心猫猫')
  item.locator('button[data-action="useStickerMaterial"]').click()
  assert page.locator('button.tab.active').get_attribute('data-value')=='send'
  assert page.locator('input[placeholder*="准确表情名称"]').input_value()=='开心猫猫'
  print('PASS 原生表情只进入手动试发入口')
  page.locator('button.tab[data-value="materials"]').click()
  page.locator('.material-item').filter(has_text='晚安').locator('button[data-action="removeMaterial"]').click()
  assert page.locator('.material-item').count()==2
  print('PASS 删除素材同步更新库')
  assert not errors,errors
  print('PASS V04 模拟浏览器没有脚本异常')
  page.locator('button.tab[data-value="plans"]').click()
  page.screenshot(path=str(ROOT/'docs'/'browser-v04.png'),full_page=True)
  browser.close()
  print('RESULT 12/12 PASS (local mocked chat; not live Douyin)')

if __name__=='__main__':run()
