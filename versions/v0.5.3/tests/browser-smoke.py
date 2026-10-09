"""浏览器页面夹具：不连接抖音，不执行真实消息发送。"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from browser_support import launch_chromium
ROOT=Path(__file__).resolve().parents[1]
script=(ROOT/'douyin-spark-full.user.js').read_text(encoding='utf-8')
HTML='''<!doctype html><html><head><meta charset="utf-8"><style>
body{font-family:sans-serif;background:#fafafa}.page{display:grid;grid-template-columns:300px auto}.sidebar{height:90vh;overflow-y:scroll}
.conversationConversationItemwrapper{display:block;cursor:pointer;background:white;margin:4px;padding:12px}
.RightPanelHeadertitleContainer{padding:15px;background:white}.editor{margin:15px;border:1px solid #999;min-height:60px;background:white}
.messageMessageItem{padding:12px;background:white}
</style></head><body><div class="page"><aside class="sidebar">
<div class="conversationConversationItemwrapper conversation-person-chat" data-e2e="conversation-item" data-conversation-id="user1001"><span class="conversationConversationItemtitle">小林</span> <span class="commonStreaknormalText">128</span></div>
<div class="conversationConversationItemwrapper conversation-person-chat" data-e2e="conversation-item" data-conversation-id="user1002"><span class="conversationConversationItemtitle">小雨</span> <span class="commonStreaknormalText">56</span></div>
<div class="conversationConversationItemwrapper conversation-group-chat" data-e2e="conversation-item" data-conversation-id="group1003"><span class="conversationConversationItemtitle">学习交流群</span></div>
</aside><main class="chat" data-conversation-id="user1001"><div class="RightPanelHeadertitleContainer">小林 <span class="commonStreaknormalText">128</span></div>
<div class="messages" id="messages"></div>
<div data-slate-editor="true" contenteditable="true" class="editor"></div></main></div>
<script>
const editor=document.querySelector('.editor');
document.querySelectorAll('[data-e2e="conversation-item"]').forEach(row=>row.addEventListener('click',()=>{
 document.querySelectorAll('[data-e2e="conversation-item"]').forEach(item=>item.removeAttribute('aria-selected'));
 row.setAttribute('aria-selected','true');
 document.querySelector('.chat').setAttribute('data-conversation-id',row.getAttribute('data-conversation-id'));
 const name=row.querySelector('.conversationConversationItemtitle').textContent;
 document.querySelector('.RightPanelHeadertitleContainer').innerHTML = name+(name==='小雨'?' · 待重燃 <span class="commonStreaknormalText">56</span>':name==='小林'?' · <span class="commonStreaknormalText">128</span>':' · 群聊 3人');
}));
editor.addEventListener('keydown',ev=>{
 if(ev.key==='Enter'&&!ev.shiftKey){
 const msg=document.createElement('div');msg.className='messageMessageItem outgoing';msg.textContent=editor.innerText;
 document.querySelector('#messages').appendChild(msg);editor.textContent='';ev.preventDefault();
 }
});
</script></body></html>'''

def run():
 with sync_playwright() as p:
  browser=launch_chromium(p,timeout_ms=9000)
  page=browser.new_page(viewport={'width':1400,'height':950});page.on('dialog',lambda d:d.accept())
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.set_content(HTML,wait_until='domcontentloaded')
  # 仅在本地测试夹具使用模拟 GM 数据，脚本不会连接真实站点
  page.evaluate('''()=>{window.__mockStore={};window.GM_getValue=(k,d)=>Object.prototype.hasOwnProperty.call(window.__mockStore,k)?window.__mockStore[k]:d;window.GM_setValue=(k,v)=>{window.__mockStore[k]=v};window.__mockStore['spark-full:v2:settings']={collapsed:true,activeTab:'contacts',message:'测试续火🔥',confirmEachRun:false,autoEnabled:false,initialDelay:0,interUserDelay:1};}''')
  page.add_script_tag(content=script)
  trigger=page.locator('#spark-full-root .trigger');trigger.wait_for(timeout=3000)
  assert page.locator('#spark-full-root .panel').count()==0
  print('PASS 默认折叠')
  trigger.click();page.locator('#spark-full-root .panel').wait_for(timeout=3000)
  print('PASS 面板展开')
  persons=page.locator('#spark-full-root .person')
  assert persons.count()==3, f'got {persons.count()}'
  print('PASS 3 个会话扫描')
  assert '群聊' in persons.nth(2).inner_text()
  print('PASS 群聊分类')
  page.locator('#spark-full-root button[data-action="inspect"][data-value="id:user1002"]').click()
  page.wait_for_timeout(1000)
  inspected=page.locator('#spark-full-root .person').filter(has=page.locator('button[data-action="inspect"][data-value="id:user1002"]'))
  assert '待重燃' in inspected.inner_text()
  print('PASS 详情重燃识别')
  page.locator('#spark-full-root button[data-action="inspect"][data-value="id:user1001"]').click()
  page.wait_for_timeout(700)
  target=page.locator('#spark-full-root .person').filter(has=page.locator('button[data-action="inspect"][data-value="id:user1001"]'))
  assert '身份待核验' not in target.inner_text()
  target.locator('input[type="checkbox"]').check()
  page.locator('#spark-full-root button[data-action="tab"][data-value="send"]').click()
  page.locator('#spark-full-root button[data-action="preview"]').click()
  page.wait_for_timeout(200)
  assert '测试续火🔥' in page.locator('#spark-preview-result').inner_text()
  print('PASS 模板预览')
  page.locator('#spark-full-root button[data-action="send"]').click()
  page.wait_for_timeout(3600)
  assert page.locator('.messageMessageItem.outgoing').count()==1
  print('PASS 在模拟聊天 DOM 中触发一次消息发送')
  page.locator('#spark-full-root button[data-action="tab"][data-value="contacts"]').click()
  assert 'CONFIRMED' in target.inner_text()
  print('PASS 发送结果在模拟 DOM 中获得确认')
  # 完成后同日再次请求不会重复发送
  page.locator('#spark-full-root button[data-action="tab"][data-value="send"]').click()
  page.locator('#spark-full-root button[data-action="send"]').click()
  page.wait_for_timeout(1100)
  assert page.locator('.messageMessageItem.outgoing').count()==1
  print('PASS 同日防重复发送')
  for tab,expected in [('time','启用每日自动发送'),('texts','一言 API'),('streaks','火花天数'),('logs','日志中心'),('advanced','本地调度器'),('help','使用帮助')]:
   page.locator(f'#spark-full-root button[data-action="tab"][data-value="{tab}"]').click()
   assert expected in page.locator('#spark-full-root .content').inner_text(),f'{tab} missing {expected}'
   print('PASS '+tab+' 页签正常渲染')
  page.locator('#spark-full-root button[data-action="toggle"]').last.click()
  assert page.locator('#spark-full-root .panel').count()==0
  print('PASS 可折叠回小悬浮按钮')
  assert not errors,'Browser page error: '+str(errors)
  print('PASS 浏览器页面无运行时异常')
  page.locator('#spark-full-root .trigger').click()
  page.screenshot(path=str(ROOT/'docs'/'browser-smoke.png'),full_page=True)
  browser.close()
  print('RESULT 17/17 PASS (mock DOM; not Douyin production)')
if __name__=='__main__':run()
