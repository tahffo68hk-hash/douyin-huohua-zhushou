"""V0.5.3 compatibility fixtures based on observed Douyin DOM class structure."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
from browser_support import launch_chromium

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / 'douyin-spark-full.user.js').read_text(encoding='utf-8')


def row(name, kind='person', selected=False, suffix=''):
    selected_class = ' conversationConversationItemcurConversation' if selected else ''
    if kind == 'group':
        avatar = '<img class="commonConversationIconnoDrag" alt="group-icon">'
    elif kind == 'person':
        avatar = '<div class="commonIMAvataravatarContainer"><img alt="avatar"></div>'
    else:
        avatar = ''
    return f'''<section class="conversation-row-shell">
      <div class="conversationConversationItemwrapper{selected_class}" data-e2e="conversation-item">
        <div class="conversationConversationItemrowArea1">{avatar}</div>
        <div class="conversationConversationItemrowArea2">
          <div class="conversationConversationItemtitleWrapper">
            <div class="conversationConversationItemtitle">{name}</div>
            <div class="ConversationItemTagNextToTitlewrapper">
              <div class="ConversationItemTagNextToTitleleft"><span class="ConversationItemTagNextToTitletimeStr">{suffix or '周日'}</span></div>
            </div>
          </div>
          <div class="ConversationItemDescwrapper"><div class="ConversationItemDesconlineStatus">在线</div></div>
        </div>
      </div>
    </section>'''


def fixture(rows, header='样例用户', loaded=True):
    detail = f'''<main class="componentsRightPanelwrapper">
      <header class="RightPanelHeaderconvHeader">
        <div class="RightPanelHeadertitleContainer"><div class="RightPanelHeadertitle">{header}</div></div>
      </header>
      <div class="componentsRightPanelnotHeaderArea">
        <div class="messages"></div>
        <div class="messageMsgInputcontainer" data-e2e="msg-input">
          <div class="messageMsgInputinputRow">
            <div class="zone-container editor-kit-container messageEditorinputArea" data-slate-editor="true" contenteditable="true"></div>
            <div class="messageMsgInputinputAction"><svg class="messageMsgInputiconAction"></svg><svg class="messageMsgInputpublishBtn e2e-send-msg-btn"></svg></div>
          </div>
        </div>
      </div>
    </main>''' if loaded else ''
    return f'''<!doctype html><html><head><meta charset="utf-8"></head><body>
      <aside class="conversationConversationListwrapper">{''.join(rows)}</aside>{detail}
    </body></html>'''


def setup(browser, rows, contacts=None, selected=None, header='样例用户', loaded=True):
    page = browser.new_page()
    page.set_content(fixture(rows, header, loaded), wait_until='domcontentloaded')
    page.evaluate('''({contacts, selected})=>{
      window.__SPARK_FULL_TEST_MODE__=true;
      window.__mockStore={
        'spark-full:v2:migrated-v03':true,'spark-full:v2:migrated-v04':true,
        'spark-full:v2:migrated-v05':true,'spark-full:v2:migrated-v051':true,
        'spark-full:v2:migrated-v052':true,
        'spark-full:v2:settings':{autoEnabled:false,fireDays:1},
        'spark-full:v2:contacts':contacts,'spark-full:v2:selected':selected
      };
      window.GM_getValue=(k,d)=>Object.prototype.hasOwnProperty.call(window.__mockStore,k)?window.__mockStore[k]:d;
      window.GM_setValue=(k,v)=>{window.__mockStore[k]=v;};
      document.execCommand=(_command,_ui,value)=>{const editor=document.querySelector('[contenteditable="true"]');editor.textContent=value;return true;};
    }''', {'contacts': contacts or [], 'selected': selected or []})
    page.add_script_tag(content=SCRIPT)
    return page


def run():
    with sync_playwright() as pw:
        browser = launch_chromium(pw, timeout_ms=18000)
        page = setup(browser, [row('合成用户', selected=True), row('合成群组', 'group')])
        rows = page.locator('[data-e2e="conversation-item"]')
        classified = rows.evaluate_all('els => els.map(el => {const c=window.__SPARK_FULL_TEST_HOOKS__.contactFromRow(el);return {name:c?.displayName,type:c?.type,days:c?.days,spark:c?.spark};})')
        assert classified == [
            {'name': '合成用户', 'type': 'PERSON', 'days': None, 'spark': 'UNKNOWN'},
            {'name': '合成群组', 'type': 'GROUP', 'days': None, 'spark': 'UNKNOWN'}
        ], classified
        print('PASS observed row markers distinguish personal and group conversations; date/status labels stay outside names')

        genuine = setup(browser, [row('真实周日昵称', selected=True)], header='真实周日昵称')
        named = genuine.locator('[data-e2e="conversation-item"]').evaluate('el => window.__SPARK_FULL_TEST_HOOKS__.contactFromRow(el).displayName')
        assert named == '真实周日昵称'
        print('PASS a genuine nickname containing a weekday label is preserved')

        legacy = setup(browser, [row('新鲜行', selected=True)], header='新鲜行', contacts=[
            {'key': 'provisional:legacy-dirty', 'name': '旧记录星期日', 'stable': False, 'type': 'UNKNOWN'},
            {'key': 'provisional:1', 'name': '旧位置缓存', 'stable': False, 'type': 'UNKNOWN'},
            {'key': 'id:fixture-stable-01', 'name': '稳定样例', 'conversationStableId': 'fixture-stable-01', 'stable': True, 'type': 'UNKNOWN'}
        ], selected=['provisional:legacy-dirty', 'provisional:1', 'id:fixture-stable-01'])
        migrated = legacy.evaluate('''()=>{const h=window.__SPARK_FULL_TEST_HOOKS__;return {
          contacts:[...h.state.contacts.values()].map(c=>c.key),selected:[...h.state.selected],
          pageRows:h.collect().size,manual:(()=>{const c=[...h.collect().values()][0];h.state.selected=new Set([c.key]);return h.manualTargetEvidence(c).ok;})(),
          strict:h.identityReadyForSend(h.collect().values().next().value),
          days:h.getFireDays({key:'fixture-unknown',days:null}),spark:h.classifySpark({days:null,text:''}),
          auto:h.state.settings.autoEnabled
        }}''')
        assert migrated['contacts'] == ['id:fixture-stable-01'], migrated
        assert migrated['selected'] == ['id:fixture-stable-01'], migrated
        assert migrated['pageRows'] == 1 and migrated['manual'] is True and migrated['strict'] is False, migrated
        assert migrated['days'] is None and migrated['spark'] == 'UNKNOWN' and migrated['auto'] is False, migrated
        print('PASS legacy provisional cache is not rebound by row position; manual evidence is ephemeral and automatic identity stays strict')

        selected = setup(browser, [row('合成用户', selected=True)], header='合成用户')
        controls = selected.evaluate('''()=>{const h=window.__SPARK_FULL_TEST_HOOKS__,c=[...h.collect().values()][0];
          h.state.selected=new Set([c.key]);return {active:h.activeRowIdentity(),manual:h.manualTargetEvidence(c).ok,strict:h.verifyOpenConversation(c,true),type:c.type};}''')
        assert controls == {'active': '', 'manual': True, 'strict': False, 'type': 'PERSON'}, controls
        print('PASS selected-row class supports one-time manual target confirmation without creating stable identity evidence')

        inspected = setup(browser, [row('详情昵称', selected=True)], header='详情昵称')
        detail_state = inspected.evaluate('''()=>{const h=window.__SPARK_FULL_TEST_HOOKS__;h.state.contacts=h.collect();
          const c=[...h.state.contacts.values()][0];h.state.selected=new Set([c.key]);h.inspectCurrent();
          const current=h.state.contacts.get(c.key);h.state.tasks[h.taskId(h.isoDay(),c.key)]={status:'CONFIRMED'};
          return {name:current.displayName,type:current.type,verification:current.verificationState,evidence:current.identityEvidence,
            days:current.days,spark:current.spark,fireDays:h.getFireDays(current),today:h.todayOutcome(),
            persisted:h.gmGet('contacts',[]).map(x=>x.key),strict:h.trustedForSchedule(current)};}''')
        assert detail_state == {
            'name': '详情昵称', 'type': 'PERSON', 'verification': 'UNVERIFIED', 'evidence': None,
            'days': None, 'spark': 'UNKNOWN', 'fireDays': None,
            'today': {'confirmed': 1, 'unknown': 0, 'failed': 0, 'total': 1},
            'persisted': [], 'strict': False
        }, detail_state
        print('PASS inspectCurrent reads page status without promoting identity; fire state and today task state remain separate')

        duplicate_manual = setup(browser, [row('同名样例', selected=True), row('同名样例')], header='同名样例')
        duplicate_proof = duplicate_manual.evaluate('''()=>{const h=window.__SPARK_FULL_TEST_HOOKS__,rows=h.collect();h.state.contacts=rows;
          const c=[...rows.values()][0];h.state.selected=new Set([c.key]);return h.manualTargetEvidence(c).ok;}''')
        assert duplicate_proof is False
        print('PASS one-time manual target proof blocks duplicate visible titles')

        multi = setup(browser, [row('合成对象甲', selected=True), row('合成对象乙')])
        multi_result = multi.evaluate('''async()=>{const h=window.__SPARK_FULL_TEST_HOOKS__,rows=h.collect();h.state.contacts=rows;
          h.state.selected=new Set([...rows.keys()]);window.__confirmCount=0;window.confirm=()=>{window.__confirmCount++;return true;};
          await h.sendQueue('manual');return {confirmCount:window.__confirmCount,tasks:Object.keys(h.state.tasks).length,
            editor:document.querySelector('[contenteditable="true"]').textContent};}''')
        assert multi_result == {'confirmCount': 0, 'tasks': 0, 'editor': ''}, multi_result
        print('PASS multi-recipient manual queue is blocked when stable identity is unavailable')

        manual_send = setup(browser, [row('单次样例', selected=True)], header='单次样例')
        send_result = manual_send.evaluate('''async()=>{const h=window.__SPARK_FULL_TEST_HOOKS__,rows=h.collect();h.state.contacts=rows;
          const c=[...rows.values()][0];h.state.selected=new Set([c.key]);h.state.settings.message='V053 synthetic manual flow';
          h.state.settings.pageLoadWaitTime=200;h.state.settings.userSearchTimeout=1000;h.state.settings.chatInputCheckInterval=200;
          window.__confirmCount=0;window.confirm=()=>{window.__confirmCount++;return true;};
          const editor=document.querySelector('[contenteditable="true"]');editor.addEventListener('keydown',event=>{
            if(event.key==='Enter'&&!document.querySelector('.messageMessageItem.outgoing')){
              const bubble=document.createElement('div');bubble.className='messageMessageItem outgoing';bubble.textContent=editor.textContent;
              document.querySelector('.messages').append(bubble);editor.textContent='';
            }
          });
          const result=await h.sendToContact(c.key,'manual'),current=h.state.contacts.get(c.key);
          return {result,confirmCount:window.__confirmCount,status:h.state.tasks[h.taskId(h.isoDay(),c.key)]?.status,
            identity:current.verificationState,evidence:current.identityEvidence,stable:current.conversationStableId,
            auto:h.state.settings.autoEnabled,persisted:h.gmGet('contacts',[]).length,
            outgoing:document.querySelectorAll('.messageMessageItem.outgoing').length};}''')
        assert send_result == {'result': True, 'confirmCount': 1, 'status': 'CONFIRMED',
            'identity': 'UNVERIFIED', 'evidence': None, 'stable': None, 'auto': False,
            'persisted': 0, 'outgoing': 1}, send_result
        print('PASS explicitly confirmed one-time manual send stays ephemeral and does not unlock scheduling')

        no_group = setup(browser, [row('未知会话', 'other')])
        unknown_type = no_group.locator('[data-e2e="conversation-item"]').evaluate('el => window.__SPARK_FULL_TEST_HOOKS__.contactFromRow(el).type')
        assert unknown_type == 'UNKNOWN'
        print('PASS unfamiliar row structure stays UNKNOWN')

        no_sticker = setup(browser, [row('合成用户', selected=True)])
        picker = no_sticker.evaluate('''()=>{const h=window.__SPARK_FULL_TEST_HOOKS__;
          const before=document.querySelectorAll('[role="dialog"], [class*="EmojiPanel"], [class*="StickerPanel"]').length;
          const result=h.tryOpenNativeStickers();const after=document.querySelectorAll('[role="dialog"], [class*="EmojiPanel"], [class*="StickerPanel"]').length;
          return {result,before,after,iconLabels:[...document.querySelectorAll('.messageMsgInputiconAction')].map(e=>Boolean(e.getAttribute('aria-label')||e.getAttribute('title')||e.dataset.e2e))};}''')
        assert picker == {'result': False, 'before': 0, 'after': 0, 'iconLabels': [False]}, picker
        print('PASS unlabeled composer icon is not clicked or treated as a verified sticker picker')

        browser.close()
        print('RESULT 10/10 PASS (synthetic local DOM; no Douyin requests or messages)')


if __name__ == '__main__':
    run()
