const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.resolve(__dirname,'../douyin-spark-full.user.js'),'utf8');
const mem=new Map();
// Simulate an upgrade from V0.2 with automatic sending enabled and existing saved data.
mem.set('spark-full:v2:settings',{autoEnabled:true,collapsed:false,message:'保留我的消息',allowGroupManual:true});
mem.set('spark-full:v2:contacts',[{key:'id:existing',name:'既有好友',type:'PERSON',stable:true}]);
const window={__SPARK_FULL_TEST_MODE__:true};
const ctx={window,GM_getValue:(k,v)=>mem.has(k)?mem.get(k):v,GM_setValue:(k,v)=>mem.set(k,v),console,Date,Map,Set,URL,Promise,Math,setTimeout,clearTimeout};
vm.createContext(ctx);vm.runInContext(code,ctx);
const h=window.__SPARK_FULL_TEST_HOOKS__;
let passed=0;
const test=(name,fn)=>{fn();passed++;console.log('PASS',name)};
const node=(className,txt,attrs={})=>({className,innerText:txt,textContent:txt,isConnected:true,getClientRects:()=>[{}],getAttribute:(k)=>attrs[k]??null,querySelector:()=>null});
const setDom=(header,rows=[],msgs=[])=>{
 ctx.document={querySelector:(s)=>s.includes('RightPanel')?header:null,querySelectorAll:(s)=>s.includes('conversation-item')?rows:s.includes('conversationConversation')?rows:s.includes('MessageItem')||s.includes('message-item')||s.includes('messageMessageItem')?msgs:[]};
 ctx.navigator={locks:{request(){}}};ctx.location={pathname:'/chat'};
};
test('migration pauses automation and keeps old settings',()=>{assert.equal(h.state.settings.autoEnabled,false);assert.equal(h.state.settings.message,'保留我的消息');assert.equal(h.state.settings.collapsed,false);assert.equal(mem.get('spark-full:v2:migrated-v03'),true)});
test('migration retains previously saved contacts',()=>assert.equal(h.state.contacts.get('id:existing').name,'既有好友'));
test('unknown type remains unknown',()=>assert.equal(h.classify({rowText:'群聊很多，今天真开心'}),'UNKNOWN'));
test('structural group classification supports data attributes',()=>assert.equal(h.classify({attrs:'data-type group'}),'GROUP'));
test('streak count cannot erase rekindle alert',()=>assert.equal(h.classifySpark({days:99,text:'点击重燃 99'}),'NEEDS_REKINDLE'));
test('arbitrary text containing rekindle is not interpreted active',()=>assert.equal(h.classifySpark({days:30,text:'重燃'}),'REKINDLE_UNCERTAIN'));
test('schedule requires verified stable ID evidence, person, nonambiguous',()=>{
 const verified={stable:true,conversationStableId:'sample123',verificationState:'VERIFIED',identityEvidence:{type:'stable-id-equality',sources:['selected-row','current-chat-area'],attributes:['data-conversation-id']},type:'PERSON',ambiguous:false,requiresReverify:false};
 assert.equal(h.trustedForSchedule({stable:false,type:'PERSON',verifiedAt:Date.now()}),false);
 assert.equal(h.trustedForSchedule({...verified,type:'GROUP'}),false);
 assert.equal(h.trustedForSchedule({...verified,ambiguous:true}),false);
 assert.equal(h.trustedForSchedule({...verified,verificationState:'UNVERIFIED'}),false);
 assert.equal(h.trustedForSchedule(verified),true);
});
test('extractId refuses nontrivial hostile values',()=>{
 const bad={getAttribute:k=>k==='data-conversation-id'?'foo/bar<script>':null,querySelector:()=>null};
 assert.equal(h.extractId(bad),'');
});
test('outgoing needs explicit direction marker',()=>{
 assert.equal(h.isOutgoing(node('messageMessageItem bright','今天好')),false);
 assert.equal(h.isOutgoing(node('messageMessageItem outgoing','今天好')),true);
 assert.equal(h.isOutgoing(node('messageMessageItem','今天好',{'data-is-self':'true'})),true);
});
test('existing same outgoing text does not count as new send',()=>{
 const header=node('RightPanelHeadertitleContainer','既有好友');
 const m=node('messageMessageItem outgoing','你好🔥');const messages=[m];setDom(header,[],messages);
 const snap=h.snapshotMessages();assert.equal(h.confirmedOutgoing(snap,'你好🔥'),false);
 const remounted=node('messageMessageItem outgoing','你好🔥');messages.splice(0,1,remounted);
 assert.equal(h.confirmedOutgoing(snap,'你好🔥'),false);
 messages.push(node('messageMessageItem outgoing','你好🔥'));assert.equal(h.confirmedOutgoing(snap,'你好🔥'),true);
});
test('substring of an outgoing message does not confirm send',()=>{
 const header=node('RightPanelHeadertitleContainer','既有好友');const messages=[];setDom(header,[],messages);
 const snap=h.snapshotMessages();messages.push(node('messageMessageItem outgoing','你好🔥 这是旧消息附加更多内容'));
 assert.equal(h.confirmedOutgoing(snap,'你好🔥'),false);
});
test('selected row alone cannot validate without detail stable ID',()=>{
 const header=node('RightPanelHeadertitleContainer','小林 · 火花');
 const row=node('conversationConversationItemwrapper active','小林',{'data-conversation-id':'c0123','aria-selected':'true'});
 setDom(header,[row],[]);
 const c={key:'id:c0123',name:'Fixture A',displayName:'Fixture A',conversationStableId:'c0123',stable:true,type:'PERSON'};h.state.contacts.set(c.key,c);
 assert.equal(h.verifyOpenConversation(c,true),false);
});
test('missing detail IDs remain blocked even if display labels match',()=>{
 const header=node('RightPanelHeadertitleContainer','小林 · 火花');
 const row=node('conversationConversationItemwrapper active','小林',{'data-conversation-id':'c0999','aria-selected':'true'});setDom(header,[row],[]);
 assert.equal(h.verifyOpenConversation(h.state.contacts.get('id:c0123'),true),false);
});
test('strict validation rejects missing active ID',()=>{
 setDom(node('RightPanelHeadertitleContainer','小林 · 火花'),[],[]);
 assert.equal(h.verifyOpenConversation(h.state.contacts.get('id:c0123'),true),false);
});
test('same display labels cannot replace missing detail ID evidence',()=>{
 const header=node('RightPanelHeadertitleContainer','小林 · 火花');
 const row=node('conversationConversationItemwrapper active','小林',{'data-conversation-id':'c0123','aria-selected':'true'});setDom(header,[row],[]);
 h.state.contacts.set('id:other',{key:'id:other',name:'Fixture A',type:'PERSON',conversationStableId:'other234'});
 assert.equal(h.verifyOpenConversation(h.state.contacts.get('id:c0123'),true),false);
});
test('diagnostics omit names, message templates and tokens',()=>{
 const report=JSON.stringify(h.safeDiagnostics());
 assert.equal(report.includes('既有好友'),false);assert.equal(report.includes('保留我的消息'),false);
 assert.equal(report.includes('id:c0123'),false);assert.equal(report.includes('callbackToken'),false);
 assert.ok(report.includes('checkedAt'));
});
console.log(`RESULT ${passed}/${passed} PASS`);
