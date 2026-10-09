'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const script=fs.readFileSync(path.join(__dirname,'../douyin-spark-full.user.js'),'utf8');
const saved=new Map(),desktop=[];
const prefix='spark-full:v2:';
saved.set(prefix+'migrated-v03',true);saved.set(prefix+'migrated-v04',true);
saved.set(prefix+'settings',{autoEnabled:true,collapsed:false,message:'我的私人消息',callbackToken:'PRIVATE_SECRET',riskAlertsEnabled:true,failureAlertsEnabled:true,unknownAlertsEnabled:true});
saved.set(prefix+'contacts',[{key:'id:person1',name:'小雨',type:'PERSON',stable:true},{key:'id:group1',name:'学习群',type:'GROUP',stable:true}]);
saved.set(prefix+'selected',['id:person1','id:group1']);
saved.set(prefix+'materials',[{id:'mat_first',kind:'TEXT',title:'问候',content:'你好'}]);
const window={__SPARK_FULL_TEST_MODE__:true,confirm:()=>true,alert:()=>{}};
const ctx={window,document:{visibilityState:'visible'},location:{href:'https://www.douyin.com/chat',pathname:'/chat'},
  GM_getValue:(k,f)=>saved.has(k)?saved.get(k):f,GM_setValue:(k,v)=>saved.set(k,v),
  GM_notification:o=>desktop.push(o),console,Date,Map,Set,URL,Promise,Math,setTimeout,clearTimeout};
