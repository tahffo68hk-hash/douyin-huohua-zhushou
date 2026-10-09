'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.resolve(__dirname,'../douyin-spark-full.user.js'),'utf8');
const ns='spark-full:v2:',store=new Map([
  [ns+'migrated-v03',true],[ns+'migrated-v04',true],[ns+'migrated-v05',true],[ns+'migrated-v051',true],
  [ns+'settings',{autoEnabled:true}],
  [ns+'contacts',[
    {key:'id:legacy-contact-01',name:'Fixture Person A',stable:true,type:'PERSON'},
    {key:'provisional:fixture-only',name:'Fixture Person B',stable:false,type:'PERSON'}
  ]]
]);
const window={__SPARK_FULL_TEST_MODE__:true};
const context={window,document:{visibilityState:'visible'},location:{href:'https://www.douyin.com/chat',pathname:'/chat'},
  GM_getValue:(k,f)=>store.has(k)?store.get(k):f,GM_setValue:(k,v)=>store.set(k,v),console,Date,Map,Set,URL,Promise,Math,setTimeout,clearTimeout};
vm.createContext(context);vm.runInContext(source,context);
const h=window.__SPARK_FULL_TEST_HOOKS__;
assert.equal(h.version,'0.5.2');
assert.equal(h.buildId,'v052-idproof-20261009-r1');
assert.equal(h.state.settings.autoEnabled,false);
assert.equal(store.get(ns+'migrated-v052'),true);
const legacy=h.state.contacts.get('id:legacy-contact-01');
assert.equal(legacy.conversationStableId,'legacy-contact-01');
assert.equal(legacy.verificationState,'UNVERIFIED');
assert.equal(legacy.identityEvidence,null);
assert.equal(legacy.requiresReverify,true);
const provisional=h.state.contacts.get('provisional:fixture-only');
assert.equal(provisional.conversationStableId,null);
assert.equal(provisional.stable,false);
assert.equal(provisional.verificationState,'UNVERIFIED');
assert.equal(h.identityReadyForSend(provisional),false);
assert.equal(h.trustedForSchedule(legacy),false);
const imported=h.parseBackup(JSON.stringify({format:'spark-full-v2',settings:{},selected:['provisional:old-name'],
  contacts:[{key:'provisional:old-name',name:'Fixture Person C',stable:false,type:'PERSON'}]})).contacts[0];
assert.equal(imported.conversationStableId,null);
assert.equal(imported.verificationState,'UNVERIFIED');
assert.equal(imported.requiresReverify,true);
h.state.tasks[h.taskId(h.isoDay(),'fixture-unknown')]={status:'UNKNOWN'};
h.state.tasks[h.taskId(h.isoDay(),'fixture-submitted')]={status:'SUBMITTED'};
assert.equal(h.mayRetry('fixture-unknown'),false);
assert.equal(h.mayRetry('fixture-submitted'),false);
console.log('RESULT 13/13 PASS (V0.5.2 migration, import and send-gate unit checks)');
