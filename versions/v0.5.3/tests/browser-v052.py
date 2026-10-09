"""V0.5.2 identity regression fixture; synthetic DOM only, never contacts Douyin."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright
from browser_support import launch_chromium

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = (ROOT / 'douyin-spark-full.user.js').read_text(encoding='utf-8')
def fixture_html(rows=None, header_id='fixture-person-01', header_name='测试对象', header_type='single', loaded=True):
    rows = rows or [{'id': 'fixture-person-01', 'name': '测试对象', 'type': 'person', 'active': True}]
    row_html = []
    for row in rows:
        identity = f'data-conversation-id="{row["id"]}"' if row.get('id') else ''
        selected = 'aria-selected="true"' if row.get('active') else ''
        row_html.append(f'''<section class="conversation-identity-shell" {identity}>
          <div class="conversationConversationItemwrapper conversation-{row.get('type','person')}-chat" data-e2e="conversation-item" {selected}>
            <div class="conversationConversationItemtitle">
              <span class="conversationNickname">{row['name']}</span>
              <span class="conversationItemtime" title="周日">周日</span>
            </div>
          </div>
        </section>''')
    header = ''
    if loaded:
        identity = f'data-conversation-id="{header_id}"' if header_id else ''
        header = f'''<main class="chat-scope" {identity}>
          <header class="RightPanelHeader conversation-{header_type}-chat">
            <div class="RightPanelHeadertitleContainer"><span class="header-contact-name">{header_name}</span></div>
          </header>
          <div class="messages"></div><div data-slate-editor="true" contenteditable="true"></div>
        </main>'''
    return f'''<!doctype html><html><head><meta charset="utf-8"></head><body>
      <aside class="conversationConversationListwrapper">{''.join(row_html)}</aside>{header}
    </body></html>'''


def setup_page(browser, rows=None, header_id='fixture-person-01', header_name='测试对象', header_type='single', loaded=True, contacts=None):
    page = browser.new_page()
    page.set_content(fixture_html(rows, header_id, header_name, header_type, loaded), wait_until='domcontentloaded')
    contacts_json = json.dumps(contacts or [], ensure_ascii=False)
    page.evaluate('''(contacts)=>{
      window.__SPARK_FULL_TEST_MODE__=true;
      window.__confirmCount=0;window.confirm=()=>{window.__confirmCount++;return true;};
      window.__mockStore={
        'spark-full:v2:migrated-v03':true,'spark-full:v2:migrated-v04':true,
        'spark-full:v2:migrated-v05':true,'spark-full:v2:migrated-v051':true,
        'spark-full:v2:migrated-v052':true,
        'spark-full:v2:settings':{autoEnabled:false,initialDelay:0},
        'spark-full:v2:contacts':contacts
      };
      window.GM_getValue=(key,fallback)=>Object.prototype.hasOwnProperty.call(window.__mockStore,key)?window.__mockStore[key]:fallback;
      window.GM_setValue=(key,value)=>{window.__mockStore[key]=value;};
    }''', json.loads(contacts_json))
    page.add_script_tag(content=SCRIPT)
    return page


def collect_and_inspect(page):
    return page.evaluate('''()=>{
      const h=window.__SPARK_FULL_TEST_HOOKS__;
      h.state.contacts=h.collect();
      h.inspectCurrent();
      return [...h.state.contacts.values()].map(c=>({
        key:c.key,name:c.name,displayName:c.displayName,
        conversationStableId:c.conversationStableId,stable:c.stable,
        type:c.type,verificationState:c.verificationState,
        source:c.source,verifiedAt:c.verifiedAt,identityEvidence:c.identityEvidence||null
      }));
    }''')


def run():
    with sync_playwright() as pw:
        browser = launch_chromium(pw, timeout_ms=18000)
        page = setup_page(browser)
        legacy = page.evaluate('''()=>({list:document.querySelector('.conversationConversationItemtitle').textContent.replace(/\\s+/g,' ').trim(),
          header:document.querySelector('.header-contact-name').textContent.trim()})''')
        assert legacy == {'list':'测试对象 周日','header':'测试对象'}
        assert legacy['list'] != legacy['header']
        print('PASS legacy textContent extraction reproduces the weekday nickname mismatch')
        result = collect_and_inspect(page)
        assert len(result) == 1 and result[0]['displayName'] == '测试对象'
        assert result[0]['name'] == '测试对象' and result[0]['verificationState'] == 'VERIFIED'
        assert result[0]['conversationStableId'] == 'fixture-person-01'
        assert 'selected-row' in result[0]['identityEvidence']['sources']
        assert set(result[0]['identityEvidence']['sources']) & {'current-header','current-chat-area','current-route'}
        assert '周日' not in result[0]['displayName']
        assert result[0]['type'] == 'PERSON'
        print('PASS ID-first current-chat inspection corrects display name and records evidence')

        genuine_weekday_name=setup_page(browser,rows=[{'id':'fixture-person-03','name':'合成周日昵称','active':True}],
                                        header_id='fixture-person-03',header_name='合成周日昵称')
        genuine_result=collect_and_inspect(genuine_weekday_name)
        assert genuine_result[0]['displayName']=='合成周日昵称'
        print('PASS a real display name containing 周日 is preserved unchanged')

        conflict = setup_page(browser, header_id='fixture-person-02')
        conflict_result = collect_and_inspect(conflict)
        assert len(conflict_result) == 1 and conflict_result[0]['verificationState'] == 'CONFLICT'
        assert conflict_result[0]['verifiedAt'] == 0 and conflict_result[0]['source'] == '列表'
        print('PASS same-name conflicting IDs are blocked')

        missing = setup_page(browser, rows=[{'id': None, 'name': '测试对象', 'active': True}], header_id=None)
        missing_result = missing.evaluate('''()=>{
          const h=window.__SPARK_FULL_TEST_HOOKS__;h.state.contacts=h.collect();
          const c=[...h.state.contacts.values()][0];
          h.inspectCurrent();return {strict:h.verifyOpenConversation(c,true),state:c.verificationState,source:c.source};
        }''')
        assert missing_result == {'strict': False, 'state': 'UNVERIFIED', 'source': '列表'}
        print('PASS same-name missing-ID strict verification stays unverified')

        duplicate = setup_page(browser, rows=[
            {'id':'fixture-person-01','name':'同名样例','type':'person','active':True},
            {'id':'fixture-person-02','name':'同名样例','type':'person','active':False}
        ], header_id='fixture-person-01', header_name='同名样例')
        duplicate_result = collect_and_inspect(duplicate)
        assert len(duplicate_result) == 2
        assert sum(c['verificationState']=='VERIFIED' for c in duplicate_result) == 1
        assert next(c for c in duplicate_result if c['conversationStableId']=='fixture-person-02')['verificationState']=='UNVERIFIED'
        print('PASS duplicate display names remain separate by stable ID')

        no_marker = setup_page(browser, rows=[{'id':'fixture-person-01','name':'测试对象','type':'person','active':False}])
        marker_result = collect_and_inspect(no_marker)
        assert marker_result[0]['verificationState']=='VERIFIED'
        print('PASS unique detail ID selects its exact row when page omits an active marker')

        group = setup_page(browser, rows=[{'id':'fixture-group-01','name':'群聊样例','type':'group','active':True}],
                           header_id='fixture-group-01',header_name='群聊样例',header_type='single')
        group_result = collect_and_inspect(group)
        assert group_result[0]['verificationState'] == 'CONFLICT'
        print('PASS person/group structural type conflict is blocked')

        unloaded = setup_page(browser, loaded=False)
        unloaded_result = unloaded.evaluate('''()=>{
          const h=window.__SPARK_FULL_TEST_HOOKS__;h.state.contacts=h.collect();h.inspectCurrent();
          const c=[...h.state.contacts.values()][0];return {state:c.verificationState,source:c.source,ok:h.identityReadyForSend(c)};
        }''')
        assert unloaded_result == {'state':'UNVERIFIED','source':'列表','ok':False}
        print('PASS missing current conversation cannot verify or pass send gate')

        persistence = setup_page(browser)
        persisted = collect_and_inspect(persistence)
        stored_contacts = persistence.evaluate("window.__mockStore['spark-full:v2:contacts']")
        restored = setup_page(browser, contacts=stored_contacts)
        restored_result = restored.evaluate('''()=>{
          const h=window.__SPARK_FULL_TEST_HOOKS__;const c=[...h.state.contacts.values()][0];
          return {state:c.verificationState,id:c.conversationStableId,name:c.displayName,
            evidence:c.identityEvidence?.sources||[],current:h.verifyOpenConversation(c,true),auto:h.state.settings.autoEnabled};
        }''')
        assert restored_result['state']=='VERIFIED' and restored_result['id']=='fixture-person-01'
        assert restored_result['name']=='测试对象' and restored_result['current'] is True and restored_result['auto'] is False
        assert 'selected-row' in restored_result['evidence']
        assert set(restored_result['evidence']) & {'current-header','current-chat-area','current-route'}
        print('PASS refresh restores ID relationship and rechecks current conversation; automation stays off')

        imported = page.evaluate('''()=>{
          const h=window.__SPARK_FULL_TEST_HOOKS__;
          const draft=h.parseBackup(JSON.stringify({format:'spark-full-v2',settings:{},
            contacts:[{key:'provisional:fixture',name:'测试对象',stable:false}],selected:['provisional:fixture']}));
          return draft.contacts[0];
        }''')
        assert imported['requiresReverify'] is True and imported['verificationState']=='UNVERIFIED'
        assert imported['conversationStableId'] is None
        print('PASS legacy nickname key cannot silently upgrade to a stable ID')

        gates = page.evaluate('''async()=>{
          const h=window.__SPARK_FULL_TEST_HOOKS__;
          const c={key:'provisional:send-test',name:'合成测试对象',displayName:'合成测试对象',
            conversationStableId:null,stable:false,verificationState:'UNVERIFIED',type:'PERSON',
            requiresReverify:true,ambiguous:false};
          h.state.contacts=new Map([[c.key,c]]);h.state.selected=new Set([c.key]);
          h.state.settings.stickerName='合成表情';
          const text=await h.sendToContact(c.key,'manual');
          await h.sendNamedSticker();
          return {text,confirmCount:window.__confirmCount,taskCount:Object.keys(h.state.tasks).length,
            editorText:document.querySelector('[contenteditable="true"]').textContent};
        }''')
        assert gates == {'text':False,'confirmCount':0,'taskCount':0,'editorText':''}
        print('PASS text and sticker share pre-send identity gate; no failed retry is scheduled')

        retries = page.evaluate('''()=>{
          const h=window.__SPARK_FULL_TEST_HOOKS__,day=h.isoDay();
          h.state.tasks[h.taskId(day,'fixture-unknown')]={status:'UNKNOWN'};
          h.state.tasks[h.taskId(day,'fixture-submitted')]={status:'SUBMITTED'};
          return [h.mayRetry('fixture-unknown'),h.mayRetry('fixture-submitted')];
        }''')
        assert retries == [False,False]
        print('PASS UNKNOWN and SUBMITTED are never automatically retried')

        diagnostic = persistence.evaluate('window.__SPARK_FULL_TEST_HOOKS__.safeDiagnostics()')
        assert diagnostic['buildId'] and diagnostic['identityDOM']['matchedStableId'] is True
        serialized = json.dumps(diagnostic, ensure_ascii=False)
        assert 'fixture-person-01' not in serialized and '测试对象' not in serialized and 'messages' not in serialized
        print('PASS build/DOM diagnostics expose structure and match booleans only')

        duplicate = persistence.evaluate('''async()=>{
          const h=window.__SPARK_FULL_TEST_HOOKS__,c=[...h.state.contacts.values()][0];
          h.state.selected=new Set([c.key]);h.state.settings.confirmEachRun=false;
          h.state.settings.message='合成重复内容';h.state.settings.pageLoadWaitTime=200;
          const bubble=document.createElement('div');bubble.className='messageMessageItem outgoing';bubble.textContent='合成重复内容';
          document.querySelector('.messages').append(bubble);
          const before=document.querySelectorAll('.messageMessageItem.outgoing').length;
          const result=await h.sendToContact(c.key,'manual');
          return {result,status:h.state.tasks[h.taskId(h.isoDay(),c.key)]?.status,
            retry:h.mayRetry(c.key),count:document.querySelectorAll('.messageMessageItem.outgoing').length,
            before,editor:document.querySelector('[contenteditable="true"]').textContent};
        }''')
        assert duplicate == {'result':False,'status':'UNKNOWN','retry':False,'count':1,'before':1,'editor':''}
        print('PASS exact existing outgoing text blocks a duplicate before insertion or send')

        assert page.evaluate("window.__SPARK_FULL_TEST_HOOKS__.state.settings.autoEnabled") is False
        browser.close()
        print('RESULT 13/13 PASS (synthetic local DOM; no Douyin requests)')


if __name__ == '__main__':
    run()