vm.createContext(ctx);vm.runInContext(script,ctx);
const h=window.__SPARK_FULL_TEST_HOOKS__;
let pass=0;const tests=[];const test=(n,fn)=>tests.push([n,fn]);
const now=new Date('2026-10-09T22:10:00');
const day=h.isoDay(now);
const person=h.state.contacts.get('id:person1'),group=h.state.contacts.get('id:group1');
test('upgrade disables auto and all new alert toggles',()=>{
 assert.equal(h.state.settings.autoEnabled,false);for(const f of ['riskAlertsEnabled','failureAlertsEnabled','unknownAlertsEnabled'])assert.equal(h.state.settings[f],false);
 assert.equal(saved.get(prefix+'migrated-v05'),true);
});
test('prior materials and contacts kept, notification defaults off',()=>{
 assert.equal(h.state.contacts.size,2);assert.equal(h.state.materials.length,1);assert.equal(h.state.settings.message,'我的私人消息');
});
test('assessment includes personal selected contacts only',()=>{
 h.state.settings.riskCheckTime='22:30';h.state.settings.riskLeadMinutes=60;
 const result=h.riskAssessment(now);assert.equal(result.items.length,1);assert.equal(result.due.length,1);assert.equal(result.skipped.length,1);
});
test('risk window before threshold is EARLY',()=>{
 assert.equal(h.riskAssessment(new Date('2026-10-09T20:45:00')).items[0].windowStatus,'EARLY');
});
test('risk check time passed does not claim real streak ended',()=>{
 const r=h.riskAssessment(new Date('2026-10-09T23:30:00'));
 assert.equal(r.due.length,0);assert.equal(r.items[0].windowStatus,'AFTER_CHECK_TIME');
});
test('confirmed outgoing message removes unsent-task reminder, not platform streak proof',()=>{
 h.state.tasks[`${day}|id:person1`]={status:'CONFIRMED'};
 assert.equal(h.riskAssessment(now).items.length,0);delete h.state.tasks[`${day}|id:person1`];
});
test('confirmed outgoing cannot silence a fresh rekindle label',()=>{
 person.spark='NEEDS_REKINDLE';person.source='详情';person.verifiedAt=now.getTime()-120000;
 h.state.tasks[`${day}|id:person1`]={status:'CONFIRMED'};
 assert.equal(h.riskAssessment(now).items[0].severity,'REKINDLE_CHECK');
 delete h.state.tasks[`${day}|id:person1`];person.spark='UNKNOWN';person.source='列表';person.verifiedAt=0;
});
test('unknown result explicitly categorized as requiring review',()=>{
 h.state.tasks[`${day}|id:person1`]={status:'UNKNOWN'};
 assert.equal(h.riskAssessment(now).items[0].severity,'VERIFY');delete h.state.tasks[`${day}|id:person1`];
});
test('fresh rekindle shown only when observed in detail',()=>{
 person.spark='NEEDS_REKINDLE';person.source='详情';person.verifiedAt=now.getTime()-2000;
 assert.equal(h.riskAssessment(now).items[0].severity,'REKINDLE_CHECK');
 person.verifiedAt=now.getTime()-48*3600000;
 assert.equal(h.riskAssessment(now).items[0].severity,'UNCONFIRMED');
 person.source='列表';person.verifiedAt=now.getTime()-2000;
 assert.equal(h.riskAssessment(now).items[0].severity,'UNCONFIRMED');
});
test('manual disabled rule excludes person from reminder',()=>{
 h.state.contactRules[person.key]={enabled:false};assert.equal(h.riskAssessment(now).items.length,0);
 delete h.state.contactRules[person.key];
});
test('opt-in daily reminder sent once with anonymous desktop notification',()=>{
 h.state.settings.riskAlertsEnabled=true;
 assert.equal(h.checkRiskReminder(now),true);
 assert.equal(h.checkRiskReminder(now),false);
 assert.equal(h.unreadAlerts(),1);
 assert.equal(desktop.length,1);
 assert.ok(!JSON.stringify(desktop).includes('小雨'));
 assert.ok(!JSON.stringify(desktop).includes('PRIVATE_SECRET'));
});
test('late opening sends one overdue self-check reminder',()=>{
 assert.equal(h.checkRiskReminder(new Date('2026-10-10T20:00:00')),false);
 assert.equal(h.checkRiskReminder(new Date('2026-10-10T23:00:00')),true);
 assert.equal(h.checkRiskReminder(new Date('2026-10-10T23:10:00')),false);
});
test('reminder respects pause and hidden tab',()=>{
 h.state.isPaused=true;assert.equal(h.checkRiskReminder(new Date('2026-10-10T22:00:00')),false);h.state.isPaused=false;
 ctx.document.visibilityState='hidden';assert.equal(h.checkRiskReminder(new Date('2026-10-10T22:00:00')),false);ctx.document.visibilityState='visible';
});
test('duplicate same-ID alert ignored',()=>assert.equal(h.pushAlert('risk','again',`risk-reminder:${day}`,now.getTime()),false));
test('task FAILED and UNKNOWN alerts honor opt-in and deduplicate',()=>{
 h.state.settings.failureAlertsEnabled=true;h.state.settings.unknownAlertsEnabled=true;
 assert.equal(h.emitTaskAlert(person.key,'FAILED'),true);
 assert.equal(h.emitTaskAlert(person.key,'FAILED'),false);
 assert.equal(h.emitTaskAlert(person.key,'UNKNOWN'),true);
 assert.equal(h.emitTaskAlert(person.key,'UNKNOWN'),false);
 assert.equal(h.state.alerts.length,4);
 assert.ok(!JSON.stringify(desktop).includes('小雨'));
});
test('task notifications can be fully disabled',()=>{
 h.state.settings.failureAlertsEnabled=false;h.state.settings.unknownAlertsEnabled=false;
 assert.equal(h.emitTaskAlert(group.key,'FAILED'),false);
 assert.equal(h.emitTaskAlert(group.key,'UNKNOWN'),false);
});
test('recordTask automatically dispatches failure notification when opted in',()=>{
 h.state.settings.failureAlertsEnabled=true;
 h.state.contacts.set('id:second',{key:'id:second',name:'第二人',stable:true,type:'PERSON'});
 const before=h.state.alerts.length;
 h.recordTask('id:second','FAILED','未找到聊天窗口');
 assert.equal(h.state.alerts.length,before+1);
 assert.equal(h.state.tasks[h.taskId(h.isoDay(),'id:second')].status,'FAILED');
 h.recordTask('id:second','FAILED','再次失败');
 assert.equal(h.state.alerts.length,before+1);
 h.state.settings.failureAlertsEnabled=false;
});
test('7 day local metrics count final recorded statuses only',()=>{
 h.state.tasks[`${day}|id:person1`]={status:'CONFIRMED'};
 h.state.tasks[`${day}|id:group1`]={status:'FAILED'};
 h.state.tasks[`${day}|id:other`]={status:'UNKNOWN'};
 h.state.tasks[`${day}|id:inflight`]={status:'SUBMITTED'};
 h.state.tasks[`2026-08-01|id:old`]={status:'CONFIRMED'};
 const {totals}=h.aggregateTasks(now,7);
 assert.equal(totals.total,5);assert.equal(totals.confirmed,1);assert.equal(totals.unknown,2);assert.equal(totals.failed,2);
});
test('30-day period excludes old and includes 20 day old',()=>{
 h.state.tasks[`2026-09-20|id:old`]={status:'CONFIRMED'};
 assert.equal(h.aggregateTasks(now,7).totals.confirmed,1);
 assert.equal(h.aggregateTasks(now,30).totals.confirmed,2);
});
test('metrics never expose names or message bodies',()=>{
 const r=JSON.stringify(h.aggregateTasks(now,7));
 assert.ok(!r.includes('小雨')&&!r.includes('我的私人消息'));
});
const valid={format:'spark-full-v2',settings:{autoEnabled:true,message:'恢复模板',callbackToken:'BAD_KEY',riskAlertsEnabled:true},
 contacts:[{key:'id:person1',name:'小雨',stable:true,type:'PERSON',verifiedAt:Date.now()},
           {key:'id:person2',name:'小林',stable:true,type:'PERSON'}],selected:['id:person1','id:person2'],
 materials:[{id:'mat_first',title:'你好',kind:'TEXT',content:'hi'}],
 contactRules:{'id:person1':{enabled:true,mode:'fixed',materialIds:['mat_first'],schedule:'custom',time:'21:00'}},
 fireDays:{'id:person1':{days:56},'invalidkey':{days:7}}};
