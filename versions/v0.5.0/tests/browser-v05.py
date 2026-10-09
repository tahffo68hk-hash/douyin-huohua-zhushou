"""V0.5 local fake-chat browser flow. Does not contact Douyin."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
from runpy import run_path
base=run_path(str(Path(__file__).with_name('browser-smoke.py')))
HTML,ROOT,script=base['HTML'],base['ROOT'],base['script']

def run():
    passed=0
    def check(message,predicate):
        nonlocal passed
        assert predicate,message
        passed+=1
        print('PASS',message)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking'],timeout=18000)
        page=browser.new_page(viewport={'width':1360,'height':930},accept_downloads=True)
        errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.on('dialog',lambda dlg:dlg.accept())
        page.set_content(HTML,wait_until='domcontentloaded')
        page.evaluate('''()=>{
          window.__mockStore={};window.__notices=[];
          window.GM_getValue=(key, fallback)=>Object.prototype.hasOwnProperty.call(window.__mockStore,key)?window.__mockStore[key]:fallback;
          window.GM_setValue=(key,val)=>{window.__mockStore[key]=val;};
          window.GM_notification=(val)=>window.__notices.push(val);
          const d=new Date(),day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
          window.__mockStore['spark-full:v2:migrated-v03']=true;
          window.__mockStore['spark-full:v2:migrated-v04']=true;
          window.__mockStore['spark-full:v2:settings']={collapsed:true,activeTab:'contacts',autoEnabled:true,initialDelay:0,
            riskAlertsEnabled:true,failureAlertsEnabled:true,unknownAlertsEnabled:true,callbackToken:'HIDDEN_TOKEN',message:'PRIVATE_TEXT'};
          window.__mockStore['spark-full:v2:selected']=['id:user1001'];
          window.__mockStore['spark-full:v2:tasks']={
            [day+'|id:user1001']:{status:'CONFIRMED',time:Date.now()},
            [day+'|id:sample2']:{status:'FAILED',time:Date.now()},
            [day+'|id:sample3']:{status:'UNKNOWN',time:Date.now()}
          };
        }''')
        page.add_script_tag(content=script)
        check('V05 migration disables automation',page.evaluate("window.__mockStore['spark-full:v2:settings'].autoEnabled") is False)
        check('V05 migration disables notifications',page.evaluate("window.__mockStore['spark-full:v2:settings'].riskAlertsEnabled") is False)
        check('collapsed bubble remains the default',page.locator('#spark-full-root .panel').count()==0)
        page.locator('#spark-full-root .trigger').click()
        tabs=page.locator('#spark-full-root button.tab')
        check('14 tabs include alerts stats backup',all(page.locator(f'#spark-full-root button.tab[data-value="{tab}"]').count()==1 for tab in ['alerts','stats','backup']))
        page.locator('button.tab[data-value="alerts"]').click()
        content=page.locator('#spark-full-root .content')
        check('alerts explain cutoff is user set', '绝非抖音官方断火截止时间' in content.inner_text())
        check('alerts allow custom time and notification toggles',content.locator('input[type="time"]').count()==1 and content.locator('input[type="checkbox"]').count()==3)
        content.get_by_text('启用每日未确认消息提醒').locator('..').locator('input[type="checkbox"]').check()
        check('explicit alert opt-in persisted',page.evaluate("window.__mockStore['spark-full:v2:settings'].riskAlertsEnabled") is True)
        page.locator('button.tab[data-value="stats"]').click()
        content=page.locator('#spark-full-root .content')
        check('stats reflect local task statuses only','有记录任务' in content.inner_text() and '待核实' in content.inner_text() and '不能当作抖音续火成功率' in content.inner_text())
        check('stats show three stored task records',content.locator('.stat-card b').first.inner_text()=='3')
        content.locator('select').first.select_option('30')
        check('stats can switch to 30 days',content.locator('.stat-day').count()==30)
        with page.expect_download(timeout=6000) as download_event:
            content.locator('button[data-action="exportStatistics"]').click()
        path=download_event.value.path();data=json.loads(Path(path).read_text())
        check('stats JSON export contains only aggregates','PRIVATE_TEXT' not in json.dumps(data) and 'HIDDEN_TOKEN' not in json.dumps(data) and data['totals']['total']==3)
        page.locator('button.tab[data-value="backup"]').click()
        content=page.locator('#spark-full-root .content')
        check('backup shows local counts and safe restore instructions','本地数据概览' in content.inner_text() and '恢复后自动发送与提醒都关闭' in content.inner_text())
        with page.expect_download(timeout=6000) as download_event:
            content.locator('button[data-action="exportConfig"]').click()
        exported=json.loads(Path(download_event.value.path()).read_text())
        check('exported backup strips callback token',exported['backupVersion']==3 and 'callbackToken' not in exported['settings'] and 'HIDDEN_TOKEN' not in json.dumps(exported))
        # A deliberately crafted import includes invalid control values; preview must never apply them.
        payload={
          'format':'spark-full-v2','settings':{'autoEnabled':True,'riskAlertsEnabled':True,'callbackToken':'EVIL','message':'NEW_TEMPLATE'},
          'contacts':[{'key':'id:import1','name':'进口好友','type':'PERSON','stable':True}],
          'selected':['id:import1'],
          'materials':[{'id':'mat_import1','title':'测试','kind':'TEXT','content':'测试文案'}],
          'contactRules':{}, 'fireDays':{'id:import1':{'days':2}}
        }
        content.locator('#spark-restore-chooser').set_input_files({'name':'backup.json','mimeType':'application/json','buffer':json.dumps(payload).encode('utf8')})
        check('backup import gives preview before mutation','待恢复备份' in content.inner_text() and page.evaluate("window.__mockStore['spark-full:v2:settings'].message")=='PRIVATE_TEXT')
        content.locator('button[data-action="restoreBackup"]').click()
        check('restored message template without auto-send',page.evaluate("window.__mockStore['spark-full:v2:settings'].message")=='NEW_TEMPLATE' and page.evaluate("window.__mockStore['spark-full:v2:settings'].autoEnabled") is False)
        check('restored identity cannot schedule until reverified',page.evaluate("window.__mockStore['spark-full:v2:contacts'][0].requiresReverify") is True)
        check('restore preserves original task guard',page.evaluate("Object.keys(window.__mockStore['spark-full:v2:tasks']).length")==3)
        check('restore turns off alerts',page.evaluate("window.__mockStore['spark-full:v2:settings'].riskAlertsEnabled") is False)
        check('no uncaught browser JS exceptions',not errors)
        page.locator('button.tab[data-value="alerts"]').click()
        page.screenshot(path=str(ROOT/'docs'/'browser-v05.png'),full_page=True)
        browser.close()
        print(f'RESULT {passed}/{passed} PASS (local mock UI only, no Douyin requests)')

if __name__=='__main__':run()
