'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(path.join(__dirname,'..','douyin-spark.user.js'),'utf8');
const NS='spark-full:v2:';
let pass=0,fail=0;
function test(name,fn){try{fn();pass++;console.log('PASS',name);}catch(e){fail++;console.error('FAIL',name,e.stack);}}
function setup(old={},throwAt=''){
  const values=new Map(Object.entries(old).map(([key,value])=>[NS+key,JSON.parse(JSON.stringify(value))]));
  const context={window:{__SPARK_SIMPLE_TEST_MODE__:true},document:{},console,URL,Date,Math,JSON,setTimeout,clearTimeout,
    GM_getValue:(k,d)=>values.has(k)?JSON.parse(JSON.stringify(values.get(k))):d,
    GM_setValue:(k,v)=>{if(throwAt&&k===NS+throwAt)throw Error('TEST WRITE FAIL');values.set(k,JSON.parse(JSON.stringify(v)));},
    GM_listValues:()=>[...values.keys()]};
  vm.runInNewContext(source,context,{filename:'spark-simple.user.js'});
  const h=context.window.__SPARK_SIMPLE_TEST_HOOKS__;
  return {h,values,read:key=>values.get(NS+key)};
}
function initial(){return {settings:{autoEnabled:true,riskAlertsEnabled:true,enableScriptBCallback:true,callbackToken:'SECRET',message:'[API] 专属消息'},
  contacts:[{key:'temp:alpha',name:'好友甲周日'},{key:'id:abc123',name:'同名'}],selected:['temp:alpha'],
  tasks:{'2026-10-09|temp:alpha':{status:'SUBMITTED',message:'旧消息'},'2026-10-09|id:abc123':{status:'UNKNOWN'}},
  materials:[{id:'text_00001',kind:'TEXT',title:'问候',content:'早安🔥',tags:'hi'},{id:'sticker_001',kind:'STICKER',title:'官方表情',content:'开心'}],
  isPaused:true,'plan:abc123':{enabled:true},'callback:abc':{callbackToken:'SECRET'}};}