test('backup parser restricts fields, requires identity recheck',()=>{
 const draft=h.parseBackup(JSON.stringify(valid));assert.equal(draft.contacts.length,2);
 assert.equal(draft.contacts[0].requiresReverify,true);assert.equal(draft.contacts[0].verifiedAt,0);
 assert.equal(draft.settings.autoEnabled,undefined);assert.equal(draft.settings.callbackToken,undefined);
 assert.equal(draft.settings.riskAlertsEnabled,undefined);assert.equal(draft.fireDays['invalidkey'],undefined);
});
test('invalid backup/oversized backup refused',()=>{
 assert.throws(()=>h.parseBackup('{}'));
 assert.throws(()=>h.parseBackup(' '.repeat(1000001)));
 assert.throws(()=>h.parseBackup(JSON.stringify({...valid,format:'spark-full-v9'})));
});
test('import is preview only, no immediate overwrite',async()=>{
 const file={name:'private.json',text:async()=>JSON.stringify(valid)};
 await h.importConfig(file);
 assert.equal(h.state.contacts.size,3);
 assert.equal(h.state.pendingRestore.draft.contacts.length,2);
 assert.equal(h.state.settings.message,'我的私人消息');
});
test('confirmed restore preserves existing task history and disables automation',()=>{
 const t=JSON.stringify(h.state.tasks);
 assert.equal(h.confirmRestore(),true);
 assert.equal(h.state.settings.autoEnabled,false);
 assert.equal(h.state.settings.riskAlertsEnabled,false);
 assert.equal(h.state.settings.failureAlertsEnabled,false);
 assert.equal(h.state.settings.unknownAlertsEnabled,false);
 assert.equal(h.state.settings.callbackToken,'PRIVATE_SECRET');
 assert.equal(h.state.settings.message,'恢复模板');
 assert.equal(JSON.stringify(h.state.tasks),t);
 assert.equal(h.state.pendingRestore,null);
 assert.equal(h.trustedForSchedule(h.state.contacts.get('id:person1')),false);
});
test('all test scenarios passed',()=>assert.ok(pass>=22));
(async()=>{for(const [name,fn] of tests){await fn();pass++;console.log('PASS',name)}console.log(`RESULT ${pass}/${pass} PASS`);})().catch(e=>{console.error('FAIL',e);process.exitCode=1});
