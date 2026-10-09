// ==UserScript==
// @name         抖音火花助手 · 一键续火
// @namespace    spark-full-local-userscript
// @version      0.7.1
// @description  自动扫描勾选聊天、前台逐会话核对发送，并可按需启用高级模块。非官方工具。
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
  const VERSION = '0.7.1';
  const BUILD_ID = 'v071-real-editor-send-fix-20261009-r1';
  const SCHEMA_KEY = 'simple:v1:state';
  const MIGRATION_KEY = 'simple:v1:migration';
  const SNAPSHOT_KEY = 'simple:v1:legacy-snapshot';
  const RESTORE_SNAPSHOT_KEY = 'simple:v1:before-restore';
  const DEFAULT_TEXT = '续火🔥';
  const SEND_INTENT_KEY = 'simple:v1:send-intents';
  const PLUGIN_DEFAULTS = Object.freeze({library:false,emoji:true,history:false,backup:false,diagnostics:false,streak:false,pacing:false,presets:false});
  const sleep = ms => new Promise(done=>setTimeout(done,ms));
  const plain = s => String(s||'').replace(/\s+/g,' ').trim();
  // Douyin's editor kit keeps one U+200B placeholder at the start/end of an empty or edited editor.
  // Remove only those boundary placeholders; preserve internal zero-width characters in user text.
  const editorText = editor => String(editor?.textContent||'').replace(/^\u200B|\u200B$/g,'');
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
      daily:{},manualChecks:{},plugins:{...PLUGIN_DEFAULTS},deliveryLog:[],legacyArchive:archive,legacySnapshotComplete:!!raw.__complete,legacyDataNotice:original!==LEGACY_DEFAULT&&original!==draft?'旧版动态文案已归档，请到设置导出查看。':'',
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
    data.paused=!!s.paused;data.sendDelay=Math.min(30,Math.max(1,Number(s.sendDelay)||3));data.plugins={...PLUGIN_DEFAULTS,...(isRecord(s.plugins)?s.plugins:{})};data.deliveryLog=Array.isArray(s.deliveryLog)?s.deliveryLog.slice(-100):[];data.draft=typeof s.draft==='string'?s.draft:DEFAULT_TEXT;
    data.materials=(Array.isArray(s.materials)?s.materials:[]).map(materialFrom).filter(Boolean).slice(0,MAX_MATERIALS);
    data.daily=isRecord(s.daily)?s.daily:{};data.manualChecks=isRecord(s.manualChecks)?s.manualChecks:{};
    data.savedStableChoices=[];data.legacyArchive=isRecord(s.legacyArchive)?s.legacyArchive:{};
    data.ui.tab=['today','advanced','settings'].includes(data.ui.tab)?data.ui.tab:'today';
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
  const pageSalt=`scan_${Math.random().toString(36).slice(2)}`;
  const candidateKey=(name,type,id)=>id?`id:${id}`:`temp:${pageSalt}:${encodeURIComponent(name)}:${type}`;
  const scanCandidates=()=>{
    const rows=[...document.querySelectorAll(SEL.rows)],items=[],duplicates=new Map();
    for(const row of rows){
      const title=first(row,SEL.titles),n=nameNode(title),name=cleanName(n?.textContent||'');if(!name)continue;
      const id=idFromRow(row),type=conversationType(row),key=candidateKey(name,type,id);
      const c={key,name,type,stableId:id,ambiguous:false,node:row};items.push(c);
      duplicates.set(key,(duplicates.get(key)||0)+1);
    }
    for(const it of items)it.ambiguous=duplicates.get(it.key)>1;
    return items;
  };
  const findScrollContainer=()=>{
    const row=document.querySelector(SEL.rows);let p=row?.parentElement;
    while(p&&p!==document.body){const st=getComputedStyle(p);
      if(/auto|scroll/.test(st.overflowY)&&p.scrollHeight>p.clientHeight+12)return p;
      p=p.parentElement;
    }return null;
  };
  const legacyTaskCounts = tasks => {
    const rows=Object.entries(isRecord(tasks)?tasks:{}).filter(([k,v])=>k.startsWith(dayNow()+'|')&&isRecord(v));
    return rows.reduce((a,[,v])=>{if(['SUBMITTED','UNKNOWN'].includes(v.status))a.pending++;return a;},{pending:0});
  };
  const statusFor = (item,day=dayNow()) => {
    const v=item?.dayStates?.[day];return v?.status||'PENDING';
  };
  const statusLabel = s => ({PENDING:'待处理',SKIPPED:'今天跳过',CHECKED:'人工已核对',SENT:'网页已确认发出',FAILED:'本次未发送',UNCERTAIN:'消息待核对'}[s]||'待处理');
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
    .scan-results{max-height:238px;overflow:auto;border:1px solid var(--line);border-radius:10px;margin:8px 0 7px;padding:2px;overscroll-behavior:contain}
    .scan-results .contact{margin:4px;border:0;border-bottom:1px solid #edf0f5;border-radius:4px}
    .scan-results input[type=checkbox],.plugin-row input[type=checkbox]{appearance:auto;width:18px;height:18px;flex:none;accent-color:#2563eb}
    .plugin-row{display:flex;gap:12px;align-items:center;padding:12px 2px;border-bottom:1px solid var(--line);cursor:pointer}
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
  const run={tab:'today',scanning:false,sending:false,aborted:false,scanComplete:false,progress:'',delivered:0,failed:0,uncertain:0,scanMap:new Map(),sessionSent:new Set(),tabOpenCount:0,open:false,drawer:'',filter:'ALL',search:'',candidates:[],items:new Map(),active:null,toast:'',copyStatus:'',restore:null,deleted:null,deletedTimeout:null,showLegacy:false,showSupport:false,legacyPending:0,warning:'',readOnly:false,suppressClick:false};
  const save = () => {storage.set(SCHEMA_KEY,{...model, savedStableChoices:[]});};
  const setToast = msg => {run.toast=msg;if(notice){notice.textContent=msg;notice.classList.toggle('hidden',!msg);}};
  const mergeVisible=()=>{
    for(const c of scanCandidates()){
      const previous=run.scanMap.get(c.key);
      if(previous){
        if(c.ambiguous)previous.ambiguous=true;
        const oldAvatar=previous.node?.querySelector?.('.commonIMAvataravatarContainer img')?.getAttribute('src');
        const newAvatar=c.node?.querySelector?.('.commonIMAvataravatarContainer img')?.getAttribute('src');
        if(oldAvatar&&newAvatar&&oldAvatar!==newAvatar)previous.ambiguous=true;
        // Across virtualized rows retain the identity key, but never retain old DOM pointers.
        previous.node=c.node;
      }else run.scanMap.set(c.key,{...c,node:c.node});
    }
    run.candidates=[...run.scanMap.values()];
    for(const c of run.candidates){const it=run.items.get(c.key);if(it){it.name=c.name;it.type=c.type;it.ambiguous=c.ambiguous;}}
    return run.candidates.length;
  };
  const syncCandidates=()=>mergeVisible();
  const scanAll=async()=>{
    if(run.scanning||run.sending)return;
    run.scanning=true;run.scanMap.clear();run.scanComplete=false;run.progress='读取聊天列表';render();
    const scroller=findScrollContainer(),oldTop=scroller?.scrollTop||0;
    try{
      mergeVisible();
      if(scroller){
        scroller.scrollTop=0;await sleep(180);mergeVisible();
        let last=-1,stale=0;
        for(let i=0;i<65;i++){
          if(!scroller.isConnected||run.aborted)break;
          const max=Math.max(0,scroller.scrollHeight-scroller.clientHeight),next=Math.min(max,scroller.scrollTop+Math.max(170,scroller.clientHeight*.75));
          scroller.scrollTop=next;await sleep(110);mergeVisible();
          if(scroller.scrollTop===last||scroller.scrollTop>=max){if(++stale>=2)break;}else stale=0;
          last=scroller.scrollTop;
        }
      }
      run.scanComplete=true;run.progress=`已读取 ${run.candidates.length} 个会话`;
    }catch(e){run.progress='读取已停止：'+String(e.message).slice(0,65);}
    finally{if(scroller?.isConnected)scroller.scrollTop=oldTop;run.scanning=false;render();}
  };
  const currentStreak=()=>{
    const header=document.querySelector(SEL.header);
    if(!header||!visible(header))return null;
    const target=[header,header.parentElement,header.parentElement?.parentElement].filter(Boolean);
    for(const scope of target){
      const n=scope.querySelector?.('[class*="commonStreaknormalText"],[data-e2e*="streak"]');
      if(!n||!visible(n))continue;
      const text=cleanName(n.textContent);if(!text)continue;
      const nearby=cleanName(n.parentElement?.textContent||'').slice(0,140);
      const days=/^(?:\d{1,5}|\d{1,5}天|连续\d{1,5}天)$/.test(text)?text:null;
      return {days,status:/待重燃|需要重燃|去重燃/.test(nearby)?'待重燃':/已重燃|重燃成功/.test(nearby)?'已重燃':'状态需查看抖音页面'};
    }return null;
  };
  const currentStatus = it => {
    if(!it)return 'PENDING';
    if(it.day!==dayNow()){it.day=dayNow();it.status='PENDING';it.manualAt=null;}
    return it.status;
  };
  const counts = () => {
    const arr=[...run.items.values()];return {pending:arr.filter(i=>currentStatus(i)==='PENDING').length,checked:arr.filter(i=>['CHECKED','SENT'].includes(currentStatus(i))).length,uncertain:arr.filter(i=>currentStatus(i)==='UNCERTAIN').length};
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
    return `<div class="contact ${active?'selected':''}" data-local-row="${esc(it.key)}"><div class="info"><b class="truncate">${esc(it.name)}</b><div class="state ${['CHECKED','SENT'].includes(s)?'good':['UNCERTAIN','FAILED'].includes(s)?'problem':''}">${esc(statusLabel(s))} ${it.type==='GROUP'?'· 群聊':it.type==='UNKNOWN'?'· 类型待核实':''}</div></div>
      <button class="secondary tiny" data-action="prepare" data-key="${esc(it.key)}">设为当前</button>${s==='UNCERTAIN'?`<button class="secondary tiny" data-action="check" data-key="${esc(it.key)}">人工核对</button>`:''}<button class="ghost tiny" data-action="row-more" data-key="${esc(it.key)}" aria-label="更多操作">⋯</button></div>${run.drawer==='more:'+it.key?`<div class="row" style="padding:4px 8px 10px;justify-content:flex-end"><button class="secondary tiny" data-action="${s==='SKIPPED'?'unskip':'skip'}" data-key="${esc(it.key)}">${s==='SKIPPED'?'撤销跳过':'今天跳过'}</button>${s==='CHECKED'?`<button class="secondary tiny" data-action="undo-check" data-key="${esc(it.key)}">撤销核对</button>`:''}<button class="secondary tiny" data-action="remove" data-key="${esc(it.key)}">移出清单</button></div>`:''}`;
  };
  const selectable=c=>!c.ambiguous&&c.type!=='GROUP'&&!/(?:AI分身|智能体|AI助手)/i.test(c.name);
  const candidateHtml=c=>{
    const checked=run.items.has(c.key),allowed=selectable(c);
    const typ=c.type==='GROUP'?'群聊':c.type==='PERSON'?'个人':'类型待核实';
    const it=run.items.get(c.key),stat=it?statusLabel(currentStatus(it)):'';
    return `<label class="contact ${checked?'selected':''}" data-candidate="${esc(c.key)}" style="cursor:${allowed?'pointer':'default'}"><input type="checkbox" data-select-key="${esc(c.key)}" ${checked?'checked':''} ${allowed?'':'disabled'} aria-label="选择 ${esc(c.name)}"/><div class="info"><b class="truncate">${esc(c.name)}</b><div class="meta">${esc(typ)}${stat?' · '+esc(stat):''}${c.ambiguous?' · 名称重复':''}</div></div></label>`;
  };
  const todayHtml = () => {
    const count=counts(),selected=[...run.items.values()],good=selected.filter(i=>currentStatus(i)==='PENDING').length;
    const filtered=run.candidates.filter(c=>!run.search||c.name.toLowerCase().includes(run.search.toLowerCase()));
    return `<div class="metrics"><div class="metric"><b>${run.candidates.length}</b><span>扫描会话</span></div><div class="metric"><b>${selected.length}</b><span>已勾选</span></div><div class="metric"><b>${count.checked}</b><span>已确认发送</span></div></div>
      <div class="row"><strong>勾选要处理的聊天</strong><button class="secondary tiny" data-action="scan" ${run.scanning||run.sending?'disabled':''}>${run.scanning?'扫描中…':'↻ 扫描全部'}</button></div>
      <div class="meta" style="margin:5px 0">${esc(run.progress||'进入页面自动读取聊天；可搜索后勾选。')}</div>
      <input id="spark-quick-search" placeholder="搜索聊天昵称" value="${esc(run.search)}" aria-label="搜索聊天昵称" />
      <div class="scan-results" id="spark-scan-results">${filtered.length?filtered.map(candidateHtml).join(''):'<div class="empty">当前没有匹配的会话，可点击扫描全部。</div>'}</div>
      <div class="row"><span class="meta">${selected.length} 个已勾选 · 本次最多发送 10 个</span><button class="ghost tiny" data-action="deselect">取消勾选</button></div>
      ${model.plugins.streak?`<div class="hint">当前聊天火花：${currentStreak()?`${esc(currentStreak().days||'未知')} · ${esc(currentStreak().status)}`:'页面未显示可读取的火花标记'}。以抖音官方聊天为准。</div>`:''}
      <div class="section"><div class="section-title"><strong>发送内容</strong>${model.plugins.library?'<button class="ghost tiny" data-action="library-open">常用内容 ›</button>':''}</div>
      <textarea id="spark-final-draft" maxlength="10000">${esc(model.draft)}</textarea>
      ${model.plugins.emoji?`<div class="emoji">${['🔥','❤️','🫶','😊'].map(v=>`<button data-action="emoji" data-value="${v}">${v}</button>`).join('')}</div>`:''}
      <div class="row"><span class="meta" id="spark-draft-counter">${model.draft.length}/${MAX_CONTENT} 字</span><span class="meta">${run.sending?esc(run.progress):'自动切换逐个核对'}</span></div>
      <button class="primary wide" data-action="batch-send" ${(!good||run.sending||run.scanning||model.paused)?'disabled':''}>${run.sending?'发送执行中…':`一键自动发送（${good}）`}</button>
      ${run.sending?'<button class="secondary wide" data-action="stop-send">停止后续发送</button>':''}
      <p class="muted">点击后先核对名单和正文；每次仅在前台切换已勾选的会话。已发出但未确认的消息不会自动重发。</p>
      ${model.paused?'<div class="warning">发送已暂停，可到「高级」恢复。</div>':''}
      ${run.progress&&(!run.sending)?`<div class="warning" role="status">${esc(run.progress)}</div>`:''}
      ${selected.some(i=>['UNCERTAIN','CHECKED','SENT','FAILED'].includes(currentStatus(i)))?`<div class="section-title" style="margin-top:12px"><strong>本次处理结果</strong></div>${selected.filter(i=>currentStatus(i)!=='PENDING').map(rowHtml).join('')}`:''}
      ${run.legacyPending?`<p class="muted">旧版本有 ${run.legacyPending} 项待核对记录，已单独保留。</p>`:''}
      <button class="secondary wide" data-action="copy">仅复制正文，不发送</button></div>`;
  };
  const pluginRows=[
    ['library','常用文案库','保存、选择常用内容'],
    ['emoji','快捷 Emoji','在正文中快速插入表情'],
    ['history','执行记录','查看本次逐人发送状态'],
    ['backup','备份与恢复','导出、预览及恢复本地数据'],
    ['diagnostics','脱敏诊断','导出不含聊天内容的兼容信息'],
    ['streak','火花状态读取','只显示页面能实际识别的状态'],
    ['pacing','自定义发送间隔','每个会话发送确认后再等待'],
    ['presets','批量内容轮换','从常用文案里逐条轮换发送']
  ];
  const advancedHtml=()=>`<div class="section-title"><strong>高级功能</strong><span class="badge">按需启用</span></div>
    <p class="muted">勾选后功能立即加入工作台或本页。取消勾选只隐藏功能，不删除已有数据。</p>
    <button class="primary wide" data-action="plugin-open">⚙ 管理高级功能 · 已开启 ${Object.values(model.plugins).filter(Boolean).length} 项</button>
    <p class="muted">可随时在模块窗口勾选或关闭，不会删除原来的素材与记录。</p>
    ${model.plugins.pacing?`<div class="section"><label for="spark-delay" class="muted">两位联系人之间的间隔（秒）</label><input id="spark-delay" type="number" min="1" max="30" value="${Number(model.sendDelay)||3}" /></div>`:''}
    ${model.plugins.presets?`<div class="section"><p class="muted">轮换仅使用已保存的文字素材，发送前在确认窗口预览名单与分配内容。</p><button class="secondary tiny" data-action="library-open">管理轮换文案（${model.materials.length}）</button></div>`:''}
    ${model.plugins.history?`<div class="section"><strong>最近执行记录</strong>${(model.deliveryLog||[]).slice(-20).reverse().map(e=>`<div class="contact"><div class="info"><b>${esc(e.name)}</b><div class="muted">${esc(e.status)} · ${new Date(e.at).toLocaleString()}</div></div></div>`).join('')||'<p class="muted">没有执行记录</p>'}</div>`:''}
    ${model.plugins.backup?settingsHtml():''}
    ${model.plugins.diagnostics?`<div class="section"><button class="secondary wide" data-action="diagnostic">导出脱敏诊断</button></div>`:''}
    <div class="section"><button class="secondary wide" data-action="pause-toggle">${model.paused?'恢复一键发送':'暂停一键发送'}</button></div>
    <div class="hr"></div><p class="muted">V${VERSION} · ${BUILD_ID} · 仅在当前打开的抖音聊天网页执行。</p>`;
  const settingsHtml = () => `<div class="section"><strong>数据备份</strong><p class="muted">导出的备份含联系人名称和文案，请自行保管。</p>
    <button class="secondary wide" data-action="export">导出备份</button><button class="secondary wide" data-action="import-open">导入备份</button><input type="file" id="spark-import-file" accept=".json,application/json" hidden />
    <button class="ghost tiny" data-action="archive-toggle">${run.showLegacy?'收起迁移说明':'旧版数据说明'}</button>${run.showLegacy?'<p class="muted">旧设置和任务已隔离归档。旧定时与回调均已关闭，不会自动启动。</p>':''}
    ${run.restore?`<div class="warning">备份预览：素材 ${run.restore.materials} 项。<button class="primary tiny" data-action="restore-yes">确认恢复</button><button class="secondary tiny" data-action="restore-cancel">取消</button></div>`:''}</div>`;
  const drawerHtml = () => {
    if(run.drawer==='plugins')return `<section class="drawer" aria-label="高级功能管理"><div class="drawerhead"><strong>按需添加功能</strong><button class="ghost" data-action="drawer-close">完成</button></div><div class="drawerbody">${pluginRows.map(([key,title,desc])=>`<label class="plugin-row"><div class="info"><b>${title}</b><div class="muted">${desc}</div></div><input type="checkbox" data-plugin="${key}" ${model.plugins[key]?'checked':''} /></label>`).join('')}</div></section>`;
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
    panel.innerHTML=`<div class="top"><strong>🔥 续火助手</strong><button class="ghost" data-action="collapse" aria-label="收起助手">收起 ↓</button></div><div class="nav" role="tablist" aria-label="助手页面"><button role="tab" aria-selected="${run.tab==='today'}" data-action="tab" data-value="today">今天</button><button role="tab" aria-selected="${run.tab==='advanced'}" data-action="tab" data-value="advanced">高级</button></div><main class="body" role="tabpanel">${run.tab==='today'?todayHtml():advancedHtml()}</main>${drawerHtml()}<div class="toast ${run.toast?'':'hidden'}" role="status" aria-live="polite">${esc(run.toast)}</div>`;
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
      model=draft;run.items.clear();run.active=null;run.restore=null;run.drawer='';run.open=true;run.tab='advanced';setToast('恢复成功，自动发送关闭，请重新选择聊天');render();
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
      case 'scan':void scanAll();return;
      case 'plugin-open':run.drawer='plugins';break;
      case 'deselect':if(run.sending)return;run.items.clear();run.active=null;break;
      case 'batch-send':void startBatch();return;
      case 'stop-send':run.aborted=true;run.progress='已请求停止；当前已提交的消息仍需核对';break;
      case 'pause-toggle':model.paused=!model.paused;save();break;
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
      case 'check':if(key)run.active=key;confirmUserCheck();return;
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
    if(e.target.id==='spark-delay'){model.sendDelay=Math.min(30,Math.max(1,Number(e.target.value)||3));save();return;}
    if(e.target.id==='spark-final-draft'){
      model.draft=e.target.value;save();run.copyStatus='';
      const counter=panel.querySelector('#spark-draft-counter');if(counter)counter.textContent=`${model.draft.length}/${MAX_CONTENT} 字`;
      const st=panel.querySelector('#spark-copy-state');if(st)st.textContent='';
    }else if(e.target.id==='spark-quick-search'){
      run.search=e.target.value;const el=panel.querySelector('#spark-scan-results');if(el)el.innerHTML=run.candidates.filter(c=>c.name.toLowerCase().includes(run.search.toLowerCase())).map(candidateHtml).join('')||'<div class="empty">没有匹配的会话</div>';
    }else if(e.target.id==='spark-contact-search'){
      run.search=e.target.value;
      // Render only the drawer's results, keeping focus/caret in its input.
      const target=panel.querySelector('#spark-drawer-results');if(!target)return;
      const v=run.search.toLowerCase();const items=run.candidates.filter(c=>c.name.toLowerCase().includes(v));
      target.innerHTML=items.map(c=>`<div class="contact"><div class="info"><b class="truncate">${esc(c.name)}</b><span class="meta">${c.type==='GROUP'?'群聊':c.type==='PERSON'?'个人':'类型待核实'}</span></div><button class="secondary tiny" data-action="add" data-key="${esc(c.key)}" ${run.items.has(c.key)||c.ambiguous||c.type==='GROUP'||/(?:AI分身|智能体|AI助手)/i.test(c.name)?'disabled':''}>${run.items.has(c.key)?'已加入':'添加'}</button></div>`).join('')||'<div class="empty">没有匹配的聊天</div>';
    }
  };
  const onChange=e=>{
    if(run.readOnly)return;
    if(e.target.matches?.('[data-select-key]')){
      const key=e.target.dataset.selectKey,c=run.candidates.find(x=>x.key===key);
      if(e.target.checked){if(!c||!selectable(c)){e.target.checked=false;setToast('该会话不能加入发送名单');return;}run.items.set(key,createItem(c));}
      else{run.items.delete(key);if(run.active===key)run.active=null;}
      render();return;
    }
    if(e.target.matches?.('[data-plugin]')){
      const key=e.target.dataset.plugin;if(!(key in PLUGIN_DEFAULTS))return;
      model.plugins[key]=e.target.checked;save();render();return;
    }
    void onFile(e);
  };
  const headerName=()=>{
    const h=document.querySelector(SEL.header);
    if(!h||!visible(h))return '';
    const n=nameNode(h);
    return cleanName(n?.textContent||h.textContent);
  };
  const findExactly=(target)=>{
    const rows=scanCandidates().filter(c=>c.name===target.name&&c.type===target.type);
    // No ID means we only allow a single EXACT match in the currently visible list.
    const matches=rows.filter(x=>target.stableId?x.stableId===target.stableId:true);
    return matches.length===1&&!matches[0].ambiguous?matches[0].node:null;
  };
  const navigateTo=async target=>{
    let node=findExactly(target);
    const scroller=findScrollContainer();
    if(!node && scroller){
      scroller.scrollTop=0;await sleep(120);
      for(let i=0;i<80&&!node;i++){
        node=findExactly(target);if(node)break;
        const max=Math.max(0,scroller.scrollHeight-scroller.clientHeight),next=Math.min(max,scroller.scrollTop+Math.max(150,scroller.clientHeight*.65));
        if(next===scroller.scrollTop)break;scroller.scrollTop=next;await sleep(110);
      }
    }
    if(!node||!visible(node))return {ok:false,reason:'无法在页面中定位唯一会话'};
    if(run.candidates.filter(c=>c.name===target.name).length!==1)return {ok:false,reason:'扫描结果中存在重名，已停止'};
    // A second scan must agree with the selected contact before touching the page.
    const verified=scanCandidates().filter(c=>c.node===node&&c.name===target.name&&c.type===target.type);
    if(verified.length!==1)return {ok:false,reason:'聊天列表发生变化'};
    node.click();
    for(let i=0;i<24;i++){
      if(run.aborted)return {ok:false,reason:'已停止'};
      await sleep(130);
      if(headerName()===target.name && visible(document.querySelector(SEL.editor))){
        // Verify again immediately after selecting. Never use prefix/fuzzy name matching.
        const again=scanCandidates().filter(c=>c.name===target.name);
        if(again.length!==1)return {ok:false,reason:'当前聊天存在重名或类型冲突'};
        return {ok:true};
      }
    }
    return {ok:false,reason:'聊天标题与目标不完全一致'};
  };
  const outgoingNodes=()=>[...document.querySelectorAll('[class*="MessageItemTextisFromMe"], [data-message-direction="outgoing"], [data-is-self="true"]')]
    .filter(n=>visible(n));
  const msgText=n=>plain(n?.querySelector?.('[class*="TextMessageTextpureText"]')?.textContent||n?.textContent||'');
  const snapshotOutgoing=text=>outgoingNodes().filter(n=>msgText(n)===plain(text));
    const intentHash=str=>{let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16).padStart(8,'0');};
  const intentKey=(target,message)=>dayNow()+':'+intentHash(target.name+'\\u0000'+target.type+'\\u0000'+message);
  const getIntents=()=>storage.get(SEND_INTENT_KEY,{})||{};
  const markIntent=(target,message)=>{
    const existing=getIntents(),key=intentKey(target,message);
    if(existing[key])return false;
    const next={...Object.fromEntries(Object.entries(existing).filter(([k])=>k.startsWith(dayNow()+':'))),[key]:{at:Date.now(),status:'SUBMITTED_OR_UNKNOWN'}};
    storage.set(SEND_INTENT_KEY,next);return true;
  };
  const logged=(name,status,reason)=>{
    model.deliveryLog??=[];model.deliveryLog.push({name,status,reason,at:Date.now()});model.deliveryLog=model.deliveryLog.slice(-100);save();
  };
  const runOne=async(target,message)=>{
    const it=run.items.get(target.key);if(!it)return 'SKIP';
    if(target.ambiguous||target.type==='GROUP')return 'SKIP';
    if(currentStatus(it)!=='PENDING'||run.sessionSent.has(target.key))return 'SKIP';
    if(target.stableId){
      const legacyTasks=model.legacyArchive?.tasks||{};
      const old=legacyTasks[dayNow()+'|id:'+target.stableId]||legacyTasks[dayNow()+'|'+target.stableId];
      if(['SUBMITTED','UNKNOWN','CONFIRMED'].includes(old?.status)){
        it.status='UNCERTAIN';run.progress=`${target.name}：旧版今天已有提交记录，需要人工核对`;return 'UNKNOWN';
      }
    }
    if(getIntents()[intentKey(target,message)]){it.status='UNCERTAIN';run.progress=`${target.name}：本日已有提交记录，已阻止再次发送`;return 'UNKNOWN';}
    const navigation=await navigateTo(target);
    if(!navigation.ok){it.status='FAILED';logged(target.name,'未发送',navigation.reason);run.progress=`${target.name}：${navigation.reason}`;return 'FAIL';}
    // Never overwrite a real user draft; use exact expected message and matching current chat.
    const editor=document.querySelector(SEL.editor);
    if(!editor||!visible(editor)||plain(editorText(editor))){
      it.status='FAILED';logged(target.name,'未发送','聊天输入框已有内容或不可用');run.progress=`${target.name}：输入框不可用或已有草稿`;return 'FAIL';
    }
    const baseline=snapshotOutgoing(message),baselineSet=new Set(baseline);
    if(typeof document.execCommand!=='function'){
      it.status='FAILED';logged(target.name,'未发送','浏览器不支持页面文本输入');return 'FAIL';
    }
    editor.focus();
    const inserted=document.execCommand('insertText',false,message);
    await sleep(100);
    if(!inserted||plain(editorText(editor))!==plain(message)||headerName()!==target.name){
      it.status='FAILED';logged(target.name,'未发送','写入聊天输入框后核对失败');return 'FAIL';
    }
    let sendScope=editor.parentElement;for(let i=0;i<4&&sendScope?.parentElement&&sendScope.parentElement!==document.body;i++)sendScope=sendScope.parentElement;
    const controls=[...(sendScope?.querySelectorAll('button,[role="button"],[class~="e2e-send-msg-btn"]')||[])]
      .filter(b=>!b.closest('#spark-full-root')&&visible(b));
    const labeled=controls.filter(b=>/^(?:发送|发送消息|Send)$/i.test(cleanName(b.getAttribute('aria-label')||b.getAttribute('title')||b.textContent)));
    const douyin=controls.filter(b=>b.matches('[class~="e2e-send-msg-btn"]'))
      .map(icon=>icon.closest('button,[role="button"]')||icon.parentElement).filter(b=>b&&visible(b));
    const candidates=labeled.length?labeled:douyin;
    const btn=candidates.length===1?candidates[0]:null;
    if(!btn||btn.disabled===true||btn.getAttribute('aria-disabled')==='true'||btn.closest('[disabled],[aria-disabled="true"]')){
      it.status='FAILED';logged(target.name,'未发送','未找到唯一且可用的页面发送控件');
      run.progress=`${target.name}：未找到可用发送按钮，消息仍在输入框中`;return 'FAIL';
    }
    // Record the submission boundary only after a real page control was located.
    if(!markIntent(target,message)){it.status='UNCERTAIN';return 'UNKNOWN';}
    it.status='UNCERTAIN';run.sessionSent.add(target.key);render();
    btn.click();
    const until=Date.now()+6500;
    while(Date.now()<until){
      await sleep(180);
      if(headerName()!==target.name){logged(target.name,'待核实','执行时聊天发生变化');return 'UNKNOWN';}
      const hits=snapshotOutgoing(message);
      const fresh=hits.filter(n=>!baselineSet.has(n));
      if(fresh.length && hits.length>baseline.length && !plain(editorText(editor))){
        it.status='SENT';it.manualAt=Date.now();logged(target.name,'已观察到新消息','当前聊天新增匹配的己方文字');
        return 'CONFIRMED';
      }
    }
    logged(target.name,'待核实','页面未确认新增己方消息');return 'UNKNOWN';
  };
  const contentFor=(targets)=>{
    if(!model.plugins.presets||!model.materials.length)return targets.map(()=>model.draft);
    const texts=model.materials.filter(x=>x.kind==='TEXT'||x.kind==='EMOJI').map(x=>x.content).filter(Boolean);
    return targets.map((_,i)=>texts.length?texts[i%texts.length]:model.draft);
  };
  const startBatch=async()=>{
    if(run.sending||run.scanning||model.paused||run.readOnly)return;
    const targets=[...run.items.keys()].map(key=>run.candidates.find(c=>c.key===key)).filter(Boolean)
      .filter(c=>run.items.get(c.key)?.status==='PENDING');
    if(!targets.length){setToast('请先勾选需要发送的会话');return;}
    if(targets.length>10){setToast('每轮最多 10 个聊天，请减少选择');return;}
    if(targets.length>1&&targets.some(c=>!c.stableId)){
      setToast('当前页面没有稳定会话 ID；为防止同名误发，无 ID 会话每轮只能单独选择一位并确认');return;
    }
    if(document.visibilityState!=='visible'){setToast('请将抖音聊天页面放到前台再发送');return;}
    if(!navigator.locks?.request){setToast('当前浏览器缺少跨标签执行锁，已停止发送');return;}
    const messages=contentFor(targets);
    if(messages.some(v=>!v.trim()||v.length>MAX_CONTENT||v.includes('\n'))){setToast('一键发送仅接受 1～900 字的单行内容，请检查正文');return;}
    const temporaryIdentity=targets.some(c=>!c.stableId);
    if(!window.confirm(`本次将自动切换 ${targets.length} 个聊天并分别尝试发送：\n${targets.map((c,i)=>`${i+1}. ${c.name}：${messages[i].slice(0,70)}`).join('\n')}${temporaryIdentity?'\n\n此会话没有稳定 ID，本轮仅按精确昵称和类型临时核对，不会保存长期授权。':''}\n\n请确认这些联系人都同意接收。页面若无法确认会停止，不会自动重试。`))return;
    await navigator.locks.request('spark-full-batch-send',{ifAvailable:true},async lock=>{
      if(!lock){setToast('其他标签页正在执行任务');return;}
      run.sending=true;run.aborted=false;run.progress='准备发送';run.delivered=0;run.failed=0;run.uncertain=0;render();
      try{
        for(let i=0;i<targets.length;i++){
          if(run.aborted||document.visibilityState!=='visible'||model.paused)break;
          run.progress=`${i+1}/${targets.length} · ${targets[i].name}`;render();
          let result;
          try{result=await runOne(targets[i],messages[i]);}
          catch(error){
            result='UNKNOWN';
            const it=run.items.get(targets[i].key);if(it)it.status='UNCERTAIN';
            run.progress='发送流程出现异常，请核对当前聊天，已停止后续操作';
            console.warn('[Spark] batch stopped:',String(error?.message||error).slice(0,120));
          }
          if(result==='CONFIRMED')run.delivered++;
          else if(result==='FAIL'){run.failed++;run.progress='当前聊天未发送，已停止后续操作，请检查会话或输入框';break;}
          else if(result==='UNKNOWN'){run.uncertain++;run.progress='发送结果不明确，已停止后续操作，请查看聊天记录';break;}
          if(run.aborted)break;
          if(i<targets.length-1)await sleep((model.plugins.pacing?Math.max(1,Math.min(30,Number(model.sendDelay)||3)):3)*1000);
        }
        if(!run.uncertain&&!run.failed)run.progress=`本轮结束：已确认 ${run.delivered}，未发送 ${run.failed}。`;
      }finally{run.sending=false;render();}
    });
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
    chip.addEventListener('click',()=>{if(run.suppressClick){run.suppressClick=false;return;}run.open=!run.open;if(run.open&&!run.readOnly)run.tab='today';run.drawer='';render();if(run.open&&!run.scanComplete&&!run.readOnly)void scanAll();});
    attachDragging(chip,()=>true);
    attachDragging(panel,e=>!!e.target.closest?.('.top')&&!e.target.closest?.('button'));
    window.addEventListener('resize',placeFloating);
    panel.addEventListener('click',onClick);panel.addEventListener('input',onInput);panel.addEventListener('change',e=>{void onChange(e);});
    shadow.addEventListener('keydown',e=>{if(e.key==='Escape'){if(run.drawer)run.drawer='';else run.open=false;render();}});
    if(run.warning){run.open=true;run.tab='advanced';run.toast=run.warning;}
    render();placeFloating();
    // Only one harmless menu command. No send, schedule, reset, notifications or callback registration.
    if(typeof GM_registerMenuCommand==='function')GM_registerMenuCommand('打开 / 收起续火助手',()=>{run.open=!run.open;run.drawer='';render();});
  };
  if(typeof window!=='undefined'&&window.__SPARK_SIMPLE_TEST_MODE__){
    window.__SPARK_SIMPLE_TEST_HOOKS__={VERSION,BUILD_ID,NS,storage,migrate,normalized,initialData,parseImport,exportWhitelist,legacyTaskCounts,materialFrom,sanitize,disabledSettings,sourceIsSimple,dayNow,scanCandidates,conversationType,nameNode,idFromRow,statusFor,run,modelState:()=>model,headerName,findExactly,msgText,contentFor,scanAll,snapshotOutgoing};return;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
