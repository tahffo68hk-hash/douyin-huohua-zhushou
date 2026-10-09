// ==UserScript==
// @name         抖音续火助手 · 轻量手动版
// @namespace    spark-full-local-userscript
// @version      0.6.0
// @description  简单的聊天处理清单：选聊天、写内容、复制、到抖音发送并人工核对。不会自动发消息。
// @author       Spark Full contributors
// @match        https://www.douyin.com/chat*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_registerMenuCommand
// @license      MIT
// ==/UserScript==
(function () {
  'use strict';
  const NS = 'spark-full:v2:';
  const VERSION = '0.6.0';
  const BUILD_ID = 'v060-simple-manual-20261009-r1';
  const SCHEMA_KEY = 'simple:v1:state';
  const MIGRATION_KEY = 'simple:v1:migration';
  const SNAPSHOT_KEY = 'simple:v1:legacy-snapshot';
  const RESTORE_SNAPSHOT_KEY = 'simple:v1:before-restore';
  const DEFAULT_TEXT = '续火🔥';
  const LEGACY_DEFAULT = '—————每日续火—————\n[TXTAPI]\n\n—————每日一言—————\n[API]\n\n—————专属一言—————\n[专属一言]\n\n🔥 火花已续 [天数] 天';
  const MAX_MATERIALS = 150, MAX_CONTENT = 900, MAX_BACKUP = 2_000_000;
  const SEL = {
    rows: '[data-e2e="conversation-item"],[class*="conversationConversationItemwrapper"],[class*="ConversationItemwrapper"]',
    titles: ['.conversationConversationItemtitle','[class*="ConversationItemtitle"]:not([class*="titleWrapper"]):not([class*="TitleWrapper"])','[data-e2e="conversation-title"]'],
    header: '[class*="RightPanelHeadertitleContainer"],[class*="RightPanelHeader"]',
    editor: 'div[data-slate-editor="true"][contenteditable="true"],div[contenteditable="true"][data-slate-editor]'
  };
  const KEY_NAMES = ['settings','contacts','selected','tasks','materials','contactRules','fireDaysByContact','logs','alerts','isPaused','migrated-v03','migrated-v04','migrated-v05','migrated-v051','migrated-v052','migrated-v053'];
  const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const clone = v => JSON.parse(JSON.stringify(v));
  const deepEq = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
  const dayNow = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const cleanName = s => String(s ?? '').replace(/\s+/g,' ').trim();
  const disabledSettings = x => ({...(isRecord(x)?x:{}),autoEnabled:false,enableScriptBCallback:false,riskAlertsEnabled:false,failureAlertsEnabled:false,unknownAlertsEnabled:false,autoAllowVerifiedNoId:false});
  const secretKey = k => /(?:token|secret|passw|cookie|credential|sessionauth|api.?key|authorization)/i.test(k);
  const sanitize = (value,depth=0) => {
    if(depth>15)return null;
    if(Array.isArray(value))return value.slice(0,2000).map(v=>sanitize(v,depth+1));
    if(!isRecord(value))return value;
    return Object.fromEntries(Object.entries(value).filter(([k])=>!secretKey(k) && !/^(?:node|element|dom|html)$/i.test(k)).map(([k,v])=>[k,sanitize(v,depth+1)]));
  };
  const storage = {
    get(key, fallback=null) {
      try {if(typeof GM_getValue==='function') return GM_getValue(NS+key, fallback);
        const v=localStorage.getItem(NS+key);return v===null?fallback:JSON.parse(v);
      }catch(e){throw Error(`无法读取本地数据：${key} (${String(e.message).slice(0,80)})`);}
    },
    set(key,val) {
      if(typeof GM_setValue==='function') GM_setValue(NS+key,clone(val));
      else localStorage.setItem(NS+key,JSON.stringify(val));
      if(!deepEq(this.get(key),val))throw Error(`本地数据写入校验失败：${key}`);
    },
    keys(){
      if(typeof GM_listValues==='function')return {keys:GM_listValues().filter(k=>k.startsWith(NS)&&!k.includes('simple:v1:')).map(k=>k.slice(NS.length)),complete:true};
      // Older userscript managers may not have enumeration support; state this explicitly.
      return {keys:KEY_NAMES.filter(k=>this.get(k,null)!==null),complete:false};
    }
  };
  const materialFrom = m => {
    if(!isRecord(m)||!['TEXT','EMOJI'].includes(m.kind)||typeof m.content!=='string')return null;
    const c=m.content.trim();if(!c||c.length>MAX_CONTENT)return null;
    const id=typeof m.id==='string' && /^[a-zA-Z0-9_-]{5,90}$/.test(m.id)?m.id:`manual_${Date.now()}_${Math.random().toString(36).slice(2,9)}`;
    return {id,kind:m.kind,content:c,title:cleanName(m.title||c.split('\n')[0]).slice(0,60)||'常用内容',tags:String(m.tags||'').slice(0,100)};
  };
  const sourceIsSimple = str => typeof str==='string' && !/(?:\[(?:API|TXTAPI|专属一言|天数)\]|\{(?:hitokoto|from_who|from)\})/i.test(str);
  const initialData = raw => {
    const s=isRecord(raw.settings)?raw.settings:{};
    const original=typeof s.message==='string'?s.message:DEFAULT_TEXT;
    const draft=original===LEGACY_DEFAULT||!sourceIsSimple(original)||original.length>MAX_CONTENT?'续火🔥':original;
    const archive=isRecord(raw)?sanitize(raw):{};
    return {schema:1,day:dayNow(),draft,paused:!!raw.isPaused,materials:(Array.isArray(raw.materials)?raw.materials:[]).map(materialFrom).filter(Boolean).slice(0,MAX_MATERIALS),
      daily:{},manualChecks:{},legacyArchive:archive,legacySnapshotComplete:!!raw.__complete,legacyDataNotice:original!==LEGACY_DEFAULT&&original!==draft?'旧版动态文案已归档，请到设置导出查看。':'',
      // Only stable IDs may survive refresh. Legacy names or provisional keys NEVER become identity evidence.
      savedStableChoices:[],ui:{collapsed:true,tab:'today'}};
  };
  const loadState = () => {
    const prev=storage.get(SCHEMA_KEY,null);
    if(isRecord(prev)&&prev.schema===1)return prev;
    return null;
  };
  const migrate = () => {
    const flag=storage.get(MIGRATION_KEY,null);
    if(flag==='COMPLETE'){
      const v=loadState();if(!v)throw Error('轻量版数据不完整，请保留旧数据并重新加载');
      // Ensure older configuration cannot silently re-arm after a downgrade/reinstall.
      storage.set('settings',disabledSettings(storage.get('settings',{})));return v;
    }
    // Snapshot happens BEFORE reading any normalized legacy contact list, to avoid missing no-ID names.
    let snapshot=storage.get(SNAPSHOT_KEY,null);
    if(!snapshot){
      const enumerated=storage.keys(),original={__complete:enumerated.complete};
      for(const k of enumerated.keys)original[k]=storage.get(k,null);
      snapshot={createdAt:new Date().toISOString(),complete:enumerated.complete,raw:original};
      storage.set(SNAPSHOT_KEY,snapshot);
      storage.set(MIGRATION_KEY,'SNAPSHOTTED');
    }
    const original=snapshot.raw;
    // Disable old executor settings even in downgrade. No timer or executor exists in this new script.
    storage.set('settings',disabledSettings(original.settings));
    const state=loadState()||initialData(original);
    storage.set(SCHEMA_KEY,state);
    storage.set(MIGRATION_KEY,'COMPLETE');
    return state;
  };
  const normalized = s => {
    if(!isRecord(s)||s.schema!==1)throw Error('不支持的数据格式');
    const data={...s,ui:isRecord(s.ui)?s.ui:{collapsed:true,tab:'today'}};
    data.paused=!!s.paused;data.draft=typeof s.draft==='string'?s.draft:DEFAULT_TEXT;
    data.materials=(Array.isArray(s.materials)?s.materials:[]).map(materialFrom).filter(Boolean).slice(0,MAX_MATERIALS);
    data.daily=isRecord(s.daily)?s.daily:{};data.manualChecks=isRecord(s.manualChecks)?s.manualChecks:{};
    data.savedStableChoices=[];data.legacyArchive=isRecord(s.legacyArchive)?s.legacyArchive:{};
    data.ui.tab=['today','settings'].includes(data.ui.tab)?data.ui.tab:'today';
    // Current-page no-ID selections are NEVER persisted.
    return data;
  };
  // Read-only selectors adapted from V0.5.3, with time/date sibling nodes excluded.
  const visible = n => Boolean(n&&n.isConnected&&n.getClientRects().length);
  const first = (scope,selectors) => {
    for(const sel of selectors){try{const found=scope?.querySelector(sel);if(found)return found;}catch(_){/* CSS changed */}}
    return null;
  };
  const nameNode = root => {
    if(!root)return null;
    const specific=first(root,['[data-e2e*="nickname"]','[class*="nickname"]','[class*="Nickname"]','[class*="userName"]','[class*="UserName"]']);
    if(specific){const t=cleanName(specific.textContent);if(t&&t.length<=120)return specific;}
    const all=[];
    const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
    while(walker.nextNode()){
      const n=walker.currentNode,p=n.parentElement,t=cleanName(n.nodeValue);
      if(!p||!t||t.length>120)continue;
      let el=p,skip=false;
      while(el&&el!==root.parentElement){const cls=String(el.className||'');if(el.tagName==='TIME'||el.hasAttribute('datetime')||/(?:date|time|weekday|timestamp)/i.test(cls)){skip=true;break;}el=el.parentElement;}
      if(!skip)all.push({n:p,t});
    }
    return all.sort((a,b)=>b.t.length-a.t.length)[0]?.n||null;
  };
  const conversationType = row => {
    const attrs=['data-conversation-type','data-chat-type','data-type','aria-label','title'].map(k=>`${k}:${row.getAttribute(k)||''}`).join(' ');
    const ctx=(String(row.className||'')+' '+attrs).toLowerCase();
    if(/(?:group[-_ ]?chat|conversation[-_ ]?group|群聊|群成员)/.test(ctx))return 'GROUP';
    if(/(?:person[-_ ]?chat|conversation[-_ ]?single|单聊|私聊)/.test(ctx))return 'PERSON';
    const groups=row.querySelectorAll('.commonConversationIconnoDrag');
    const avatars=row.querySelectorAll('.commonIMAvataravatarContainer');
    if(groups.length===1&&avatars.length===0)return 'GROUP';
    if(groups.length===0&&avatars.length===1&&avatars[0].querySelector('img'))return 'PERSON';
    return 'UNKNOWN';
  };
  const ID_ATTRS=['data-conversation-id','data-chat-id','data-session-id','data-conversation-key'];
  const idFromRow = row => {
    const ids=new Set();let node=row;
    for(let depth=0;node&&depth<4;depth++,node=node.parentElement){
      if(node===document.body||node.matches?.(SEL.rows)===false&&node.querySelectorAll?.(SEL.rows).length>1)break;
      for(const k of ID_ATTRS){const v=node.getAttribute(k);if(v&&/^[\w:\-.]{3,180}$/.test(v))ids.add(v);}
    }
    return ids.size===1?[...ids][0]:null;
  };
  let scanSerial=0;
  const weakKeys=new WeakMap();
  const pageSalt=`page_${Math.random().toString(36).slice(2)}`;
  const scanCandidates = () => {
    const rows=[...document.querySelectorAll(SEL.rows)],items=[];
    const counts=new Map();
    for(const row of rows){
      const title=first(row,SEL.titles),n=nameNode(title),name=cleanName(n?.textContent||'');
      if(!name)continue;
      const id=idFromRow(row);
      if(!weakKeys.has(row))weakKeys.set(row,`${pageSalt}_${++scanSerial}`);
      const key=id?`id:${id}`:`temp:${weakKeys.get(row)}`;
      const type=conversationType(row);
      const item={key,name,type,stableId:id,ambiguous:false,online:visible(row),node:row};
      items.push(item);counts.set(key,(counts.get(key)||0)+1);
    }
    for(const it of items)if(counts.get(it.key)>1)it.ambiguous=true;
    return items;
  };
  const legacyTaskCounts = tasks => {
    const rows=Object.entries(isRecord(tasks)?tasks:{}).filter(([k,v])=>k.startsWith(dayNow()+'|')&&isRecord(v));
    return rows.reduce((a,[,v])=>{if(['SUBMITTED','UNKNOWN'].includes(v.status))a.pending++;return a;},{pending:0});
  };
  const statusFor = (item,day=dayNow()) => {
    const v=item?.dayStates?.[day];return v?.status||'PENDING';
  };
  const statusLabel = s => ({PENDING:'待处理',SKIPPED:'今天跳过',CHECKED:'你已核对消息',UNCERTAIN:'消息待核对'}[s]||'待处理');
  const UI_CSS = `
    :host{all:initial;color-scheme:light;font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;--ink:#182538;--sub:#617184;--line:#e4e9f0;--blue:#2563eb;--paper:#fff;--bg:#f7f9fc}
    *{box-sizing:border-box}button,input,textarea{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.55}
    .chip{position:fixed;right:22px;bottom:22px;border:1px solid #d4dae6;background:#172c46;color:#fff;border-radius:100px;padding:12px 17px;box-shadow:0 10px 25px #142d4b3d;font-size:13px;font-weight:700;z-index:2147483646;max-width:250px;touch-action:none}
    .panel{position:fixed;bottom:76px;right:20px;width:370px;max-width:calc(100vw - 16px);height:min(650px,calc(100vh - 92px));min-height:310px;border:1px solid #e0e6ef;background:var(--paper);border-radius:16px;box-shadow:0 22px 70px #102b4433;z-index:2147483646;overflow:hidden;display:flex;flex-direction:column;color:var(--ink);font-size:13px}
    .top{padding:13px 16px 8px;touch-action:none;cursor:grab;display:flex;align-items:center;justify-content:space-between;gap:8px}.top strong{font-size:16px;letter-spacing:.2px}.nav{display:grid;grid-template-columns:1fr 1fr;padding:5px 16px 10px;gap:6px;border-bottom:1px solid var(--line)}.nav button{padding:8px;border:0;background:#f0f3f7;border-radius:9px;color:#506174}.nav button[aria-selected=true]{background:#e9f0ff;color:#1b51bb;font-weight:700}
    .body{overflow:auto;min-height:0;padding:13px 15px 18px;overscroll-behavior:contain}.hint{font-size:12px;line-height:1.5;background:#f1f6ff;border:1px solid #e5edff;padding:10px 11px;border-radius:10px;color:#496081;margin-bottom:12px}.muted{font-size:12px;color:var(--sub);line-height:1.5}.meta{font-size:11px;color:var(--sub)}
    .metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0 15px}.metric{background:var(--bg);border-radius:10px;text-align:center;padding:9px 3px}.metric b{display:block;font-size:19px}.metric span{font-size:11px;color:var(--sub)}
    .section{margin-top:13px}.section-title{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.section-title strong{font-size:14px}
    .primary{border:0;background:var(--blue);color:white;border-radius:9px;padding:10px 13px;font-weight:600;min-height:36px}.secondary{background:#fff;border:1px solid #dce4ee;color:var(--ink);border-radius:9px;padding:8px 10px;min-height:34px}.ghost{border:0;background:transparent;color:#42639b;padding:7px 8px;border-radius:8px}.tiny{font-size:12px;padding:6px 8px;min-height:31px}.wide{width:100%;margin-top:10px}.row{display:flex;align-items:center;justify-content:space-between;gap:7px}.stack{display:flex;flex-direction:column;gap:8px}
    .contact{border:1px solid var(--line);border-radius:10px;padding:9px 8px;margin:6px 0;display:flex;align-items:center;gap:8px}.contact.selected{border-color:#a9c4fc;background:#f5f8ff}.info{min-width:0;flex:1}.truncate{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;display:block}.state{font-size:11px;color:#65758a}.state.problem{color:#a45317}.state.good{color:#14826b}
    .filters{display:flex;gap:5px}.filters button{font-size:11px;padding:6px 8px;border:1px solid #e1e6ee;border-radius:16px;background:white;color:#51647c}.filters button[aria-pressed=true]{background:#e9f0ff;color:#1a50a9;border-color:#bad0ff}
    textarea{display:block;width:100%;border:1px solid #cfd8e6;border-radius:10px;min-height:86px;padding:11px;background:#fff;color:var(--ink);font-size:14px;line-height:1.55;resize:vertical}textarea:focus,input:focus,button:focus-visible{outline:2px solid #719fff;outline-offset:1px}
    input{width:100%;padding:9px;border:1px solid #d6dfeb;border-radius:9px;color:var(--ink);background:white;font-size:13px}.emoji{display:flex;gap:5px;margin:8px 0}.emoji button{border:1px solid #e3e9f1;background:#fff;border-radius:8px;min-width:36px;min-height:32px}
    .drawer{position:absolute;inset:57px 0 0;background:#fff;z-index:2;display:flex;flex-direction:column;border-top:1px solid var(--line)}.drawerhead{padding:13px 16px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center}.drawerbody{padding:13px 15px;overflow:auto;flex:1}.badge{font-size:10px;border-radius:5px;padding:2px 5px;background:#f1f4f9;color:#63738a}.warning{background:#fff7e9;color:#875a16;padding:9px;border-radius:8px;font-size:12px}.empty{text-align:center;border:1px dashed #d8e1ec;border-radius:11px;padding:17px 8px;color:var(--sub)}.hr{height:1px;background:var(--line);margin:16px 0}
    .toast{position:absolute;left:12px;right:12px;bottom:10px;padding:9px 12px;background:#243851;color:#fff;border-radius:9px;box-shadow:0 4px 12px #1233;z-index:5;font-size:12px;pointer-events:none}.hidden{display:none!important}
    .help p{margin:7px 0;color:#5b6b7e;font-size:12px;line-height:1.55}
    @media(max-width:380px){.panel{right:8px;bottom:62px;height:min(580px,calc(100vh - 75px))}.chip{right:10px;bottom:10px}}
  `;
  const download = (filename,obj) => {
    const blob=new Blob([JSON.stringify(obj,null,2)],{type:'application/json;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  const exportWhitelist = (source,dayLog) => {
    const raw={format:'spark-simple-v1',version:VERSION,exportedAt:new Date().toISOString(),data:{schema:1,draft:source.draft,materials:clone(source.materials),paused:source.paused,
      manualChecks:sanitize(source.manualChecks), daily:sanitize(dayLog||{}),
      legacyArchive:{contacts:sanitize(source.legacyArchive.contacts||[]),selected:sanitize(source.legacyArchive.selected||[]),
        materials:sanitize(source.legacyArchive.materials||[]),settings:sanitize(source.legacyArchive.settings||{}),
        contactRules:sanitize(source.legacyArchive.contactRules||{}),fireDaysByContact:sanitize(source.legacyArchive.fireDaysByContact||{}),
        alerts:sanitize(source.legacyArchive.alerts||[]),tasks:sanitize(source.legacyArchive.tasks||{})}}};
    return sanitize(raw);
  };
  const parseImport = text => {
    if(typeof text!=='string'||text.length>MAX_BACKUP)throw Error('备份过大（最大 2 MB）');
    const x=JSON.parse(text);if(!isRecord(x))throw Error('备份文件格式错误');
    const old=x.format==='spark-full-v2';const lite=x.format==='spark-simple-v1';
    if(!old&&!lite)throw Error('不支持的备份版本');
    let data;
    if(old){
      if(!isRecord(x.settings)||!Array.isArray(x.contacts)||!Array.isArray(x.selected))throw Error('旧版备份结构错误');
      if(x.contacts.length>1000||x.selected.length>1000||(x.materials?.length||0)>MAX_MATERIALS)throw Error('备份内容超过限制');
      data=initialData({settings:x.settings,contacts:x.contacts,selected:x.selected,materials:x.materials||[],contactRules:x.contactRules||{},fireDaysByContact:x.fireDays||{},tasks:x.tasks||{},__complete:false,isPaused:true});
    }else{
      if(!isRecord(x.data)||!Array.isArray(x.data.materials)||x.data.materials.length>MAX_MATERIALS||typeof x.data.draft!=='string'||x.data.draft.length>MAX_CONTENT)throw Error('新版备份内容错误');
      data=normalized({...x.data,schema:1});
    }
    // NEVER grant identity, overwrite current frozen tasks, or revive legacy execution.
    data.savedStableChoices=[];data.paused=true;
    data.legacyArchive=sanitize(data.legacyArchive);
    return {old, data, materials:data.materials.length, archiveContactCount:(data.legacyArchive.contacts||[]).length};
  };
  const safeDiagnosis = ({scan,store}) => ({format:'spark-simple-diagnostic-v1',version:VERSION,buildId:BUILD_ID,date:dayNow(),
    listPresent:document.querySelectorAll(SEL.rows).length>0,headerPresent:!!document.querySelector(SEL.header),editorPresent:!!document.querySelector(SEL.editor),
    candidateCount:scan.length,stableCandidates:scan.filter(i=>!!i.stableId).length,types:{personal:scan.filter(i=>i.type==='PERSON').length,group:scan.filter(i=>i.type==='GROUP').length,unknown:scan.filter(i=>i.type==='UNKNOWN').length},
    legacySnapshotComplete:!!store.legacySnapshotComplete, // No names, identifiers, chats, text, or full URL.
    errors:[]});

  let model=null,host=null,shadow=null,panel=null,body=null,chip=null,notice=null;
  const run={tab:'today',open:false,drawer:'',filter:'ALL',search:'',candidates:[],items:new Map(),active:null,toast:'',copyStatus:'',restore:null,deleted:null,deletedTimeout:null,showLegacy:false,showSupport:false,legacyPending:0,warning:'',readOnly:false,suppressClick:false};
  const save = () => {storage.set(SCHEMA_KEY,{...model, savedStableChoices:[]});};
  const setToast = msg => {run.toast=msg;if(notice){notice.textContent=msg;notice.classList.toggle('hidden',!msg);}};
  const syncCandidates = () => {
    const candidates=scanCandidates();run.candidates=candidates;
    const visibleKeys=new Set(candidates.map(c=>c.key));
    // Existing provisional rows may have been recycled: do not attach old local checks to new names.
    for(const [key,it] of [...run.items]){
      if(key.startsWith('temp:') && (!visibleKeys.has(key)||!candidates.some(c=>c.key===key&&c.name===it.name))){run.items.delete(key);if(run.active===key)run.active=null;}
    }
    for(const c of candidates){const it=run.items.get(c.key);if(it){it.type=c.type;it.name=c.name;it.ambiguous=c.ambiguous;}}
    return candidates.length;
  };
  const currentStatus = it => {
    if(!it)return 'PENDING';
    if(it.day!==dayNow()){it.day=dayNow();it.status='PENDING';it.manualAt=null;}
    return it.status;
  };
  const counts = () => {
    const arr=[...run.items.values()];return {pending:arr.filter(i=>currentStatus(i)==='PENDING').length,checked:arr.filter(i=>currentStatus(i)==='CHECKED').length,uncertain:arr.filter(i=>currentStatus(i)==='UNCERTAIN').length};
  };
  const createItem = c => ({key:c.key,name:c.name,type:c.type,ambiguous:c.ambiguous,day:dayNow(),status:'PENDING',manualAt:null});
  const addCandidate = key => {
    const c=run.candidates.find(v=>v.key===key&&!v.ambiguous);
    if(!c){setToast('列表发生变化，请重新读取后选择');return;}
    if(c.type==='GROUP'){setToast('群聊不加入个人处理清单');return;}
    if(/(?:AI分身|智能体|AI助手)/i.test(c.name)){setToast('AI 会话不自动加入，请自行在官方聊天操作');return;}
    if(!run.items.has(key))run.items.set(key,createItem(c));
    run.active=key;run.drawer='';setToast('已加入今天，未发送任何消息');render();
  };
  const applyManualState = (it,status) => {
    if(!it)return;
    it.status=status;it.day=dayNow();it.manualAt=status==='CHECKED'?Date.now():null;
    // Preserve existing SUBMITTED/UNKNOWN/CONFIRMED ledger untouched.
    if(it.key.startsWith('id:')){
      model.manualChecks[it.key]??={};model.manualChecks[it.key][dayNow()]={status,at:Date.now(),source:'user-check-only'};save();
    }
    render();
  };
  const isPendingLegacy = () => run.legacyPending>0;
  const rowHtml = it => {
    const s=currentStatus(it),active=run.active===it.key;
    return `<div class="contact ${active?'selected':''}" data-local-row="${esc(it.key)}"><div class="info"><b class="truncate">${esc(it.name)}</b><div class="state ${s==='CHECKED'?'good':s==='UNCERTAIN'?'problem':''}">${esc(statusLabel(s))} ${it.type==='GROUP'?'· 群聊':it.type==='UNKNOWN'?'· 类型待核实':''}</div></div>
      <button class="secondary tiny" data-action="prepare" data-key="${esc(it.key)}">${s==='UNCERTAIN'?'查看聊天':'处理'}</button><button class="ghost tiny" data-action="row-more" data-key="${esc(it.key)}" aria-label="更多操作">⋯</button></div>${run.drawer==='more:'+it.key?`<div class="row" style="padding:4px 8px 10px;justify-content:flex-end"><button class="secondary tiny" data-action="${s==='SKIPPED'?'unskip':'skip'}" data-key="${esc(it.key)}">${s==='SKIPPED'?'撤销跳过':'今天跳过'}</button>${s==='CHECKED'?`<button class="secondary tiny" data-action="undo-check" data-key="${esc(it.key)}">撤销核对</button>`:''}<button class="secondary tiny" data-action="remove" data-key="${esc(it.key)}">移出清单</button></div>`:''}`;
  };
  const todayHtml = () => {
    const c=counts(),filtered=[...run.items.values()].filter(it=>run.filter==='ALL'||currentStatus(it)===run.filter),active=run.items.get(run.active);
    return `<div class="hint">手动处理 · 火花状态暂时无法可靠读取。复制后请在抖音聊天里自行发送、核对。</div>
      ${model.legacyDataNotice?`<div class="warning">${esc(model.legacyDataNotice)}</div>`:''}
      ${model.paused?'<div class="warning">旧版处于暂停状态，已保留；轻量版没有自动发送。</div>':''}
      <div class="metrics"><div class="metric"><b>${c.pending}</b><span>待处理</span></div><div class="metric"><b>${c.checked}</b><span>已核对</span></div><div class="metric"><b>${c.uncertain+run.legacyPending}</b><span>待核对</span></div></div>
      <div class="section-title"><strong>今天处理谁</strong><button class="secondary tiny" data-action="add-open">＋ 添加聊天</button></div>
      <div class="filters" role="group" aria-label="处理状态筛选">${[['ALL','全部'],['PENDING','待处理'],['UNCERTAIN','待核对'],['CHECKED','已核对']].map(([val,label])=>`<button data-action="filter" data-value="${val}" aria-pressed="${run.filter===val}">${label}</button>`).join('')}</div>
      ${filtered.length?filtered.map(rowHtml).join(''):`<div class="empty">${run.items.size?'该筛选暂无聊天':'今天还没选择要处理的人。'}<div style="margin-top:9px"><button class="secondary tiny" data-action="${run.items.size?'clear-filter':'add-open'}">${run.items.size?'显示全部':'添加聊天'}</button></div></div>`}
      ${isPendingLegacy()?`<div class="warning">历史任务中有 ${run.legacyPending} 项发送结果待核对。旧记录已保留，不会自动重新发送或按昵称认领。</div>`:''}
      <div class="hr"></div><div class="section-title"><strong>当前准备</strong>${active?`<span class="badge">${esc(active.type==='GROUP'?'群聊':active.type==='PERSON'?'个人':'类型待核实')}</span>`:''}</div>
      <div class="muted">${active?`<b>${esc(active.name)}</b> · 请在抖音左侧列表打开该聊天，核对顶部接收方。助手不会代替你切换聊天。`:'先添加一位聊天，再准备发送内容。'}</div>
      <div class="section"><div class="section-title"><strong>发送内容</strong><button class="ghost tiny" data-action="library-open">常用内容 ›</button></div>
      <label for="spark-final-draft" class="muted" style="display:block;margin-bottom:5px">复制即为最终正文，不会随机改变</label>
      <textarea id="spark-final-draft" maxlength="10000" spellcheck="true">${esc(model.draft)}</textarea>
      <div class="emoji">${['🔥','❤️','🫶','😊'].map(t=>`<button data-action="emoji" data-value="${t}" aria-label="插入 ${t}">${t}</button>`).join('')}</div>
      <div class="row"><span class="meta" id="spark-draft-counter">${model.draft.length}/${MAX_CONTENT} 字</span><span class="meta" id="spark-copy-state">${esc(run.copyStatus)}</span></div>
      <button class="primary wide" data-action="copy">复制内容</button>
      <p class="muted">原生表情请在抖音聊天框里选择。复制不等于发送，消息发出也不等于火花已续。</p>
      ${active?`<button class="secondary wide" data-action="check" ${active.status==='UNCERTAIN'?'':' '}>
        ${active.status==='CHECKED'?'已核对消息 ✓（可在更多里撤销）':'我已在聊天中核对新消息'}</button>`:''}</div>`;
  };
  const settingsHtml = () => `<div class="section-title"><strong>数据管理</strong></div><p class="muted">仅在你的浏览器本地保存。备份含好友名称和文案，请自行保管。</p>
    <div class="stack"><button class="secondary" data-action="export">导出安全备份</button><button class="secondary" data-action="import-open">导入备份并预览</button><input type="file" id="spark-import-file" accept=".json,application/json" hidden />
    <button class="ghost tiny" data-action="archive-toggle">${run.showLegacy?'收起旧数据说明':'查看旧版数据与迁移说明'}</button>${run.showLegacy?`<div class="warning">旧版原始记录已经在本机隔离保存。无ID好友不会按昵称自动关联。旧定时/回调/提醒已关闭，不再提供自动执行入口。${model.legacySnapshotComplete?'迁移时已枚举原命名空间全部键。':'该脚本管理器可能无法枚举全部动态键，旧原始键仍保持未删除。'}</div>`:''}</div>
    <div class="hr"></div><strong>使用方法</strong><div class="help"><p>① 今天 → 添加聊天 → 选择要处理的人。</p><p>② 写一条内容并复制，在抖音官方聊天框粘贴、发送。</p><p>③ 看到正确聊天里今天的新消息，再回助手点“我已核对”。</p></div>
    <div class="hr"></div><div class="section-title"><strong>关于</strong><span class="meta">V${VERSION}</span></div><p class="muted">轻量手动版 · ${BUILD_ID}</p>
    <button class="ghost tiny" data-action="support-toggle">${run.showSupport?'收起排查':'展开排查（脱敏）'}</button>${run.showSupport?`<div><p class="muted">排查文件只有结构计数与布尔状态，不含聊天内容、昵称或ID。</p><button class="secondary tiny" data-action="diagnostic">导出脱敏排查信息</button></div>`:''}
    ${run.restore?`<div class="hr"></div><div class="warning" role="status"><b>导入预览：${run.restore.old?'旧版 Full':'轻量版'}</b><div>有效常用内容：${run.restore.materials} 项；归档会话：${run.restore.archiveContactCount} 条。自动发送将保持关闭，旧身份不会授信。当前数据尚未更改。</div><div class="row" style="margin-top:10px"><button class="primary tiny" data-action="restore-yes">确认恢复</button><button class="secondary tiny" data-action="restore-cancel">取消</button></div></div>`:''}`;
  const drawerHtml = () => {
    if(run.drawer==='add'){
      const q=run.search.toLowerCase();const candidates=run.candidates.filter(x=>!q||x.name.toLowerCase().includes(q));
      return `<section class="drawer" aria-label="添加聊天"><div class="drawerhead"><strong>添加聊天</strong><button class="ghost" data-action="drawer-close">关闭</button></div><div class="drawerbody"><input id="spark-contact-search" placeholder="搜索聊天名称" value="${esc(run.search)}" aria-label="搜索聊天名称"/>
      <p class="muted">只展示当前网页能读取的聊天。无稳定 ID 时仅当前页面有效，刷新需要重新选择。群聊和 AI 分身不主动列入。</p>
      <div id="spark-drawer-results">${candidates.length?candidates.map(c=>`<div class="contact"><div class="info"><b class="truncate">${esc(c.name)}</b><span class="meta">${c.type==='PERSON'?'个人':c.type==='GROUP'?'群聊':'类型待核实'}${c.ambiguous?' · 记录重复':''}</span></div><button class="secondary tiny" data-action="add" data-key="${esc(c.key)}" ${run.items.has(c.key)||c.ambiguous||c.type==='GROUP'||/(?:AI分身|智能体|AI助手)/i.test(c.name)?'disabled':''}>${run.items.has(c.key)?'已加入':'添加'}</button></div>`).join(''):'<div class="empty">没找到对应的聊天。请先在抖音打开聊天列表。</div>'}</div>
      <button class="secondary wide" data-action="rescan">重新读取当前列表</button></div></section>`;
    }
    if(run.drawer==='library')return `<section class="drawer" aria-label="常用内容"><div class="drawerhead"><strong>常用内容</strong><button class="ghost" data-action="drawer-close">关闭</button></div><div class="drawerbody">
      <label for="spark-material-new" class="muted">新增一条常用文字</label><textarea id="spark-material-new" placeholder="输入文字或 Emoji" style="min-height:74px"></textarea><button class="primary wide" data-action="material-save">保存到常用内容</button>
      <p class="muted">当前 ${model.materials.length}/${MAX_MATERIALS} 项；原生表情名称仅存旧归档。</p>
      ${run.deleted?`<div class="warning">已删除「${esc(run.deleted.item.title)}」 <button class="ghost tiny" data-action="material-undo">5 秒内撤销</button></div>`:''}
      ${model.materials.map(x=>`<div class="contact"><div class="info"><b class="truncate">${esc(x.title)}</b><span class="meta truncate">${esc(x.content).replace(/\n/g,' · ')}</span></div><button class="secondary tiny" data-action="material-use" data-key="${esc(x.id)}">使用</button><button class="ghost tiny" data-action="material-delete" data-key="${esc(x.id)}">删除</button></div>`).join('')||'<div class="empty">还没有常用内容</div>'}</div></section>`;
    return '';
  };
  const clamp = (x,lo,hi) => Math.min(Math.max(x,lo),Math.max(lo,hi));
  const placeFloating = () => {
    if(!chip||!panel||!isRecord(model?.ui?.float))return;
    const pos=model.ui.float;
    const right=clamp(Number(pos.right)||0,8,Math.max(8,innerWidth-64));
    const bottom=clamp(Number(pos.bottom)||0,8,Math.max(8,innerHeight-60));
    chip.style.right=right+'px';chip.style.bottom=bottom+'px';
    panel.style.right=clamp(right,8,Math.max(8,innerWidth-panel.offsetWidth-8))+'px';
    const panelHeight=panel.getBoundingClientRect().height||Math.min(650,innerHeight-92);
    panel.style.bottom=clamp(bottom+chip.offsetHeight+10,8,Math.max(8,innerHeight-panelHeight-8))+'px';
  };
  const attachDragging = (target,allowed) => {
    let drag=null;
    target.addEventListener('pointerdown',e=>{
      if(e.button!==0||!allowed(e))return;
      const box=chip.getBoundingClientRect();
      drag={x:e.clientX,y:e.clientY,right:innerWidth-box.right,bottom:innerHeight-box.bottom,moved:false};
      try{target.setPointerCapture(e.pointerId);}catch(_){/* pointer capture optional */}
    });
    target.addEventListener('pointermove',e=>{
      if(!drag)return;
      const dx=e.clientX-drag.x,dy=e.clientY-drag.y;
      if(Math.hypot(dx,dy)>6)drag.moved=true;
      if(!drag.moved)return;
      model.ui.float={right:clamp(drag.right-dx,8,Math.max(8,innerWidth-64)),bottom:clamp(drag.bottom-dy,8,Math.max(8,innerHeight-60))};
      placeFloating();
    });
    const done=()=>{if(drag?.moved){run.suppressClick=true;save();}drag=null;};
    target.addEventListener('pointerup',done);target.addEventListener('pointercancel',done);
  };
  const render = () => {
    if(!host)return;
    const scroll=body?.scrollTop||0;
    chip.textContent='🔥 续火'+(counts().uncertain+run.legacyPending?` · ${counts().uncertain+run.legacyPending}待核对`:'');
    panel.classList.toggle('hidden',!run.open);if(!run.open)return;
    if(run.readOnly){panel.innerHTML=`<div class="top"><strong>迁移需要处理</strong><button class="ghost" data-action="collapse">收起</button></div><div class="body"><div class="warning">${esc(run.warning)}。未覆盖原数据、没有执行任何发送或通知。请检查 ScriptCat 存储权限，恢复后刷新页面。</div></div>`;return;}
    panel.innerHTML=`<div class="top"><strong>🔥 续火助手</strong><button class="ghost" data-action="collapse" aria-label="收起助手">收起 ↓</button></div><div class="nav" role="tablist" aria-label="助手页面"><button role="tab" aria-selected="${run.tab==='today'}" data-action="tab" data-value="today">今天</button><button role="tab" aria-selected="${run.tab==='settings'}" data-action="tab" data-value="settings">设置</button></div><main class="body" role="tabpanel">${run.tab==='today'?todayHtml():settingsHtml()}</main>${drawerHtml()}<div class="toast ${run.toast?'':'hidden'}" role="status" aria-live="polite">${esc(run.toast)}</div>`;
    body=panel.querySelector('.body');body.scrollTop=scroll;notice=panel.querySelector('.toast');placeFloating();
  };
  const confirmUserCheck = () => {
    const it=run.items.get(run.active);if(!it){setToast('请先选择要处理的聊天');return;}
    if(it.status==='CHECKED'){setToast('已经记录过核对，请从更多操作撤销');return;}
    if(window.confirm(`请确认：你已在抖音打开「${it.name}」，亲眼看见今天发送的新己方消息？\n\n这只是人工核对记录，不代表火花成功续上。`))applyManualState(it,'CHECKED');
  };
  const copyContent = async () => {
    const text=model.draft;
    if(!text.trim()){setToast('先输入要发送的内容');return;}
    if(text.length>MAX_CONTENT){setToast(`内容超过 ${MAX_CONTENT} 字，请修改后复制；原文已保留`);return;}
    try {
      if(!navigator.clipboard?.writeText)throw Error('Clipboard API unavailable');
      await navigator.clipboard.writeText(text);
      run.copyStatus='已复制 · 尚未发送';setToast('已复制！请在抖音聊天框粘贴、发送后核对');
    }catch(_){run.copyStatus='复制失败';setToast('复制未成功，请手动选择正文复制；没有发送消息');
      const textarea=panel.querySelector('#spark-final-draft');textarea?.focus();textarea?.select();}
    // No task.status changes on clipboard events.
    const s=panel.querySelector('#spark-copy-state');if(s)s.textContent=run.copyStatus;
  };
  const restore = () => {
    if(!run.restore)return;
    if(!window.confirm(`确定恢复备份？\n有效素材 ${run.restore.materials} 条。旧身份不会自动绑定，所有自动发送仍关闭。`))return;
    const old={...model};
    const backup=storage.get(RESTORE_SNAPSHOT_KEY,null);
    // Before overwrite, keep current lite state and raw old data safe.
    storage.set(RESTORE_SNAPSHOT_KEY,{createdAt:new Date().toISOString(),lite:clone(model),oldBackup:backup?{createdAt:backup.createdAt}:null});
    try{
      const draft=normalized(run.restore.data);
      draft.paused=old.paused;draft.ui={collapsed:false,tab:'settings'};
      draft.legacyArchive={...old.legacyArchive,...draft.legacyArchive};
      // Never import external task statuses over locally committed/unknown tasks.
      const localFrozen=isRecord(old.legacyArchive.tasks)?old.legacyArchive.tasks:{};
      const imported=isRecord(draft.legacyArchive.tasks)?draft.legacyArchive.tasks:{};
      draft.legacyArchive.tasks={...imported,...localFrozen};
      draft.manualChecks={...draft.manualChecks,...old.manualChecks};
      storage.set(SCHEMA_KEY,draft);storage.set('settings',disabledSettings(storage.get('settings',{})));
      model=draft;run.items.clear();run.active=null;run.restore=null;run.drawer='';run.open=true;run.tab='settings';setToast('恢复成功，自动发送关闭，请重新选择聊天');render();
    }catch(e){try{storage.set(SCHEMA_KEY,old);model=old;}catch(_){/* snapshot remains */}setToast('恢复失败，原数据已保留：'+String(e.message).slice(0,80));render();}
  };
  const onClick = event => {
    if(run.suppressClick){run.suppressClick=false;event.preventDefault();return;}
    if(run.readOnly){if(event.target.closest?.('[data-action="collapse"]')){run.open=false;render();}event.preventDefault();return;}
    const btn=event.target.closest?.('[data-action]');if(!btn)return;
    const act=btn.dataset.action,key=btn.dataset.key,val=btn.dataset.value;
    if(!act)return;event.preventDefault();
    switch(act){
      case 'collapse':run.open=false;run.drawer='';break;
      case 'tab':run.tab=val;run.drawer='';run.toast='';break;
      case 'add-open':syncCandidates();run.drawer='add';run.search='';break;
      case 'clear-filter':run.filter='ALL';break;
      case 'filter':run.filter=val;break;
      case 'drawer-close':run.drawer='';break;
      case 'rescan':syncCandidates();setToast('已重新读取当前可见会话，未发送任何消息');break;
      case 'add':addCandidate(key);break;
      case 'prepare':run.active=key;run.drawer='';run.copyStatus='';break;
      case 'row-more':run.drawer=run.drawer==='more:'+key?'':'more:'+key;break;
      case 'skip':applyManualState(run.items.get(key),'SKIPPED');run.drawer='';break;
      case 'unskip':applyManualState(run.items.get(key),'PENDING');run.drawer='';break;
      case 'undo-check':applyManualState(run.items.get(key),'PENDING');run.drawer='';setToast('仅撤销界面核对记录，历史提交状态仍保留');break;
      case 'remove':run.items.delete(key);if(run.active===key)run.active=null;run.drawer='';break;
      case 'emoji':{
        const ta=panel.querySelector('#spark-final-draft'),pos=ta?.selectionStart??model.draft.length;
        model.draft=model.draft.slice(0,pos)+val+model.draft.slice(pos);save();run.copyStatus='';render();
        const next=panel.querySelector('#spark-final-draft');if(next){next.focus();next.setSelectionRange(pos+val.length,pos+val.length);}return;
      }
      case 'copy':void copyContent();return;
      case 'check':confirmUserCheck();return;
      case 'library-open':run.drawer='library';run.toast='';break;
      case 'material-save':{
        const t=panel.querySelector('#spark-material-new')?.value||'';
        if(!t.trim()||t.length>MAX_CONTENT||model.materials.length>=MAX_MATERIALS){setToast('内容为空、超过900字或素材已满');return;}
        const id='manual_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
        model.materials.push({id,kind:'TEXT',content:t,title:cleanName(t.split('\n')[0]).slice(0,60),tags:''});save();setToast('已保存到常用内容');break;
      }
      case 'material-use':{const item=model.materials.find(v=>v.id===key);if(item){model.draft=item.content;save();run.drawer='';setToast('内容已放入编辑框，尚未发送');}break;}
      case 'material-delete':{
        const idx=model.materials.findIndex(m=>m.id===key);if(idx<0)return;
        const [item]=model.materials.splice(idx,1);run.deleted={item,idx};save();
        if(run.deletedTimeout)clearTimeout(run.deletedTimeout);
        const origin=run.deleted;run.deletedTimeout=setTimeout(()=>{if(run.deleted===origin){run.deleted=null;if(run.drawer==='library')render();}},5000);setToast('已删除常用内容，5秒内可撤销');break;
      }
      case 'material-undo':{
        if(run.deleted){model.materials.splice(run.deleted.idx,0,run.deleted.item);run.deleted=null;clearTimeout(run.deletedTimeout);save();setToast('已撤销删除');}break;
      }
      case 'archive-toggle':run.showLegacy=!run.showLegacy;break;
      case 'support-toggle':run.showSupport=!run.showSupport;break;
      case 'diagnostic':download(`spark-support-${dayNow()}.json`,safeDiagnosis({scan:run.candidates,store:model}));return;
      case 'export':download(`spark-simple-backup-${dayNow()}.json`,exportWhitelist(model,model.daily));return;
      case 'import-open':panel.querySelector('#spark-import-file')?.click();return;
      case 'restore-yes':restore();return;
      case 'restore-cancel':run.restore=null;setToast('已取消恢复，数据未更改');break;
      default:return;
    }
    render();
  };
  const onInput = e => {
    if(run.readOnly)return;
    if(e.target.id==='spark-final-draft'){
      model.draft=e.target.value;save();run.copyStatus='';
      const counter=panel.querySelector('#spark-draft-counter');if(counter)counter.textContent=`${model.draft.length}/${MAX_CONTENT} 字`;
      const st=panel.querySelector('#spark-copy-state');if(st)st.textContent='';
    }else if(e.target.id==='spark-contact-search'){
      run.search=e.target.value;
      // Render only the drawer's results, keeping focus/caret in its input.
      const target=panel.querySelector('#spark-drawer-results');if(!target)return;
      const v=run.search.toLowerCase();const items=run.candidates.filter(c=>c.name.toLowerCase().includes(v));
      target.innerHTML=items.map(c=>`<div class="contact"><div class="info"><b class="truncate">${esc(c.name)}</b><span class="meta">${c.type==='GROUP'?'群聊':c.type==='PERSON'?'个人':'类型待核实'}</span></div><button class="secondary tiny" data-action="add" data-key="${esc(c.key)}" ${run.items.has(c.key)||c.ambiguous||c.type==='GROUP'||/(?:AI分身|智能体|AI助手)/i.test(c.name)?'disabled':''}>${run.items.has(c.key)?'已加入':'添加'}</button></div>`).join('')||'<div class="empty">没有匹配的聊天</div>';
    }
  };
  const onFile = async e => {
    if(run.readOnly)return;
    if(e.target.id!=='spark-import-file'||!e.target.files?.length)return;
    const file=e.target.files[0];e.target.value='';
    try{run.restore=parseImport(await file.text());run.toast='';setToast('已读取备份预览，还没有修改数据');}
    catch(err){run.restore=null;setToast('无法读取备份：'+String(err.message).slice(0,90));}
    render();
  };
  const mount = () => {
    if(document.getElementById('spark-full-root'))return; // Avoid duplicate panel injection.
    try{
      model=normalized(migrate());
      run.legacyPending=legacyTaskCounts(model.legacyArchive.tasks||{}).pending;
      run.open=false;run.tab='today';syncCandidates();
    }catch(e){
      // Fail closed: no timers/executors. Show error; do not silently erase old data.
      model={schema:1,draft:DEFAULT_TEXT,materials:[],legacyArchive:{},legacySnapshotComplete:false,daily:{},manualChecks:{},ui:{},paused:true};
      run.warning='本地迁移暂未完成：'+String(e.message).slice(0,120);run.readOnly=true;
    }
    host=document.createElement('div');host.id='spark-full-root';document.body.append(host);
    shadow=host.attachShadow({mode:'open'});
    const style=document.createElement('style');style.textContent=UI_CSS;shadow.append(style);
    chip=document.createElement('button');chip.className='chip';chip.type='button';chip.setAttribute('aria-label','打开或收起续火助手');shadow.append(chip);
    panel=document.createElement('section');panel.className='panel hidden';panel.setAttribute('aria-label','抖音续火助手');shadow.append(panel);
    chip.addEventListener('click',()=>{if(run.suppressClick){run.suppressClick=false;return;}run.open=!run.open;if(run.open&&!run.readOnly)run.tab='today';run.drawer='';render();});
    attachDragging(chip,()=>true);
    attachDragging(panel,e=>!!e.target.closest?.('.top')&&!e.target.closest?.('button'));
    window.addEventListener('resize',placeFloating);
    panel.addEventListener('click',onClick);panel.addEventListener('input',onInput);panel.addEventListener('change',e=>{void onFile(e);});
    shadow.addEventListener('keydown',e=>{if(e.key==='Escape'){if(run.drawer)run.drawer='';else run.open=false;render();}});
    if(run.warning){run.open=true;run.tab='settings';run.toast=run.warning;}
    render();placeFloating();
    // Only one harmless menu command. No send, schedule, reset, notifications or callback registration.
    if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('打开 / 收起续火助手',()=>{run.open=!run.open;run.drawer='';render();});
  };
  if(typeof window!=='undefined'&&window.__SPARK_SIMPLE_TEST_MODE__){
    window.__SPARK_SIMPLE_TEST_HOOKS__={VERSION,BUILD_ID,NS,storage,migrate,normalized,initialData,parseImport,exportWhitelist,legacyTaskCounts,materialFrom,sanitize,disabledSettings,sourceIsSimple,dayNow,scanCandidates,conversationType,nameNode,idFromRow,statusFor,run,modelState:()=>model};return;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