test('v0.7 script metadata and local-only permissions',()=>{
  assert(source.includes('// @version      0.7.0'));
  assert(source.includes('v070-batch-plugins-20261009-r1'));
  assert(!source.includes('GM_xmlhttpRequest'));
  assert(!source.includes('// @connect'));
});
test('primary UI enables batch send and optional advanced modules',()=>{
  assert(source.includes('一键自动发送'));
  assert(source.includes('>今天</button>'));
  assert(source.includes('>高级</button>'));
  assert(source.includes('data-plugin="${key}"'));
  assert(!source.includes('setInterval('));
});
test('migration snapshots all raw keys before dropping runtime capability',()=>{
  const x=setup(initial()),state=x.h.migrate();
  assert.equal(state.paused,true);
  assert.equal(state.legacySnapshotComplete,true);
  assert.equal(state.draft,'续火🔥');
  assert.equal(x.read('simple:v1:legacy-snapshot').raw['plan:abc123'].enabled,true);
  assert.equal(x.read('simple:v1:legacy-snapshot').raw.contacts.length,2);
  assert.equal(x.read('simple:v1:legacy-snapshot').raw.materials.length,2);
  assert.equal(x.read('simple:v1:legacy-snapshot').raw.tasks['2026-10-09|temp:alpha'].status,'SUBMITTED');
  assert.equal(x.read('settings').autoEnabled,false);
  assert.equal(x.read('settings').enableScriptBCallback,false);
  assert.equal(x.read('settings').riskAlertsEnabled,false);
  assert.equal(x.read('simple:v1:migration'),'COMPLETE');
  assert.equal(state.materials.length,1);
  assert.equal(state.materials[0].id,'text_00001');
  assert.equal(state.legacyArchive.materials.length,2);
  assert(!state.savedStableChoices.length);
});
test('migration idempotent without duplicate materials',()=>{
  const x=setup(initial());const first=x.h.migrate();const before=x.read('simple:v1:legacy-snapshot');const second=x.h.migrate();
  assert.equal(second.materials.length,1);assert.equal(first.materials[0].id,second.materials[0].id);
  assert.deepEqual(x.read('simple:v1:legacy-snapshot'),before);
});
test('migration safely retries after temporary state write failure',()=>{
  const old=initial(),x=setup(old,'simple:v1:state');
  assert.throws(()=>x.h.migrate(),/TEST WRITE FAIL/);
  assert.equal(x.read('simple:v1:migration'),'SNAPSHOTTED');
  assert.equal(x.read('simple:v1:legacy-snapshot').raw.settings.callbackToken,'SECRET');
  assert.equal(x.read('settings').autoEnabled,false);
  const retry=setup(Object.fromEntries([...x.values].map(([k,v])=>[k.slice(NS.length),v])));
  assert.equal(retry.h.migrate().materials.length,1);
  assert.equal(retry.read('simple:v1:migration'),'COMPLETE');
});
test('legacy unchanged default becomes basic text, custom literal remains intact',()=>{
  assert.equal(setup().h.initialData({settings:{message:'早安🌞\n今天要开心'}}).draft,'早安🌞\n今天要开心');
  assert.equal(setup().h.initialData({settings:{message:'[API]'}}).draft,'续火🔥');
  assert.equal(setup().h.initialData({settings:{message:'[API]'}}).legacyArchive.settings.message,'[API]');
});
test('no-ID records do not become persistent association',()=>{
  const x=setup(initial()),v=x.h.migrate();
  assert.equal(v.savedStableChoices.length,0);
  assert.equal(v.legacyArchive.contacts[0].name,'好友甲周日');
  assert.equal(x.read('contacts')[0].key,'temp:alpha');
});
test('UNKNOWN/SUBMITTED task history retained; not inferred as success',()=>{
  const x=setup(initial());const migrated=x.h.migrate();
  assert.equal(migrated.legacyArchive.tasks['2026-10-09|temp:alpha'].status,'SUBMITTED');
  assert.equal(migrated.legacyArchive.tasks['2026-10-09|id:abc123'].status,'UNKNOWN');
  assert.equal(x.h.legacyTaskCounts(initial().tasks).pending,2);
});
test('legacy importer validates and does not reenable schedules',()=>{
  const h=setup().h;
  const json=JSON.stringify({format:'spark-full-v2',settings:{autoEnabled:true,message:'测试'},contacts:[{key:'tmp:a',name:'老用户'}],selected:['tmp:a'],materials:[{id:'text_12345',kind:'TEXT',title:'测试',content:'你好'}]});
  const p=h.parseImport(json);
  assert.equal(p.old,true);assert.equal(p.data.paused,true);assert.equal(p.data.savedStableChoices.length,0);
  assert.equal(p.data.materials.length,1);assert.equal(p.data.legacyArchive.settings.autoEnabled,true);
});
test('new backup excludes credentials and raw logs even deep nesting',()=>{
  const h=setup().h;
  const s=h.initialData(initial());s.legacyArchive.settings.callbackToken='veryprivate';s.legacyArchive.settings.nested={apiKey:'secret',notes:'hello'};
  const text=JSON.stringify(h.exportWhitelist(s,{}));
  for(const key of ['veryprivate','SECRET','apiKey','callbackToken','"logs"','"plan:abc123"'])assert(!text.includes(key),key);
  assert(text.includes('早安🔥'));assert(text.includes('contacts'));
});
test('backup rejects huge, malformed, oversize and unknown formats',()=>{
  const h=setup().h;
  assert.throws(()=>h.parseImport('x'.repeat(2_000_001)),/过大/);
  assert.throws(()=>h.parseImport('{bad'),SyntaxError);
  assert.throws(()=>h.parseImport(JSON.stringify({format:'unknown'})),/版本/);
  assert.throws(()=>h.parseImport(JSON.stringify({format:'spark-simple-v1',data:{draft:'x'.repeat(901),materials:[]}})),/格式|内容/);
});
test('manual record state UI semantics do not claim streak success',()=>{
  const h=setup().h;
  assert.equal(h.statusFor({dayStates:{'2026-10-09':{status:'CHECKED'}}},'2026-10-09'),'CHECKED');
  assert.equal(h.statusFor({dayStates:{'2026-10-09':{status:'CHECKED'}}},'2026-10-10'),'PENDING');
  assert(source.includes('不代表火花成功续上'));
});
test('only valid text/emoji reusable, sticker archived',()=>{
  const h=setup().h;
  assert.equal(h.materialFrom({id:'abcxyz',kind:'STICKER',content:'abc',title:'贴纸'}),null);
  assert.equal(h.materialFrom({id:'abcdef',kind:'EMOJI',content:'🔥',title:'Emoji'}).content,'🔥');
  assert.equal(h.materialFrom({id:'abcdef',kind:'TEXT',content:'x'.repeat(901),title:'大'}),null);
});
test('diagnostic export excludes target identity and message content',()=>{
  assert(source.includes("candidateCount:scan.length"));
  assert(!source.includes('diagnostic:run.candidates'));
  assert(source.includes('legacySnapshotComplete'));
});
test('copy button never calls send or mutates task ledger',()=>{
  assert(source.includes('await navigator.clipboard.writeText(text)'));
  assert(source.includes('No task.status changes on clipboard events'));
  assert(!source.includes('performSendEvent'));
});
test('no external link or private API in production user script',()=>{
  assert(!source.includes('fetch('));assert(!source.includes('XMLHttpRequest('));
  assert(!source.includes("'https://v1.hitokoto.cn"));
});
console.log(`CORE RESULT: ${pass} passed, ${fail} failed`);
if(fail)process.exit(1);
