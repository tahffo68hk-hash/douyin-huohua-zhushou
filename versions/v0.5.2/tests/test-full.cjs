const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.resolve(__dirname,'../douyin-spark-full.user.js'),'utf8');
const store=new Map();
const request=(opts)=>{
  setImmediate(()=>opts.onload?.({status:200,responseText:JSON.stringify({hitokoto:'明天会更好',from:'纸上',from_who:'作者'})}));
};
const win={__SPARK_FULL_TEST_MODE__:true};
const context={window:win,GM_getValue:(k,f)=>store.has(k)?store.get(k):f,GM_setValue:(k,v)=>store.set(k,v),GM_xmlhttpRequest:request,localStorage:{getItem:()=>null,setItem:()=>{}},console,Date,Map,Set,URL,Promise,Math,setTimeout,clearTimeout,setImmediate};
vm.createContext(context);vm.runInContext(code,context,{filename:'douyin-spark-full.user.js'});
const h=win.__SPARK_FULL_TEST_HOOKS__;
let n=0;
function check(name,fn){fn();console.log('PASS',name);n++}
async function ac(name,fn){await fn();console.log('PASS',name);n++}
(async()=>{
 check('userscript targets douyin chat',()=>assert.match(code,/\/\/ @match\s+https:\/\/www\.douyin\.com\/chat\*/));
 check('GM APIs explicitly declared',()=>{for(const x of ['GM_getValue','GM_setValue','GM_xmlhttpRequest'])assert.ok(code.includes('// @grant        '+x))});
 check('default auto disabled',()=>assert.equal(h.state.settings.autoEnabled,false));
 check('default collapsed',()=>assert.equal(h.state.settings.collapsed,true));
 check('default callback disabled',()=>assert.equal(h.state.settings.enableScriptBCallback,false));
 check('classify groups',()=>assert.equal(h.classify({headerText:'群成员 28 人'}),'GROUP'));
 check('classify person',()=>assert.equal(h.classify({headerText:'单聊 · 测试'}),'PERSON'));
 check('uncertain stays uncertain',()=>assert.equal(h.classify({rowText:'有群聊活动的好友'}),'UNKNOWN'));
 check('needs rekindle outranks days',()=>assert.equal(h.classifySpark({days:100,text:'待重燃 · 100 天'}),'NEEDS_REKINDLE'));
 check('completed rekindle',()=>assert.equal(h.classifySpark({days:100,text:'重燃成功'}),'REKINDLED'));
 check('missing spark cannot infer active',()=>assert.equal(h.classifySpark({days:null,text:''}),'UNKNOWN'));
 check('streak count alone does not prove active status',()=>assert.equal(h.classifySpark({days:28,text:'28'}),'UNKNOWN'));
 check('explicit normal fire recognized',()=>assert.equal(h.classifySpark({days:28,text:'火花正常'}),'ACTIVE'));
 check('clocks validated',()=>{assert.equal(h.parseClock('23:59'),1439);assert.equal(h.parseClock('24:00'),null)});
 check('Emoji survives normalization',()=>assert.equal(h.textForSend('🔥\n❤️'),'🔥 ❤️'));
 check('daily key unique',()=>assert.equal(h.taskId('2026-10-08','id:5'),'2026-10-08|id:5'));
 check('global settings isolated namespace',()=>{h.gmSet('abc','ok');assert.equal(store.get('spark-full:v2:abc'),'ok')});
 check('fixed plan persisted',()=>{
   const p=h.choosePlan('2026-10-08');assert.equal(new Date(p.when).getHours(),20);assert.equal(new Date(p.when).getMinutes(),30);
   assert.equal(h.choosePlan('2026-10-08').when,p.when);
 });
 check('random plan respects time range',()=>{
   h.state.settings.sendTimeRandom=true;h.state.settings.sendTimeRangeStart='21:00';h.state.settings.sendTimeRangeEnd='23:00';
   const p=h.choosePlan('2026-10-09');const t=new Date(p.when);assert.equal(t.getDate(),9);assert.ok(t.getHours()>=21&&t.getHours()<=23);
 });
 check('midnight random window crosses day',()=>{
   h.state.settings.sendTimeRangeStart='23:30';h.state.settings.sendTimeRangeEnd='00:30';
   const p=h.choosePlan('2026-10-10');const when=new Date(p.when);
   const lo=new Date('2026-10-10T23:30:00').getTime(),hi=new Date('2026-10-11T00:30:00').getTime();
   assert.ok(when.getTime()>=lo&&when.getTime()<hi);
 });
 check('random item cycle preserves index',()=>{
   assert.equal(h.pickVariant('test-cycle',['a','b'],false,true),'a');assert.equal(h.pickVariant('test-cycle',['a','b'],false,true),'b');assert.equal(h.pickVariant('test-cycle',['a','b'],false,true),'a');
 });
 check('preview does not consume variant state',()=>{
   const before=store.get('spark-full:v2:variants:test-preview');
   assert.equal(h.pickVariant('test-preview',['a'],false,false),'a');
   assert.equal(store.get('spark-full:v2:variants:test-preview'),before);
 });
 check('contact fire days local override',()=>{
   h.state.contacts.set('id:x',{key:'id:x',name:'测试好友',days:40});h.setFireDays('id:x',46);
   assert.equal(h.getFireDays(h.state.contacts.get('id:x')),46);
 });
 check('template replaces basic placeholders',()=>{
   h.state.settings.useHitokoto=false;h.state.settings.useTxtApi=false;h.state.settings.useSpecialHitokoto=false;
   h.state.settings.message='你好 [昵称] | 火花 [天数] | [日期]';
 });
 await ac('template generated with name and days',async()=>{
   const msg=await h.buildMessage(h.state.contacts.get('id:x'));assert.match(msg,/测试好友/);assert.match(msg,/46/);assert.doesNotMatch(msg,/\[天数\]/);
 });
 await ac('hitokoto API formatter',async()=>{
   h.state.settings.useHitokoto=true;h.state.settings.hitokotoFormat='{hitokoto}——{from}{from_who}';h.state.settings.message='[API]';
   const msg=await h.buildMessage(h.state.contacts.get('id:x'));assert.match(msg,/明天会更好/);assert.match(msg,/纸上/);
 });
 await ac('TXT local text template',async()=>{
   h.state.settings.useHitokoto=false;h.state.settings.useTxtApi=true;h.state.settings.txtApiMode='manual';h.state.settings.txtApiManualText='A\nB';h.state.settings.txtApiManualRandom=false;h.state.settings.message='[TXTAPI]';
   assert.equal(await h.buildMessage(h.state.contacts.get('id:x'),false),'A');
 });
 await ac('weekday message',async()=>{
   h.state.settings.useTxtApi=false;h.state.settings.useSpecialHitokoto=true;h.state.settings.message='[专属一言]';
   h.state.settings['specialHitokoto'+['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()]]='祝你好运';
   assert.equal(await h.buildMessage(h.state.contacts.get('id:x')),'祝你好运');
 });
 check('pre-send failure obeys backoff and retry',()=>{
   h.state.settings.maxRetryCount=3;h.markPreSendFailure('id:x','test');assert.equal(h.mayRetry('id:x'),false);
   const id=h.taskId(h.isoDay(),'id:x');h.state.tasks[id].nextRetryAt=Date.now()-1000;assert.equal(h.mayRetry('id:x'),true);
 });
 check('unknown task cannot auto retry',()=>{
   const id=h.taskId(h.isoDay(),'id:x');h.state.tasks[id]={status:'UNKNOWN'};assert.equal(h.mayRetry('id:x'),false);
 });
 check('known today outcomes counted',()=>{
   const today=h.isoDay();h.state.selected.add('id:x');h.state.tasks[h.taskId(today,'id:x')]={status:'UNKNOWN'};
   const out=h.todayOutcome();assert.equal(out.total,1);assert.equal(out.unknown,1);
 });
 console.log(`RESULT ${n}/${n} PASS`);
})().catch(e=>{console.error('FAIL',e);process.exitCode=1});
