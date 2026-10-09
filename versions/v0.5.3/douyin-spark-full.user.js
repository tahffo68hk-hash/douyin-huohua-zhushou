// ==UserScript==
// @name         抖音火花助手 Full V0.5.3（真实 DOM 适配）
// @namespace    spark-full-local-userscript
// @version      0.5.3
// @description  V0.5.3 真实聊天列表 DOM 适配：个人/群聊识别、昵称状态分离、火花未知值保护。非官方工具。
// @author       Spark Full contributors
// @match        https://www.douyin.com/chat*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// @grant        GM_xmlhttpRequest
// @grant        GM_listValues
// @grant        GM_deleteValue
// @connect      v1.hitokoto.cn
// @connect      localhost
// @connect      127.0.0.1
// @connect      *
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // 与原仓库实现完全独立；只参考页面 UI 可见的交互形态，不调用抖音私有接口。
  const NS = 'spark-full:v2:';
  const VERSION = '0.5.3';
  const BUILD_ID = 'v053-dom-adapter-20261009-r1';
  const UI_ID = 'spark-full-root';
  const MAX_LOGS = 2500;
  const LOCK_KEY = NS + 'send-lease'; // v2 数据命名空间保持兼容
  const SELECTORS = Object.freeze({
    conversations: [
      '[data-e2e="conversation-item"]',
      '[class*="conversationConversationItemwrapper"]',
      '[class*="ConversationItemwrapper"]'
    ],
    title: [
      '.conversationConversationItemtitle',
      '[class*="ConversationItemtitle"]:not([class*="titleWrapper"]):not([class*="TitleWrapper"])',
      '[data-e2e="conversation-title"]',
    ],
    editor: [
      'div[data-slate-editor="true"][contenteditable="true"]',
      'div[contenteditable="true"][data-slate-editor]'
    ],
    detail: [
      '[class*="RightPanelHeadertitleContainer"]',
      '[class*="RightPanelHeader"]'
    ],
    streak: ['[class*="commonStreaknormalText"]', '[data-e2e*="streak"]'],
    conversationList: [
      '[class*="conversationConversationListwrapper"]',
      '[class*="ConversationListwrapper"]'
    ]
  });
  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const DEFAULTS = Object.freeze({
    collapsed: true, activeTab: 'contacts', paused: false,
    baseMessage: '续火🔥', message: '—————每日续火—————\n[TXTAPI]\n\n—————每日一言—————\n[API]\n\n—————专属一言—————\n[专属一言]\n\n🔥 火花已续 [天数] 天',
    autoEnabled: false, sendTime: '20:30', graceMinutes: 90,
    sendTimeRandom: false, sendTimeRangeStart:'19:30',sendTimeRangeEnd:'21:30',
    multiUserMode:'sequential', maxRetryCount:3,autoRetryInterval:10,
    retryAfterMaxReached:true,retryResetInterval:30, interUserDelay:4,
    userSearchTimeout:10000,pageLoadWaitTime:900,chatInputCheckInterval:1000,
    useHitokoto:false, hitokotoFormat:'{hitokoto} —— {from}{from_who}',
    fromFormat:'{from}',fromWhoFormat:'（{from_who}）',hitokotoTimeout:8000,
    useTxtApi:false,txtApiMode:'manual',txtApiUrl:'https://v1.hitokoto.cn/?encode=text',
    txtApiManualText:'今天也要开心\n火花不灭🔥\n记得好好休息',txtApiManualRandom:true,txtApiTimeout:8000,
    useSpecialHitokoto:false,specialHitokotoRandom:true,
    ...Object.fromEntries(WEEKDAYS.map((w,i)=>['specialHitokoto'+w,['周日','周一','周二','周三','周四','周五','周六'][i]+'好，记得续火！'])),
    autoFetchFireDays:true, fireDays:1, lastFireDate:'',
    maxLiveLogs:8,maxViewLogs:100,maxHistoryLogs:500,logRetentionDays:7,
    enableScriptBCallback:false,scriptBCallbackPort:7788,callbackToken:'',backendRetryMinutes:25,
    initialDelay:15,emoji:'🔥 ❤️ 😂 🥰 😘 😎 👍 ✨ 🎉 🫶',
    confirmEachRun:true, allowGroupManual:true, sendOnlyVisible:true,
    autoAllowVerifiedNoId:false, multiUserRetrySame:true,
    positionX:null,positionY:null, stickerName:'',
    personalizedEnabled:true,
    riskAlertsEnabled:false, riskCheckTime:'22:30', riskLeadMinutes:60,
    failureAlertsEnabled:false, unknownAlertsEnabled:false
  });
  const memoryStore = {};
  const gmGet = (key, fallback) => {
    try { if (typeof GM_getValue === 'function') return GM_getValue(NS + key, fallback); }
    catch (_) { /* fallback */ }
    try {
      const raw = localStorage.getItem(NS + key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { return Object.prototype.hasOwnProperty.call(memoryStore, key) ? memoryStore[key] : fallback; }
  };
  const gmSet = (key, value) => {
    try { if (typeof GM_setValue === 'function') return GM_setValue(NS + key, value); }
    catch (_) { /* fallback */ }
    try { localStorage.setItem(NS + key, JSON.stringify(value)); }
    catch (_) { memoryStore[key] = value; }
  };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const isoDay = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const localMinutes = (date = new Date()) => date.getHours() * 60 + date.getMinutes();
  const parseClock = value => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(value))) return null;
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const shouldRunAt = (now, planned, grace) => {
    const begin = parseClock(planned);
    return begin !== null && localMinutes(now) >= begin && localMinutes(now) <= begin + Math.max(0, Number(grace) || 0);
  };
  const compact = v => String(v || '').replace(/\s+/g, ' ').trim();
  const textForSend = v => String(v || '').replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const safeUrl = value => {
    try {
      const u = new URL(value, location.href);
      return u.protocol === 'https:' && /(?:^|\.)douyin\.com$|(?:^|\.)douyincdn\.com$|(?:^|\.)byteimg\.com$|(?:^|\.)ibytedtos\.com$/.test(u.hostname) ? u.href : '';
    } catch (_) { return ''; }
  };
  const hasValidIdentityRecord = c => Boolean(c && c.verificationState==='VERIFIED' &&
    typeof c.conversationStableId==='string' && /^[\w:\-.]{3,180}$/.test(c.conversationStableId) &&
    c.identityEvidence && Array.isArray(c.identityEvidence.sources) &&
    c.identityEvidence.type==='stable-id-equality' && Array.isArray(c.identityEvidence.attributes) && c.identityEvidence.attributes.length>0 &&
    c.identityEvidence.sources.includes('selected-row') &&
    (c.identityEvidence.sources.includes('current-header') || c.identityEvidence.sources.includes('current-chat-area') || c.identityEvidence.sources.includes('current-route')));
  const hydrateContact = raw => {
    if(!raw || typeof raw.key!=='string')return null;
    const explicitId=typeof raw.conversationStableId==='string' && /^[\w:\-.]{3,180}$/.test(raw.conversationStableId)
      ? raw.conversationStableId : (/^id:([\w:\-.]{3,180})$/.exec(raw.key)?.[1] || null);
    const verified=hasValidIdentityRecord(raw) && raw.stable===true && raw.conversationStableId===explicitId && !raw.requiresReverify;
    const displayName=String(raw.displayName||raw.name||'').trim().slice(0,120);
    const type=['PERSON','GROUP','UNKNOWN'].includes(raw.conversationType)?raw.conversationType:
      (['PERSON','GROUP','UNKNOWN'].includes(raw.type)?raw.type:'UNKNOWN');
    return {...raw,name:displayName,displayName,conversationStableId:explicitId,type,conversationType:type,
      verificationState:verified?'VERIFIED':'UNVERIFIED',identityEvidence:verified?raw.identityEvidence:null,
      requiresReverify:!verified,stable:Boolean(explicitId),ambiguous:!!raw.ambiguous};
  };
  const restoredContacts = (Array.isArray(gmGet('contacts', [])) ? gmGet('contacts', []) : [])
    .map(hydrateContact).filter(c => c && c.conversationStableId && c.key === `id:${c.conversationStableId}`);
  const restoredContactMap = new Map(restoredContacts.map(c => [c.key, c]));
  const restoredSelected = (Array.isArray(gmGet('selected', [])) ? gmGet('selected', []) : [])
    .filter(key => restoredContactMap.has(key));
  const state = {
    settings: { ...DEFAULTS, ...(gmGet('settings', {}) || {}) },
    contacts: restoredContactMap,
    selected: new Set(restoredSelected),
    tasks: gmGet('tasks', {}) || {},
    logs: gmGet('logs', []) || [],
    running: false,
    queueRunning: false,
    scanning: false,
    tab: 'contacts',
    filter: 'all',
    search: '',
    host: null,
    root: null,
    timer: null,
    currentSession: null,
    lastSchedule: null,
    isPaused: !!gmGet('isPaused', false),
    apiStatus: {},
    logFilter: {day:'',level:'all',category:'all',keyword:''},
    nextRun: null,
    aborted: false,
    health: null,
    identityWarnings: [],
    materials: [], contactRules: {}, editContactKey:'', materialEditId:'',
    materialDraft: { title:'', kind:'TEXT', content:'', tags:'' },
    alerts: [], pendingRestore:null, statsDays:7, alertFilter:'all' 
  };
  if (!Array.isArray(state.logs)) state.logs = [];
  if (!Array.isArray(gmGet('selected', []))) state.selected = new Set();
  state.tab = state.settings.activeTab || 'contacts';
  const LIMIT_MATERIALS=150, LIMIT_RULES=1000;
  const normalizeMaterial = (x) => {
    if(!x || typeof x!=='object')return null;
    const id=String(x.id||'');
    const title=String(x.title||'').trim().slice(0,60);
    const kind=['TEXT','EMOJI','STICKER'].includes(x.kind)?x.kind:'TEXT';
    const content=String(x.content||'').trim().slice(0,900);
    if(!/^[a-zA-Z0-9_-]{5,90}$/.test(id)||!title||!content)return null;
    return {id,title,kind,content,tags:String(x.tags||'').trim().slice(0,100)};
  };
  const normalizeRule=(rule)=>{
    const v=rule&&typeof rule==='object'?rule:{};
    const mode=['inherit','fixed','rotate'].includes(v.mode)?v.mode:'inherit';
    const schedule=['inherit','custom'].includes(v.schedule)?v.schedule:'inherit';
    const time=parseClock(v.time)!==null?v.time:'20:30';
    return {enabled:v.enabled!==false,mode,schedule,time,
      group:String(v.group||'默认').trim().slice(0,40)||'默认',
      materialIds:[...new Set(Array.isArray(v.materialIds)?v.materialIds.filter(x=>typeof x==='string'):[])].slice(0,100)};
  };
  state.materials=(Array.isArray(gmGet('materials',[]))?gmGet('materials',[]):[]).slice(0,LIMIT_MATERIALS).map(normalizeMaterial).filter(Boolean);
  const savedRules=gmGet('contactRules',{});
  state.contactRules=Object.fromEntries(Object.entries(savedRules&&typeof savedRules==='object'&&!Array.isArray(savedRules)?savedRules:{}).slice(0,LIMIT_RULES)
    .filter(([key])=>/^id:[\w:\-.]{3,180}$/.test(key)).map(([key,rule])=>[key,normalizeRule(rule)]));
  // 提醒单独存储。聊天内容与登录凭证不能进入系统通知或统计导出。
  const normalizeAlerts = raw => (Array.isArray(raw)?raw:[]).filter(v=>
    v && typeof v.id==='string' && typeof v.message==='string' && Number.isFinite(v.ts)
  ).slice(-180).map(v=>({id:v.id.slice(0,120),ts:v.ts,kind:String(v.kind||'system').slice(0,30),
    message:v.message.slice(0,240),read:!!v.read}));
  state.alerts=normalizeAlerts(gmGet('alerts',[]));
  const saveAlerts=()=>gmSet('alerts',state.alerts);
  const unreadAlerts=()=>state.alerts.filter(a=>!a.read).length;
  const pushAlert=(kind,message,id,when=Date.now())=>{
    if(state.alerts.some(a=>a.id===id))return false;
    state.alerts.push({id,kind,message:String(message).slice(0,240),ts:when,read:false});
    const cutoff=when-45*86400000;
    state.alerts=state.alerts.filter(a=>a.ts>=cutoff).slice(-180);
    saveAlerts();return true;
  };
  const saveMaterials=()=>gmSet('materials',state.materials.map(x=>({...x})));
  const saveRules=()=>gmSet('contactRules',Object.fromEntries(Object.entries(state.contactRules)
    .filter(([key])=>/^id:[\w:\-.]{3,180}$/.test(key))));
  const ruleFor=(key)=>normalizeRule(state.contactRules[key]);
  const allowedTextMaterials=()=>state.materials.filter(x=>x.kind!=='STICKER');
  // V0.4 不清除任何旧联系人/设置；新调度策略必须由用户重新确认。
  if(!gmGet('migrated-v04',false)) {
    state.settings.autoEnabled=false;
    gmSet('migrated-v04',true);
    gmSet('settings',{...state.settings,autoEnabled:false});
  }
  state.settings = {...DEFAULTS,...state.settings};
  if(!gmGet('migrated-v05',false)){
    // 新版增加提醒与恢复逻辑，第一次升级必须显式重新确认自动发送和系统提醒。
    state.settings.autoEnabled=false;
    state.settings.riskAlertsEnabled=false;
    state.settings.failureAlertsEnabled=false;
    state.settings.unknownAlertsEnabled=false;
    gmSet('migrated-v05',true);
    gmSet('settings',state.settings);
  }
  // 从 v0.2 升级时不删除设置/好友/任务；只需重新同意自动发送。
  if (!gmGet('migrated-v03', false)) {
    state.settings.autoEnabled = false;
    state.settings.autoAllowVerifiedNoId = false;
    state.settings.allowGroupManual = false;
    state.settings.confirmEachRun = true;
    gmSet('settings', state.settings);
    gmSet('migrated-v03', true);
  }
  if (!gmGet('migrated-v051', false)) {
    // V0.5.0 may have persisted an enabled schedule; keep the first V0.5.1 run read-only by default.
    state.settings.autoEnabled = false;
    gmSet('settings', state.settings);
    gmSet('migrated-v051', true);
  }
  if (!gmGet('migrated-v052', false)) {
    state.settings.autoEnabled=false;
    for(const contact of state.contacts.values()){
      contact.verificationState='UNVERIFIED';contact.identityEvidence=null;
      contact.verifiedAt=0;contact.source='列表';contact.requiresReverify=true;
      // Keep only an explicitly stored, attribute-derived id: key. Provisional nickname keys stay provisional.
      contact.conversationStableId=/^id:[\w:\-.]{3,180}$/.test(contact.key)?contact.key.slice(3):null;
      contact.stable=Boolean(contact.conversationStableId);
    }
    gmSet('settings',state.settings);gmSet('migrated-v052',true);
    gmSet('contacts',[...state.contacts.values()].map(({node,...c})=>c));
  }
  if(!gmGet('migrated-v053',false)){
    // Real-page compatibility changed selection/type handling; require a fresh user decision before any schedule can run.
    state.settings.autoEnabled=false;
    gmSet('settings',state.settings);gmSet('migrated-v053',true);
  }
  const saveSettings = () => gmSet('settings', state.settings);
  if(!state.settings.lastFireDate){state.settings.lastFireDate=isoDay();saveSettings();}
  const saveSelected = () => gmSet('selected', [...state.selected].filter(key=>state.contacts.get(key)?.conversationStableId));
  const saveTasks = () => gmSet('tasks', state.tasks);
  const log = (level, message) => {
    const row = { at: new Date().toLocaleString(), ts:Date.now(), day:isoDay(), level, category:'system', message: String(message).slice(0, 420) };
    state.logs.push(row);
    if (state.logs.length > Math.max(20,Math.min(MAX_LOGS,Number(state.settings.maxHistoryLogs)||500)) * Math.max(1,Number(state.settings.logRetentionDays)||7)) state.logs.splice(0,state.logs.length-MAX_LOGS);
    const cutoff=Date.now()-Math.max(1,Number(state.settings.logRetentionDays)||7)*86400000;
    state.logs=state.logs.filter(e=>!e.ts || e.ts>=cutoff);
    gmSet('logs', state.logs);
    if (state.root && state.tab === 'logs') render();
  };

  const first = (selectors, scope = document) => {
    for (const s of selectors) {
      try { const element = scope.querySelector(s); if (element) return element; } catch (_) { /* skip */ }
    }
    return null;
  };
  const firstAll = (selectors, scope = document) => {
    for (const s of selectors) {
      try { const found = [...scope.querySelectorAll(s)]; if (found.length) return found; } catch (_) { /* skip */ }
    }
    return [];
  };
  const visible = node => Boolean(node && node.isConnected && node.getClientRects().length);
  const labelText = node => compact(node?.innerText || node?.textContent || '');

  // 只有列表标记和详情结构可作证据；聊天内容里出现「群聊」不能当作识别依据。
  const classify = ({ rowText = '', headerText = '', classText = '', attrs = '' }) => {
    const structural = `${headerText} ${classText} ${attrs}`;
    if (/(?:群聊|群成员|[0-9]+\s*人(?:群|聊天)|group[-_ ]?chat|conversation[-_ ]?group|\bdata-(?:conversation-type|chat-type|type)\s+group(?:-chat)?\b)/i.test(structural)) return 'GROUP';
    if (/(?:单聊|私聊|person[-_ ]?chat|conversation[-_ ]?single|\bdata-(?:conversation-type|chat-type|type)\s+(?:person|single)(?:-chat)?\b)/i.test(structural)) return 'PERSON';
    if (/^(?:群聊|群成员|[0-9]+人(?:群聊)?)$/.test(compact(rowText))) return 'GROUP';
    return 'UNKNOWN';
  };
  const conversationTypeFromRow = row => {
    if(!row)return 'UNKNOWN';
    const explicit=classify({classText:String(row.className||''),attrs:['data-conversation-type','data-chat-type','data-type','aria-label','title'].map(a=>`${a} ${row.getAttribute(a)||''}`).join(' ')});
    if(explicit!=='UNKNOWN')return explicit;
    const groups=[...(row.querySelectorAll?.('.commonConversationIconnoDrag')||[])];
    const avatars=[...(row.querySelectorAll?.('.commonIMAvataravatarContainer')||[])];
    if(groups.length===1&&avatars.length===0)return 'GROUP';
    if(groups.length===0&&avatars.length===1&&avatars[0].querySelector('img'))return 'PERSON';
    return 'UNKNOWN';
  };
  const classifySpark = ({ days = null, text = '' }) => {
    const t = compact(text);
    if (/(?:重燃成功|已重燃|重燃完成)/.test(t)) return 'REKINDLED';
    if (/(?:待重燃|去重燃|点击重燃|可重燃|需要重燃|重燃火花|重新点燃)/.test(t)) return 'NEEDS_REKINDLE';
    if (/重燃/.test(t)) return 'REKINDLE_UNCERTAIN';
    // 只有天数时不能认定正常。
    if (/(?:火花正常|连续火花|火花持续中|今日已续火)/.test(t)) return 'ACTIVE';
    return 'UNKNOWN';
  };
  const fireDaysFrom = root => {
    const node = first(SELECTORS.streak, root);
    const n = node ? Number.parseInt(labelText(node).match(/\d+/)?.[0] || '', 10) : NaN;
    return Number.isFinite(n) && n > 0 && n < 100000 ? n : null;
  };
  const ID_ATTRS=['data-conversation-id','data-chat-id','data-session-id','data-conversation-key'];
  const validStableId=value=>typeof value==='string' && /^[\w:\-.]{3,180}$/.test(value);
  const attrRecords=node=>{
    const out=[];if(!node||node.nodeType!==1)return out;
    for(const key of ID_ATTRS){const value=node.getAttribute(key);if(validStableId(value))out.push({id:value,attr:key});}
    return out;
  };
  const withinConversationBoundary=(ancestor,start)=>{
    if(!ancestor||ancestor===document.body||ancestor===document.documentElement)return false;
    try{if(ancestor.matches(SELECTORS.conversationList.join(',')))return false;}catch(_){return false;}
    const selector=SELECTORS.conversations.join(',');
    try{if(ancestor!==start&&ancestor.querySelectorAll(selector).length>1)return false;}catch(_){return false;}
    return true;
  };
  const identityRecords=(node,{includeDescendants=true,maxAncestors=6,kind='current-header'}={})=>{
    if(!node)return [];
    const out=[];const add=(el,source)=>{for(const r of attrRecords(el))out.push({...r,source});};
    add(node,kind);
    if(includeDescendants){
      try{for(const el of node.querySelectorAll(ID_ATTRS.map(a=>`[${a}]`).join(',')))add(el,kind);}catch(_){/* no DOM query */}
    }
    let cursor=node.parentElement,depth=0;
    while(cursor&&depth<maxAncestors&&withinConversationBoundary(cursor,node)){
      add(cursor,kind==='selected-row'?'selected-row':'current-chat-area');
      cursor=cursor.parentElement;depth++;
    }
    return out;
  };
  const uniqueIds=records=>[...new Set((records||[]).map(r=>r.id))];
  const recordConflict=records=>uniqueIds(records).length>1;
  const extractId = node => {
    const records=identityRecords(node,{includeDescendants:true,kind:'selected-row'});
    const ids=uniqueIds(records);
    return ids.length===1?`id:${ids[0]}`:'';
  };
  const markedDateOrTime=node=>{
    for(let el=node;el&&el.nodeType===1;el=el.parentElement){
      const token=[String(el.className||''),el.getAttribute('data-e2e')||'',el.getAttribute('aria-label')||''].join(' ').toLowerCase();
      if(el.tagName==='TIME'||el.hasAttribute('datetime')||/(time|date|weekday|timestamp)/i.test(token)||/(?:时间|日期|星期|周[一二三四五六日])/.test(token))return true;
    }
    return false;
  };
  const leafDisplayNode=(root,preferredSelectors=[])=>{
    if(!root)return null;
    for(const selector of preferredSelectors){
      try{const node=root.querySelector(selector);const value=compact(node?.innerText||node?.textContent);if(node&&value&&value.length<=120&&!markedDateOrTime(node))return node;}catch(_){/* malformed selector */}
    }
    const candidates=[];
    try{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const text=compact(walker.currentNode.nodeValue),parent=walker.currentNode.parentElement;
        if(!text||text.length>120||!parent||markedDateOrTime(parent))continue;
        // Keep leaf-level text nodes, avoiding a wrapper's combined nickname + time text.
        if(parent.children.length===0)candidates.push({text,node:parent});
      }
    }catch(_){return root;}
    const ranked=candidates.sort((a,b)=>b.text.length-a.text.length);
    return ranked[0]?.node||null;
  };
  const leafDisplayText=(root,preferredSelectors=[])=>{
    const node=leafDisplayNode(root,preferredSelectors);
    return compact(node?.innerText||node?.textContent);
  };
  const rowIdentity=(node)=>{
    const records=identityRecords(node,{includeDescendants:true,kind:'selected-row'});
    const ids=uniqueIds(records);
    return {id:ids.length===1?ids[0]:null,records,conflict:ids.length>1};
  };
  let provisionalSequence=0;
  const provisionalSession=`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  const provisionalRows=new WeakMap();
  const contactFromRow = node => {
    const titleEl = first(SELECTORS.title, node);
    const name = leafDisplayText(titleEl,[
      '[data-e2e*="nickname"]','[data-e2e*="user-name"]','[class*="nickname"]','[class*="Nickname"]','[class*="userName"]','[class*="UserName"]'
    ]);
    if (!name || name.length > 120) return null;
    const img = node.querySelector('img[src]');
    const avatar = safeUrl(img?.getAttribute('src'));
    const type = conversationTypeFromRow(node);
    const identity=rowIdentity(node);
    let provisional=provisionalRows.get(node);
    if(provisional&&provisional.displayName!==name)provisional=null;
    if(!provisional){provisional={displayName:name,key:`provisional:${provisionalSession}:${++provisionalSequence}`};provisionalRows.set(node,provisional);}
    const key = identity.id ? `id:${identity.id}` : provisional.key;
    const days = fireDaysFrom(node);
    const badgeContext = first(SELECTORS.streak, node)?.parentElement;
    return {
      key,name,displayName:name,avatar,type,conversationType:type,days,conversationStableId:identity.id,
      spark: classifySpark({ days, text: labelText(badgeContext).slice(0, 180) }),
      source: '列表',verifiedAt:0,stable:Boolean(identity.id),verificationState:'UNVERIFIED',identityEvidence:null,
      typeSource:type==='UNKNOWN'?'unknown':'structural',ambiguous:identity.conflict,requiresReverify:true,node
    };
  };
  const collect = () => {
    const rows = firstAll(SELECTORS.conversations);
    const found = new Map();
    for (const row of rows) {
      const entry = contactFromRow(row);
      if (!entry) continue;
      if (found.has(entry.key)) {
        // DOM 里同键多行：标记歧义，绝不能随意取第一位发送。
        const previous=found.get(entry.key);
        previous.ambiguous=true;previous.node=null;
      } else found.set(entry.key,entry);
    }
    return found;
  };
  const persistContacts = () => gmSet('contacts', [...state.contacts.values()]
    .filter(c=>(c.conversationStableId&&c.key===`id:${c.conversationStableId}`)||c.source==='导入·待复核')
    .slice(0, 1000).map(({node, ...details}) => details));
  const mergeContact = contact => {
    const old = state.contacts.get(contact.key);
    if (old) {
      const sameStableId=Boolean(old.conversationStableId && contact.conversationStableId && old.conversationStableId===contact.conversationStableId);
      const preserveVerified=sameStableId && old.verificationState==='VERIFIED' &&
        hasValidIdentityRecord(old) && !contact.ambiguous && contact.verificationState!=='CONFLICT';
      state.contacts.set(contact.key, {
        ...old, ...contact,
        conversationStableId:contact.conversationStableId||old.conversationStableId||null,
        verificationState:preserveVerified?'VERIFIED':contact.verificationState||'UNVERIFIED',
        identityEvidence:preserveVerified?old.identityEvidence:(contact.identityEvidence||null),
        requiresReverify:preserveVerified?false:(contact.requiresReverify!==false),
        stable:Boolean(contact.conversationStableId||old.conversationStableId),
        // 详情页已读取的火花状态不应被信息不足的列表数据覆盖。
        days: contact.days ?? old.days,
        spark: old.source === '详情' && old.verifiedAt && contact.source === '列表' ? old.spark : contact.spark,
        source: old.source === '详情' && contact.source === '列表' ? '详情' : contact.source,
        verifiedAt: preserveVerified?(contact.verifiedAt||old.verifiedAt):(contact.verifiedAt||0),
        type: old.typeSource === 'manual' && contact.source === '列表' ? old.type : (contact.type === 'UNKNOWN' ? old.type : contact.type),
        typeSource: old.typeSource === 'manual' && contact.source === '列表' ? old.typeSource : contact.typeSource,
        ambiguous: Boolean(old.ambiguous || contact.ambiguous)
      });
    } else state.contacts.set(contact.key, contact);
  };
  const scanOnce = () => {
    const entries = collect();
    for (const item of entries.values()) { mergeContact(item); if(state.settings.autoFetchFireDays)syncFireFromContact(state.contacts.get(item.key)); }
    persistContacts();
    return entries.size;
  };
  const scanMore = async () => {
    if (state.scanning) return;
    state.scanning = true;
    log('info', '正在扫描会话列表（不会发送消息）');
    render();
    const sample = first(SELECTORS.conversations);
    let scroller = sample?.parentElement;
    while (scroller && scroller !== document.body) {
      const css = getComputedStyle(scroller);
      if (/(auto|scroll)/.test(css.overflowY) && scroller.scrollHeight > scroller.clientHeight + 12) break;
      scroller = scroller.parentElement;
    }
    const initial = scanOnce();
    if (scroller && scroller !== document.body) {
      const initialTop = scroller.scrollTop;
      let noChange = 0;
      try {
        for (let i = 0; i < 24; i++) {
          if (!document.contains(scroller)) break;
          const old = scroller.scrollTop;
          scroller.scrollTop = Math.min(scroller.scrollHeight, old + Math.max(350, scroller.clientHeight * 0.75));
          await sleep(250);
          const count = scanOnce();
          if (scroller.scrollTop === old && count === 0) noChange += 1;
          else noChange = 0;
          if (noChange >= 3) break;
        }
      } finally { scroller.scrollTop = initialTop; }
    }
    state.scanning = false;
    log('info', `扫描结束：当前收集 ${state.contacts.size} 个会话（起始可见 ${initial} 个）`);
    render();
  };
  const locateRow = contact => {
    const entries = [...collect().values()];
    const id=contact?.conversationStableId;
    if(id){
      const matches=entries.filter(e=>e.conversationStableId===id&&!e.ambiguous);
      return matches.length===1?matches[0].node:null;
    }
    const exact = entries.find(e => e.key === contact.key);
    if (exact) return exact.ambiguous ? null : exact.node;
    return null;
  };
  const currentHeader = () => first(SELECTORS.detail);
  const activeRowEvidence=()=>{
    const rows=firstAll(SELECTORS.conversations);
    const active=rows.filter(node=>{
      const attrs=[node.getAttribute('aria-selected'),node.getAttribute('data-active'),node.getAttribute('data-selected'),node.getAttribute('aria-current')];
      const name=String(node.className||'');
      return attrs.some(v=>v==='true'||v==='page') || /(?:^|[\s_-])(?:active|selected)(?:$|[\s_-])/i.test(name) || /curConversation/i.test(name);
    });
    if(active.length===1){const identity=rowIdentity(active[0]);return {...identity,row:active[0],count:1,method:'explicit-selected-marker'};}
    if(active.length>1)return {id:null,row:null,records:[],conflict:false,count:active.length,method:'ambiguous-selected-markers'};
    // If the page does not expose an active CSS/ARIA marker, a single exact row ID
    // matching the loaded detail ID is still a stable-ID selection proof.
    const header=currentHeader();
    const detailRecords=header&&visible(header)?identityRecords(header,{includeDescendants:true,kind:'current-header'}):[];
    const detailIds=uniqueIds([...detailRecords,...routeIdentityRecords()]);
    if(detailIds.length!==1)return {id:null,row:null,records:[],conflict:detailIds.length>1,count:0,method:'no-selected-marker'};
    const matching=rows.map(row=>({row,identity:rowIdentity(row)})).filter(x=>x.identity.id===detailIds[0]&&!x.identity.conflict);
    if(matching.length!==1)return {id:null,row:null,records:[],conflict:matching.length>1,count:0,method:'detail-id-row-match-ambiguous'};
    return {...matching[0].identity,row:matching[0].row,count:1,method:'unique-detail-id-row-match'};
  };
  const activeRowIdentity=()=>{const e=activeRowEvidence();return e.id?`id:${e.id}`:'';};
  const routeIdentityRecords=()=>{
    try{
      const url=new URL(location.href),records=[];
      for(const key of ['conversation_id','conversationId','chat_id','chatId','session_id','sessionId']){
        const value=url.searchParams.get(key);if(validStableId(value))records.push({id:value,source:'current-route',attr:key});
      }
      return records;
    }catch(_){return [];}
  };
  const liveIdentityEvidence=()=>{
    const header=currentHeader();
    const selected=activeRowEvidence();
    const headerRecords=header&&visible(header)?identityRecords(header,{includeDescendants:true,kind:'current-header'}):[];
    const routeRecords=routeIdentityRecords();
    const all=[...selected.records,...headerRecords,...routeRecords];
    const ids=uniqueIds(all);
    const row=selected.row;
    const rowType=row?conversationTypeFromRow(row):'UNKNOWN';
    const headerType=header&&visible(header)?classify({headerText:'',classText:String(header.className||''),attrs:['data-chat-type','data-conversation-type','aria-label'].map(a=>`${a} ${header.getAttribute(a)||''}`).join(' ')}):'UNKNOWN';
    const chatAreaType=header?.parentElement?classify({headerText:'',classText:String(header.parentElement.className||''),attrs:['data-chat-type','data-conversation-type','data-type','aria-label'].map(a=>`${a} ${header.parentElement.getAttribute(a)||''}`).join(' ')}):'UNKNOWN';
    const typeConflict=rowType!=='UNKNOWN'&&headerType!=='UNKNOWN'&&rowType!==headerType ||
      rowType!=='UNKNOWN'&&chatAreaType!=='UNKNOWN'&&rowType!==chatAreaType ||
      headerType!=='UNKNOWN'&&chatAreaType!=='UNKNOWN'&&headerType!==chatAreaType;
    const uniqueSources=[...new Set(all.map(x=>x.source))];
    const detailIds=uniqueIds([...headerRecords,...routeRecords]);
    return {header,selected,headerRecords,routeRecords,all,ids,detailIds,conflict:ids.length>1||selected.conflict||recordConflict(headerRecords),
      typeConflict,rowType,headerType,chatAreaType,sources:uniqueSources,
      loaded:Boolean(header&&visible(header)&&locateEditor()&&visible(locateEditor())&&selected.count===1)};
  };
  const verificationFor=(contact,e=liveIdentityEvidence())=>{
    const stable=contact?.conversationStableId;
    if(!stable||!validStableId(stable)||contact.stable!==true||contact.ambiguous)return {state:'UNVERIFIED',ok:false,evidence:e};
    if(e.conflict||e.typeConflict)return {state:'CONFLICT',ok:false,evidence:e};
    if(e.selected.count===1&&e.selected.id&&e.selected.id!==stable)return {state:'CONFLICT',ok:false,evidence:e};
    if(e.detailIds.length===1&&e.detailIds[0]!==stable)return {state:'CONFLICT',ok:false,evidence:e};
    const targetMatches=e.selected.count===1&&e.selected.id===stable;
    const detailMatches=e.detailIds.length===1&&e.detailIds[0]===stable;
    const contactMatches=contact.conversationStableId===stable;
    if(!contactMatches||!targetMatches||!detailMatches||!e.loaded)return {state:'UNVERIFIED',ok:false,evidence:e};
    if(contact.type!=='UNKNOWN'&&e.rowType!=='UNKNOWN'&&contact.type!==e.rowType)return {state:'CONFLICT',ok:false,evidence:e};
    if(contact.type!=='UNKNOWN'&&e.headerType!=='UNKNOWN'&&contact.type!==e.headerType)return {state:'CONFLICT',ok:false,evidence:e};
    return {state:'VERIFIED',ok:true,evidence:e};
  };
  const currentHeaderDisplayName=header=>{
    const title=first(['.RightPanelHeadertitle','[class*="RightPanelHeadertitleBarContainer"]','[class*="HeaderTitleName"]'],header);
    return leafDisplayText(title||header);
  };
  const visibleConversationEvidence=contact=>{
    const evidence=liveIdentityEvidence(),row=evidence.selected.row;
    if(!contact||evidence.conflict||evidence.typeConflict||evidence.selected.count!==1||!evidence.loaded)
      return {ok:false,reason:'页面未加载唯一当前会话',displayName:''};
    // Visible title matching is a read-only association only. Any ID that exists must use the strict ID path.
    if(contact.conversationStableId||evidence.ids.length)
      return {ok:false,reason:'页面暴露了 ID，需使用稳定 ID 核验',displayName:''};
    const rowContact=contactFromRow(row),headerName=currentHeaderDisplayName(evidence.header);
    if(!rowContact||rowContact.key!==contact.key||rowContact.displayName!==contact.displayName||headerName!==contact.displayName)
      return {ok:false,reason:'列表昵称与聊天标题未精确一致',displayName:headerName};
    const sameName=[...collect().values()].filter(c=>c.displayName===headerName).length;
    if(sameName!==1)return {ok:false,reason:'可见列表存在同名会话',displayName:headerName};
    if(!['PERSON','GROUP'].includes(rowContact.type)||rowContact.type!==contact.type)
      return {ok:false,reason:'会话类型未知或冲突',displayName:headerName};
    return {ok:true,reason:'唯一选中行与详情标题精确匹配（仅页面证据）',displayName:headerName,row,header:evidence.header,type:rowContact.type};
  };
  const manualTargetEvidence=contact=>{
    const visibleEvidence=visibleConversationEvidence(contact);
    return {...visibleEvidence,ok:visibleEvidence.ok&&state.selected.size===1&&state.selected.has(contact?.key)};
  };
  const confirmManualTarget=(contact,action='发送一条手动消息')=>{
    const proof=manualTargetEvidence(contact);
    if(!proof.ok){logCategory('warn','send','手动流程未能唯一核对当前会话，已停止');return false;}
    if(contact.type==='GROUP'&&!state.settings.allowGroupManual){logCategory('warn','send','群聊手动发送当前已关闭');return false;}
    const confirmed=window.confirm(`稳定会话 ID 不可用。请确认唯一选中行和聊天顶部标题都是「${proof.displayName}」。本次只执行${action}，不会保存为自动发送身份凭证。是否继续？`);
    return confirmed&&manualTargetEvidence(contact).ok;
  };
  const setVerificationState=(contact,verification)=>{
    contact.verificationState=verification.state;
    contact.requiresReverify=verification.state!=='VERIFIED';
    if(verification.state!=='VERIFIED'){
      contact.identityEvidence=null;contact.verifiedAt=0;
      if(verification.state==='CONFLICT')contact.source='列表';
    }
  };
  const verifyOpenConversation = (contact, strict = false) => {
    const verification=verificationFor(contact,liveIdentityEvidence());
    if(contact && verification.state==='CONFLICT')setVerificationState(contact,verification);
    return verification.ok;
  };
  const detailText = header => {
    // 页面有时将「重燃」状态放在标题同级/父级，而非天数节点中。
    // 限定在标题容器附近，避免误读历史聊天气泡中的「重燃」字样。
    let cursor=header;let fallback='';
    for(let distance=0;distance<4 && cursor;distance++,cursor=cursor.parentElement){
      const css=String(cursor.className||'');
      if(distance>=2 && !/(?:Header|header|Title|title|RightPanel|right-panel)/.test(css))break;
      const body=labelText(cursor).slice(0,700);
      const labels=[];
      for(const n of [...cursor.querySelectorAll('[title],[aria-label],[data-tooltip]')].slice(0,35)){
        for(const attr of ['title','aria-label','data-tooltip']){
          const v=compact(n.getAttribute(attr));
          if(v && v.length<90 && /(?:火花|重燃|连续)/.test(v))labels.push(v);
        }
      }
      const content=[body,...new Set(labels)].join(' · ').slice(0,700);
      if(content && !fallback)fallback=content;
      if(/(?:重燃|火花正常|连续火花|今日已续火)/.test(content))return content;
      if(body.length>600)break;
    }
    return fallback;
  };
  const applyDetail = (contact, row) => {
    const verification=verificationFor(contact,liveIdentityEvidence());
    const visual=verification.state==='CONFLICT'?{ok:false}:visibleConversationEvidence(contact);
    if(!verification.ok&&!visual.ok){if(contact)setVerificationState(contact,verification);return false;}
    const identityVerified=verification.ok;
    const header = verification.evidence.header;
    const regionText = detailText(header);
    const d = fireDaysFrom(header?.parentElement || header) ?? fireDaysFrom(header);
    const headerType=verification.evidence.headerType!=='UNKNOWN'?verification.evidence.headerType:
      (verification.evidence.rowType!=='UNKNOWN'?verification.evidence.rowType:contact.type);
    const preciseHeaderName=first(['.RightPanelHeadertitle','[data-e2e*="nickname"]','[data-e2e*="user-name"]','[class*="HeaderTitleName"]','[class*="conversation-title"]'],header);
    const rowDisplay=contactFromRow(row||contact.node)?.displayName||'';
    const displayName=preciseHeaderName?leafDisplayText(preciseHeaderName):rowDisplay||contact.displayName||contact.name;
    const sources=identityVerified?[...new Set(verification.evidence.sources)]:[];
    const attributes=identityVerified?[...new Set(verification.evidence.all.filter(r=>r.id===contact.conversationStableId).map(r=>r.attr))]:[];
    const identityEvidence=identityVerified?{type:'stable-id-equality',sources,attributes,observedAt:new Date().toISOString(),method:'dom-stable-id-cross-check'}:null;
    mergeContact({
      ...contact,name:displayName||contact.displayName||contact.name,displayName:displayName||contact.displayName||contact.name,
      conversationStableId:contact.conversationStableId,stable:identityVerified,verificationState:identityVerified?'VERIFIED':'UNVERIFIED',identityEvidence,requiresReverify:!identityVerified,
      node: row || contact.node,type:headerType,conversationType:headerType,
      days: d ?? contact.days,
      spark: classifySpark({ days: d ?? contact.days, text: regionText }),
      source:'详情',verifiedAt:identityVerified?Date.now():0,typeSource:headerType==='UNKNOWN'?contact.typeSource:'structural'
    });
    persistContacts();
    if(state.settings.autoFetchFireDays)syncFireFromContact(state.contacts.get(contact.key));
    state.currentSession = contact.key;
    return true;
  };
  const inspectCurrent = () => {
    const current=liveIdentityEvidence();
    const selectedId=current.selected.id;
    let matches=selectedId?[...state.contacts.values()].filter(c=>c.conversationStableId===selectedId):[];
    if(!selectedId&&!current.ids.length&&current.selected.count===1&&current.selected.row&&!current.conflict&&!current.typeConflict){
      const fromRow=contactFromRow(current.selected.row);
      if(fromRow){
        const cached=state.contacts.get(fromRow.key);
        const candidate=cached||fromRow;
        if(!cached)mergeContact(candidate);
        if(visibleConversationEvidence(candidate).ok)matches=[candidate];
      }
    }
    if(current.conflict||current.typeConflict){for(const c of matches)setVerificationState(c,{state:'CONFLICT'});}
    if (matches.length !== 1 || !applyDetail(matches[0], locateRow(matches[0]))) {
      log('warn', '无法将当前详情安全关联到唯一列表会话；身份或火花状态保持未知。');
    } else {
      log('info', matches[0].verificationState==='VERIFIED'?'已核对稳定会话 ID 并读取页面状态':'已读取当前页面状态；身份仍未核验，自动发送继续阻止');
    }
    render();
  };
  const inspectContact = async key => {
    const contact = state.contacts.get(key);
    if (!contact || state.running) return;
    let row = locateRow(contact);
    if (!row) { scanOnce(); row = locateRow(contact); }
    if (!row) { log('warn', `未在当前列表定位到「${contact.name}」，请手动打开该会话后再试`); render(); return; }
    row.click();
    await sleep(650);
    if (!applyDetail(contact, row)) {
      log('warn', `「${contact.name}」详情匹配不确定：未写入火花状态`);
      render(); return;
    }
    log('info', `已读取「${contact.name}」聊天详情；未识别的信息继续标记为未知`);
    render();
  };

  const taskId = (day, key) => `${day}|${key}`;
  const taskFor = (key, day = isoDay()) => state.tasks[taskId(day, key)] || null;
  const recordTask = (key, status, reason = '') => {
    const id = taskId(isoDay(), key);
    state.tasks[id] = { ...(state.tasks[id]||{}), status, reason: String(reason).slice(0, 200), time: Date.now() };
    const days = Object.keys(state.tasks).filter(k => k.split('|')[0] < isoDay(dateShift(new Date(),-45)));
    for (const k of days) delete state.tasks[k];
    saveTasks();
    if(['FAILED','UNKNOWN'].includes(status))emitTaskAlert(key,status,reason);
  };
  const acquireLease = async fn => {
    const execute = async () => {
      // 原子锁在 Chromium/Firefox 支持时由 Web Locks API 提供。
      if (state.running) return false;
      state.running = true;
      try { return await fn(); } finally { state.running = false; }
    };
    if (navigator.locks?.request) {
      return navigator.locks.request('spark-lite-send', { ifAvailable: true }, async lock => {
        if (!lock) { log('warn', '其他标签页正在执行发送任务'); return false; }
        return execute();
      });
    }
    // 兼容旧浏览器的退化锁不保证完全原子；自动发送在缺失 Web Locks 时禁用。
    return execute();
  };
  const ownMessageCandidates = () => firstAll([
    '[data-e2e*="message-item"]',
    '[class*="MessageItemwrapper"]',
    '[class*="messageItemWrapper"]',
    '[class*="messageMessageItem"]'
  ]);
  // 只接受明确带出站方向证据的消息节点，不凭右侧位置或包含字符串推断。
  const isOutgoing = element => {
    const signal=[String(element.className||''),element.getAttribute('data-e2e')||'',element.getAttribute('data-message-direction')||'',element.getAttribute('data-is-self')||''].join(' ');
    return /(?:^|[^a-z])(?:self|mine|outgoing|my-message|message-self)(?:$|[^a-z])/i.test(signal) || element.getAttribute('data-is-self')==='true';
  };
  const outgoingText = element => textForSend(labelText(element));
  const snapshotMessages = () => {
    const counts=new Map();
    for(const node of ownMessageCandidates().filter(n=>visible(n)&&isOutgoing(n))){
      const text=outgoingText(node); if(text)counts.set(text,(counts.get(text)||0)+1);
    }
    return { counts };
  };
  const confirmedOutgoing = (before, message) => {
    const expected=textForSend(message);
    if(!expected)return false;
    const hits=ownMessageCandidates().filter(n=>visible(n)&&isOutgoing(n)&&outgoingText(n)===expected);
    return hits.length > (before?.counts?.get(expected)||0);
  };
  const exactOutgoingPresent = message => {
    const expected=textForSend(message);
    return Boolean(expected&&ownMessageCandidates().some(n=>visible(n)&&isOutgoing(n)&&outgoingText(n)===expected));
  };
  const waitForOutgoingConfirmation = async (before,message,contact,strict=false,timeout=6000,manualConfirmed=false) => {
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      if(!currentTargetMatches(contact,strict?'scheduled':'manual',manualConfirmed))return {ok:false,reason:'验证期间当前会话发生变化'};
      if(confirmedOutgoing(before,message))return {ok:true,reason:'观察到新增且内容完全一致的己方消息'};
      await sleep(250);
    }
    return {ok:false,reason:'未观察到新增且准确匹配的己方消息；可能发送失败或页面未提供足够证据'};
  };
  const locateEditor = () => first(SELECTORS.editor);
  const insertText = async (editor, text) => {
    if (!editor || !visible(editor)) throw new Error('未找到可见的聊天输入框');
    editor.focus();
    // 不覆盖用户在编辑器中已输入的内容。
    if (compact(editor.textContent)) throw new Error('输入框已有文字：为避免覆盖，请先处理草稿');
    if (typeof document.execCommand !== 'function') throw new Error('浏览器不支持兼容文本输入');
    const inserted = document.execCommand('insertText', false, text);
    await sleep(180);
    if (!inserted || !labelText(editor).includes(text)) throw new Error('文本未能正确进入聊天编辑器');
  };
  const tryOpenNativeStickers = () => {
    const candidates = [
      'button[aria-label*="表情"]',
      'button[title*="表情"]',
      '[data-e2e="emoji-btn"]',
      '[data-e2e="emoji-button"]',
      '[aria-label*="表情包"]'
    ];
    const button = first(candidates);
    if (!button || !visible(button)) {
      log('warn', '未定位到抖音原生表情按钮；请手动打开聊天框中的表情菜单');
      render(); return false;
    }
    button.click();
    log('info', '已尝试打开抖音原生表情面板，请手动选择表情包；也可用实验性精确名称匹配功能');
    render();
    return true;
  };
  const insertMultiline = async (editor,text)=>{
    const lines=String(text).replace(/\r\n/g,'\n').split('\n');
    if(!lines.length)throw Error('发送内容为空');
    for(let i=0;i<lines.length;i++){
      if(lines[i]){
        const ok=document.execCommand('insertText',false,lines[i]);
        if(!ok)throw Error('浏览器拒绝写入消息');
      }
      if(i<lines.length-1){
        for(const kind of ['keydown','keypress','keyup'])editor.dispatchEvent(new KeyboardEvent(kind,{key:'Enter',code:'Enter',shiftKey:true,keyCode:13,which:13,bubbles:true,cancelable:true,composed:true}));
        await sleep(60);
      }
    }
  };
  const insertMessage = async (editor,text)=>{
    if(!editor||!visible(editor))throw Error('找不到可见的聊天输入框');
    if(compact(editor.textContent))throw Error('编辑器存在用户草稿，已拒绝覆盖');
    editor.focus();
    if(typeof document.execCommand!=='function')throw Error('浏览器不支持文本输入');
    if(!text.includes('\n'))return insertText(editor,text);
    await insertMultiline(editor,text);
    await sleep(200);
    if(compact(editor.textContent)!==compact(text))throw Error('多行文本进入编辑器后核对失败');
  };
  const searchInputSelectors=['input.semi-input[placeholder="搜索"]','input[placeholder="搜索"]','[class*="searchSearchInput"] input'];
  const editorSelectors=SELECTORS.editor;
  const currentTargetMatches=(contact,source='manual',manualConfirmed=false)=>
    manualConfirmed?manualTargetEvidence(contact).ok:verifyOpenConversation(contact,source==='scheduled');
  const findAndOpen = async (c,strict=false,manualConfirmed=false)=>{
    let row=locateRow(c);
    if(row && visible(row)){
      row.click();await sleep(safeCount(state.settings.pageLoadWaitTime,200,15000,900));
      if(currentTargetMatches(c,strict?'scheduled':'manual',manualConfirmed))return true;
    }
    if(manualConfirmed)return false;
    // 退化为网页内搜索；只能接受唯一、完全匹配的搜索结果，不做模糊点击。
    const search=first(searchInputSelectors);
    if(!search||!visible(search))return false;
    try{
      search.focus();
      const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
      if(setter)setter.call(search,c.name);else search.value=c.name;
      search.dispatchEvent(new Event('input',{bubbles:true}));
      search.dispatchEvent(new Event('change',{bubbles:true}));
    }catch(_){return false;}
    const deadline=Date.now()+safeCount(state.settings.userSearchTimeout,1000,30000,10000);
    while(Date.now()<deadline){
      if(state.aborted)return false;
      const items=[...document.querySelectorAll('[class*="SearchPanelitem"],[class*="search-result"],[data-e2e="search-result"]')];
      const exact=items.filter(item=>{
        const id=extractId(item);
        if(c.conversationStableId)return id===`id:${c.conversationStableId}`;
        return false;
      });
      if(exact.length===1){
        const item=exact[0],btn=first(['[class*="chat_btn"]','[data-e2e="chat-btn"]','button'],item);
        (btn||item).click();await sleep(safeCount(state.settings.pageLoadWaitTime,200,15000,900));
        if(verifyOpenConversation(c,strict))return true;
        return false;
      }
      if(exact.length>1)return false;
      await sleep(250);
    }
    return false;
  };
  const awaitEditor=async()=>{
    const deadline=Date.now()+safeCount(state.settings.userSearchTimeout,1000,30000,10000);
    while(Date.now()<deadline){
      if(state.aborted)return null;
      const ed=first(editorSelectors);
      if(ed&&visible(ed))return ed;
      await sleep(safeCount(state.settings.chatInputCheckInterval,200,5000,1000));
    }
    return null;
  };
  const performSendEvent=editor=>{
    for(const kind of ['keydown','keypress','keyup'])editor.dispatchEvent(new KeyboardEvent(kind,{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true,composed:true}));
  };
  const markPreSendFailure=(key,reason)=>{
    const old=taskFor(key)||{};
    const attempts=(old.attempts||0)+1;
    const cap=safeCount(state.settings.maxRetryCount,1,8,3);
    const reached=attempts>=cap;
    const delay=(reached&&state.settings.retryAfterMaxReached?state.settings.retryResetInterval:state.settings.autoRetryInterval);
    const nextRetryAt=reached&&!state.settings.retryAfterMaxReached?null:Date.now()+safeCount(delay,1,1440,10)*60000;
    recordTask(key,'FAILED',reason);
    state.tasks[taskId(isoDay(),key)]={...taskFor(key),attempts,nextRetryAt,reachedMax:reached};saveTasks();
    return attempts;
  };
  const mayRetry=key=>{
    const task=taskFor(key);
    if(!task)return true;
    if(['CONFIRMED','UNKNOWN','SUBMITTED'].includes(task.status))return false;
    if(task.status==='FAILED'){
      const attempts=task.attempts||0;
      const cap=safeCount(state.settings.maxRetryCount,1,8,3);
      if(attempts>=cap&&!state.settings.retryAfterMaxReached)return false;
      if(!task.nextRetryAt||Date.now()<task.nextRetryAt)return false;
      if(attempts>=cap){task.attempts=0;saveTasks();}
    }
    return true;
  };
  // V0.4 素材库和逐会话策略：仅允许文字/Unicode Emoji 进入定时队列。
  const makeMaterialId=()=>`mat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
  const upsertMaterial=(draft,id='')=>{
    const title=String(draft.title||'').trim(),content=String(draft.content||'').trim();
    const kind=['TEXT','EMOJI','STICKER'].includes(draft.kind)?draft.kind:'TEXT';
    if(!title||title.length>60||!content||content.length>900)throw Error('素材标题需为 1~60 字，正文需为 1~900 字');
    if(kind==='STICKER' && (content.length>48||content.includes('\n')))throw Error('原生表情只保存官方面板的准确名称，不支持图片上传或自定义 URL');
    const item=normalizeMaterial({id:id||makeMaterialId(),title,kind,content,tags:draft.tags||''});
    if(!item)throw Error('素材格式不正确');
    const index=state.materials.findIndex(x=>x.id===id);
    if(index>=0)state.materials[index]=item;
    else {if(state.materials.length>=LIMIT_MATERIALS)throw Error('素材库最多 150 条');state.materials.push(item);}
    saveMaterials();return item;
  };
  const deleteMaterial=id=>{
    state.materials=state.materials.filter(x=>x.id!==id);
    for(const key of Object.keys(state.contactRules)){
      const rule=state.contactRules[key];rule.materialIds=(rule.materialIds||[]).filter(x=>x!==id);
    }
    saveMaterials();saveRules();
  };
  const materialChoices=(contact)=>{
    const rule=ruleFor(contact.key);
    if(rule.mode==='inherit')return [];
    const ids=rule.materialIds;
    const pool=ids.map(id=>state.materials.find(x=>x.id===id)).filter(Boolean);
    if(rule.mode==='fixed')return pool.slice(0,1);
    return pool;
  };
  const resolveMaterial=(contact)=>{
    const rule=ruleFor(contact.key);
    if(!rule.enabled) return {kind:'DISABLED',text:'',materialId:null};
    if(rule.mode==='inherit')return {kind:'INHERIT',text:null,materialId:null};
    const pool=materialChoices(contact);
    if(!pool.length)return {kind:'INVALID',text:'',materialId:null};
    const usable=pool.filter(m=>m.kind!=='STICKER');
    if(rule.mode==='rotate' && usable.length===0)return {kind:'MANUAL_STICKER',text:'',materialId:null};
    if(rule.mode==='fixed' && pool[0].kind==='STICKER')return {kind:'MANUAL_STICKER',text:'',materialId:pool[0].id};
    const ordered=rule.mode==='rotate'?usable:pool;
    const sig=ordered.map(x=>x.id).join('|');
    const previous=gmGet('rotation:'+encodeURIComponent(contact.key),{});
    const index=previous.signature===sig?Number(previous.nextIndex)||0:0;
    const selected=ordered[((index%ordered.length)+ordered.length)%ordered.length];
    return {kind:selected.kind,text:selected.content,materialId:selected.id,rotationSignature:sig,
      nextIndex:(index+1)%ordered.length,rotate:rule.mode==='rotate'};
  };
  const commitMaterialRotation=(contact,choice)=>{
    if(!choice?.rotate||!choice.materialId)return;
    gmSet('rotation:'+encodeURIComponent(contact.key),{
      signature:choice.rotationSignature,nextIndex:choice.nextIndex,lastMaterialId:choice.materialId,
      lastDay:isoDay(),updatedAt:Date.now()
    });
  };
  const commitLegacyVariants=(choice)=>{
    if(choice?.kind!=='INHERIT')return;
    // 保持 V0.3 原有 TXTAPI / 每周文案轮换语义，但不在预览、失败和 UNKNOWN 时推进。
    if(state.settings.useTxtApi&&state.settings.txtApiMode==='manual')
      pickVariant('txt',textLines(state.settings.txtApiManualText),state.settings.txtApiManualRandom,true);
    if(state.settings.useSpecialHitokoto){
      const k=WEEKDAYS[new Date().getDay()];
      pickVariant('special:'+k,textLines(state.settings['specialHitokoto'+k]),state.settings.specialHitokotoRandom,true);
    }
  };
  const scheduleForContact=(c,now=new Date(),globalDay=null)=>{
    if(!c||!state.selected.has(c.key)||!trustedForSchedule(c)||!mayRetry(c.key))return false;
    const rule=ruleFor(c.key);if(!rule.enabled)return false;
    const material=resolveMaterial(c);
    if(['MANUAL_STICKER','DISABLED','INVALID'].includes(material.kind))return false;
    if(rule.schedule==='inherit')return Boolean(globalDay);
    // 单独时间窗口仅限当天，不跨午夜，防止凌晨被错误记入新日期。
    const target=parseClock(rule.time);if(target===null)return false;
    const minutes=localMinutes(now),grace=safeCount(state.settings.graceMinutes,1,180,90);
    return minutes>=target && minutes<=Math.min(1439,target+grace);
  };
  const scheduledContacts=(now=new Date())=>{
    if(!state.settings.autoEnabled||state.isPaused||document.visibilityState!=='visible')return [];
    const globalDay=isDueNow(now);
    return [...state.selected].filter(k=>scheduleForContact(state.contacts.get(k),now,globalDay));
  };
  const identityReadyForSend = contact => {
    if(contact && contact.verificationState==='VERIFIED' && hasValidIdentityRecord(contact) &&
      contact.stable===true && !contact.requiresReverify && !contact.ambiguous && validStableId(contact.conversationStableId))return true;
    if(contact)logCategory('warn','send',`「${contact.name}」身份待核验；自动发送要求稳定会话 ID`);
    return false;
  };
  // 仅作手动触发的实验性贴纸发送：仅匹配官方弹层里唯一且可见的准确名称，绝不绕过验证。
  const sendNamedSticker = async()=>{
    const name=compact(state.settings.stickerName);
    if(!name||name.length>48){logCategory('warn','send','请在发送页填写要在官方表情面板中精确匹配的表情名称');render();return;}
    const targets=[...state.selected].filter(k=>state.contacts.has(k));
    if(targets.length!==1){logCategory('warn','send','实验性原生表情发送每次只能选择一个会话');render();return;}
    const key=targets[0],c=state.contacts.get(key);
    let manualConfirmed=false;
    if(!identityReadyForSend(c)){
      if(!confirmManualTarget(c,`单次手动试发抖音原生表情「${name}」`)){render();return;}
      manualConfirmed=true;
    }else if(!window.confirm(`实验功能：尝试给「${c.name}」发送抖音原生表情「${name}」。
必须先确认表情在抖音官方选择器里可见，且本人同意。是否继续？`))return;
    if(!mayRetry(key)){logCategory('warn','send','此会话今日已有记录，先核实，禁止盲目重复发送');render();return;}
    await acquireLease(async()=>{
      let submitted=false;
      try{
        if(!await findAndOpen(c,false,manualConfirmed))throw Error('当前会话无法通过页面证据确认');
        const before=snapshotMessages();
        const btn=first(['button[aria-label*="表情"]','button[title*="表情"]','[data-e2e="emoji-btn"]','[data-e2e="emoji-button"]']);
        if(!btn||!visible(btn))throw Error('当前抖音网页没有可定位的表情按钮');
        btn.click();await sleep(500);
        const panels=[...document.querySelectorAll('[role="dialog"],[class*="sticker"],[class*="Sticker"],[class*="EmojiPanel"],[class*="emoji-panel"],[class*="Emoticon"]')].filter(visible);
        if(!panels.length)throw Error('没有识别到官方表情面板');
        const candidates=new Set();
        for(const panel of panels){
          for(const el of panel.querySelectorAll('[title],[aria-label],img[alt],[data-emoji-name]')){
            if(!visible(el))continue;
            const label=compact(el.getAttribute('title')||el.getAttribute('aria-label')||el.getAttribute('alt')||el.getAttribute('data-emoji-name'));
            if(label===name){const clickable=el.closest('button,[role="button"]')||el;candidates.add(clickable);}
          }
        }
        if(candidates.size!==1)throw Error('未找到唯一准确匹配的表情素材（不能模糊选择）');
        if(!currentTargetMatches(c,'manual',manualConfirmed))throw Error('会话在选择表情前已切换');
        recordTask(key,'SUBMITTED','已发起原生表情选择，等待人工核实');submitted=true;
        [...candidates][0].click();await sleep(1600);
        // 二进制素材消息难以用文字严格验证，统一标记 UNKNOWN，要求用户核实。
        recordTask(key,'UNKNOWN','已选择表情素材，但无法保证真实发送成功，请人工核对');
        logCategory('warn','send',`「${c.name}」表情「${name}」已尝试点击，结果待人工核对`);
      }catch(e){
        if(submitted)recordTask(key,'UNKNOWN',e.message);
        else markPreSendFailure(key,'贴纸发送准备失败：'+e.message);
        logCategory('warn','send','原生表情尝试停止：'+e.message);
      }finally{render();}
    });
  };
  const trustedForSchedule = c=>Boolean(c?.stable && c?.verificationState==='VERIFIED' && hasValidIdentityRecord(c) && !c?.ambiguous && !c?.requiresReverify && c?.type==='PERSON');
  const sendToContact = async (key,source='manual')=>{
    const c=state.contacts.get(key);
    if(!c||state.isPaused||state.aborted)return false;
    let manualConfirmed=false;
    if(source==='scheduled'){
      if(!identityReadyForSend(c)){render();return false;}
    }else if(!identityReadyForSend(c)){
      if(!confirmManualTarget(c,'发送一条手动文字消息')){render();return false;}
      manualConfirmed=true;
    }
    if(!mayRetry(key))return false;
    if(source==='scheduled' && (!trustedForSchedule(c) || c.type!=='PERSON' || !navigator.locks?.request || c.ambiguous))return false;
    if(source==='manual' && c.type==='GROUP' && !state.settings.allowGroupManual)return false;
    if(!ruleFor(key).enabled)return false;
    if(['INVALID','DISABLED','MANUAL_STICKER'].includes(resolveMaterial(c).kind)){
      logCategory('warn','send',`「${c.name}」素材策略无法进行文字发送，请到「计划」检查；原生表情仅可手动试发`);
      return false;
    }
    return acquireLease(async()=>{
      if(!mayRetry(key)||state.isPaused||state.aborted)return false;
      let alreadySubmitted=false;
      try{
        if(!await findAndOpen(c,source==='scheduled',manualConfirmed))throw Error('当前聊天身份未核实或无法定位目标');
        const editor=await awaitEditor();
        if(!editor)throw Error('未找到聊天输入框');
        if(!currentTargetMatches(c,source,manualConfirmed))throw Error('会话在输入前已切换');
        const chosen=resolveMaterial(c);
        if(['INVALID','DISABLED','MANUAL_STICKER'].includes(chosen.kind))throw Error('该好友的素材策略不可自动文字发送，请前往「计划」检查或手动选择官方表情');
        const content=await buildMessage(c,false,chosen.kind==='INHERIT'?undefined:chosen.text);
        const message=String(content).replace(/\r\n/g,'\n').trim();
        if(!message||message.length>900)throw Error('发送消息为空或超过 900 字');
        const before=snapshotMessages();
        if(exactOutgoingPresent(message)){
          recordTask(key,'UNKNOWN','页面已存在完全相同的己方消息；为防重复发送已停止，请人工核对日期和来源');
          logCategory('warn','send',`「${c.name}」检测到完全相同的已有消息，已停止重复发送`);
          return false;
        }
        if(state.aborted||state.isPaused)throw Error('脚本已暂停');
        await insertMessage(editor,message);
        if(!currentTargetMatches(c,source,manualConfirmed))throw Error('会话在发送前已切换');
        recordTask(key,'SUBMITTED','准备触发发送，等待检查消息气泡');
        const task=state.tasks[taskId(isoDay(),key)];
        task.attempts=(task.attempts||0)+1;task.messagePreview=message.slice(0,120);
        // 保存本次素材轮换的位置，UNKNOWN 经人工核实后可正确推进。
        task.materialChoice={kind:chosen.kind,materialId:chosen.materialId,
          rotate:!!chosen.rotate,rotationSignature:chosen.rotationSignature||'',nextIndex:chosen.nextIndex};saveTasks();
        alreadySubmitted=true;
        performSendEvent(editor);
        const confirmation=await waitForOutgoingConfirmation(before,message,c,source==='scheduled',6000,manualConfirmed);
        if(confirmation.ok){
          recordTask(key,'CONFIRMED','观察到新出现的己方消息气泡');
          commitMaterialRotation(c,chosen);
          commitLegacyVariants(chosen);
          if(!state.settings.autoFetchFireDays)bumpFireDays(c);
          logCategory('success','send',`「${c.name}」消息在页面获得确认`);
        }else{
          recordTask(key,'UNKNOWN',confirmation.reason+'；禁止盲目重发');
          logCategory('warn','send',`「${c.name}」消息结果未知，请到抖音聊天页人工核对`);
        }
        notify('火花助手',`「${c.name}」${taskFor(key)?.status==='CONFIRMED'?'已确认发送':'待核实发送结果'}`);
        return true;
      }catch(e){
        if(alreadySubmitted){recordTask(key,'UNKNOWN',`发送动作后异常：${e.message}`);logCategory('warn','send',`「${c.name}」结果未知：${e.message}`);}
        else{const n=markPreSendFailure(key,e.message);logCategory('error','send',`「${c.name}」发送前失败（第 ${n} 次）：${e.message}`);}
        return false;
      }finally{render();}
    });
  };
  const sendQueue = async source=>{
    if(state.queueRunning||state.running||state.isPaused)return;
    state.queueRunning=true;state.aborted=false;
    const result={source,confirmed:0,failed:0,unknown:0,skipped:0,runId:`run-${Date.now()}`};
    try{
      let targets=(source==='scheduled'?scheduledContacts():[...state.selected])
        .filter(k=>state.contacts.has(k)&&ruleFor(k).enabled);
      if(!targets.length){logCategory('warn','send','未选择任何有效会话，请先扫描并勾选好友');return;}
      if(source==='manual'&&targets.length>1&&targets.some(key=>!identityReadyForSend(state.contacts.get(key)))){
        logCategory('warn','send','缺少稳定身份时，手动流程每次只能确认并操作一个会话');return;
      }
      if(source==='manual' && state.settings.confirmEachRun && !window.confirm(`确认给 ${targets.length} 个已选会话分别发送消息？请确保对方同意接收。`))return;
      if(source==='scheduled' && (!state.settings.autoEnabled || document.visibilityState!=='visible' || !navigator.locks?.request))return;
      if(state.settings.multiUserMode==='random'){
        targets=targets.map(x=>({key:x,sort:Math.random()})).sort((a,b)=>a.sort-b.sort).map(x=>x.key);
      }
      for(const key of targets){
        if(state.isPaused||state.aborted||(source==='scheduled'&&!state.settings.autoEnabled))break;
        const contact=state.contacts.get(key);
        if(source==='scheduled' && !scheduleForContact(contact,new Date(),isDueNow())){
          result.skipped++;continue;
        }
        if(!mayRetry(key)){result.skipped++;continue;}
        await sendToContact(key,source);
        const s=taskFor(key)?.status;
        if(s==='CONFIRMED')result.confirmed++;
        else if(s==='UNKNOWN'||s==='SUBMITTED')result.unknown++;
        else if(s==='FAILED')result.failed++;
        if(!state.aborted)await sleep(safeCount(state.settings.interUserDelay,1,120,4)*1000);
      }
      const final=todayOutcome();
      logCategory('info','send',`队列结束：确认 ${result.confirmed}、待核实 ${result.unknown}、失败 ${result.failed}、跳过 ${result.skipped}`);
      const done=final.total>0&&final.confirmed+final.unknown+final.failed===final.total;
      if(done){
        const marker='callback:'+isoDay();
        if(!gmGet(marker,false)){
          gmSet(marker,true);
          void backendNotify({mode:'multi',status:final.failed?final.confirmed?'partial':'all_failed':final.unknown?'unknown':'success',sentCount:final.confirmed,failCount:final.failed,unknownCount:final.unknown,failedUsers:[...state.selected].filter(k=>taskFor(k)?.status==='FAILED').map(k=>state.contacts.get(k)?.name||k),runId:result.runId});
        }
      }
    }finally{state.queueRunning=false;render();}
  };
  const tick=()=>{
    if(state.isPaused||state.running||state.queueRunning||document.visibilityState!=='visible')return;
    checkRiskReminder();
    const actionable=scheduledContacts();
    if(!actionable.length)return;
    void sendQueue('scheduled');
  };

  // 扩展功能层：全部通过用户脚本存储，禁止采集/上传登录凭证。
  const safeCount = (v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Math.floor(Number(v)))):fallback;
  const dateShift = (date, n) => {const d=new Date(date); d.setDate(d.getDate()+n); return d;};
  const dayClock = (day,clock) => {const [h,m] = clock.split(':').map(Number);const d=new Date(day);d.setHours(h,m,0,0);return d;};
  const parseClockOrThrow = clock=> {const n=parseClock(clock);if(n===null)throw Error('时间格式必须 HH:mm');return n;};
  const choosePlan = (day=isoDay()) => {
    const key='plan:'+day;
    const old=gmGet(key,null);
    const signature=[state.settings.sendTimeRandom,state.settings.sendTimeRangeStart,state.settings.sendTimeRangeEnd,state.settings.sendTime].join('|');
    if(old?.signature===signature && Number.isFinite(old.when))return old;
    const anchor=new Date(`${day}T12:00:00`);
    let when;
    if(state.settings.sendTimeRandom){
      const start=dayClock(anchor,state.settings.sendTimeRangeStart);
      const finish=dayClock(anchor,state.settings.sendTimeRangeEnd);
      if(finish<=start)finish.setDate(finish.getDate()+1);
      const range=finish.getTime()-start.getTime();
      when=start.getTime()+Math.floor(Math.random()*Math.max(1,range));
    }else when=dayClock(anchor,state.settings.sendTime).getTime();
    const plan={signature,when,day,created:Date.now()};
    gmSet(key,plan);return plan;
  };
  const isDueNow = (now=new Date()) => {
    if(!state.settings.autoEnabled || state.isPaused)return false;
    const today=isoDay(now);
    const plans=[choosePlan(today)];
    // 跨午夜窗口：只读取前一日已经存在的计划，不创建历史计划。
    const yesterday=isoDay(dateShift(now,-1));
    const previous=gmGet('plan:'+yesterday,null);
    if(previous)plans.push(previous);
    const grace=safeCount(state.settings.graceMinutes,1,180,90)*60000;
    const match=plans.find(p=>now.getTime()>=p.when && now.getTime()<=p.when+grace);
    state.nextRun=plans[0]?.when||null;
    return match?.day || false;
  };
  const logCategory = (level,category,message)=>{
    const row={ts:Date.now(),day:isoDay(),at:new Date().toLocaleString(),level,category,message:String(message).slice(0,600)};
    state.logs.push(row);
    const retention=safeCount(state.settings.logRetentionDays,1,90,7),perDay=safeCount(state.settings.maxHistoryLogs,20,5000,500);
    const cutoff=Date.now()-retention*86400000;
    const seen={};
    state.logs=state.logs.filter(e=>e.ts>=cutoff).reverse().filter(e=>{seen[e.day]=(seen[e.day]||0)+1;return seen[e.day]<=perDay;}).reverse();
    gmSet('logs',state.logs);
    if(state.tab==='logs' && state.root)render();
  };
  const notify = (title,message)=>{
    try {if(typeof GM_notification==='function')GM_notification({title,text:message,timeout:3800});}catch(_){/* no notifications */}
  };
  // 这里的截止时间是用户自设的检查提醒点，绝非平台的真实断火截止时间。
  const riskAssessment=(now=new Date())=>{
    const day=isoDay(now),minute=localMinutes(now);
    const clock=parseClock(state.settings.riskCheckTime);
    const checkAt=clock===null?22*60+30:clock;
    const lead=safeCount(state.settings.riskLeadMinutes,5,360,60);
    const items=[],skipped=[];
    for(const key of state.selected){
      const c=state.contacts.get(key);if(!c)continue;
      if(c.type!=='PERSON'||c.ambiguous||c.requiresReverify||!ruleFor(key).enabled){
        skipped.push({key,reason:'身份未确认为单聊、存在歧义或已停用'});continue;
      }
      const t=state.tasks[taskId(day,key)]||null;
      const status=t?.status||'PENDING';
      // 已确认消息不等于火花一定续上；详情仍显示待重燃时继续提示人工核查。
      const verified=Number(c.verifiedAt)||0;
      const rekindle=c.spark==='NEEDS_REKINDLE' && c.source==='详情' && verified>0 &&
        verified<=now.getTime() && now.getTime()-verified<=24*3600000;
      if(status==='CONFIRMED' && !rekindle)continue;
      const severity=rekindle?'REKINDLE_CHECK':status==='UNKNOWN'||status==='SUBMITTED'?'VERIFY':status==='FAILED'?'FAILED':'UNCONFIRMED';
      const windowStatus=minute<checkAt-lead?'EARLY':minute<checkAt?'WINDOW':'AFTER_CHECK_TIME';
      items.push({key,name:c.name,status,severity,windowStatus,rekindle});
    }
    return {day,checkAt,lead,items,skipped,due:items.filter(x=>x.windowStatus==='WINDOW'),
      after:items.filter(x=>x.windowStatus==='AFTER_CHECK_TIME')};
  };
  const aggregateTasks=(now=new Date(),days=7)=>{
    const span=days===30?30:7;
    const available=new Set(Array.from({length:span},(_,i)=>isoDay(dateShift(now,-i))));
    const series=Array.from(available).sort().map(day=>({day,confirmed:0,unknown:0,failed:0,other:0,total:0}));
    const byDay=new Map(series.map(x=>[x.day,x]));
    for(const [key,t] of Object.entries(state.tasks||{})){
      const day=key.slice(0,10);const row=byDay.get(day);
      if(!row || key[10]!=='|' || !t || typeof t.status!=='string')continue;
      const col=t.status==='CONFIRMED'?'confirmed': ['UNKNOWN','SUBMITTED'].includes(t.status)?'unknown':t.status==='FAILED'?'failed':'other';
      row[col]++;row.total++;
    }
    const totals={days:span,confirmed:0,unknown:0,failed:0,other:0,total:0};
    for(const row of series)for(const k of ['confirmed','unknown','failed','other','total'])totals[k]+=row[k];
    return {totals,series};
  };
  const emitTaskAlert=(key,status,reason='')=>{
    const enabled=status==='FAILED'?state.settings.failureAlertsEnabled:state.settings.unknownAlertsEnabled;
    if(!enabled)return false;
    const id=`task:${isoDay()}:${encodeURIComponent(key)}:${status}`;
    const c=state.contacts.get(key);const name=c?.name||'所选会话';
    if(!pushAlert(status,status==='FAILED'?`${name}：发送前失败，请查看日志并核对登录/会话状态`:
      `${name}：发送结果待核实，请先检查官方聊天记录，勿重复发送`,id))return false;
    // 系统通知仅提示数量/类型，不把昵称、聊天正文暴露给桌面通知中心。
    notify('火花助手',status==='FAILED'?'有任务发送前失败，请打开火花助手查看':'有消息发送结果待核实，请不要盲目重发');
    return true;
  };
  const checkRiskReminder=(now=new Date())=>{
    if(!state.settings.riskAlertsEnabled||state.isPaused||document.visibilityState!=='visible')return false;
    const risk=riskAssessment(now);
    const due=risk.due.length?risk.due:risk.after;
    if(!due.length)return false;
    // 今天最多一个汇总：过了自设检查时间才打开页面，依然给出补救提醒。
    const marker='risk-reminder:'+risk.day;
    if(gmGet(marker,false))return false;
    const count=due.length, late=!risk.due.length;
    const message=late?`已超过自设检查时间：${count} 个单聊需核查消息或重燃状态（不等于平台断火）`:
      `自设检查时间临近：${count} 个单聊需核查消息或重燃状态`;
    if(!pushAlert('risk',message,marker,now.getTime()))return false;
    gmSet(marker,true);
    notify('火花助手',late?`${count} 个单聊已过自设检查时间，请核查消息或重燃状态`:
      `${count} 个单聊请在自设检查时间前核对消息或重燃状态`);
    if(state.root)render();
    return true;
  };
  const fireData = ()=>gmGet('fireDaysByContact',{})||{};
  const getFireEntry = c=>{
    const all=fireData();const e=c?.conversationStableId&&c.key===`id:${c.conversationStableId}`?all[c.key]:c?.fireDaysEvidence||null;
    return e && typeof e==='object'?e:null;
  };
  const getFireDays = c=> {
    const e=getFireEntry(c);
    const entryDays=e?.days!==null&&e?.days!==undefined&&Number.isInteger(Number(e.days))&&Number(e.days)>=0?Number(e.days):null;
    const contactDays=c?.days!==null&&c?.days!==undefined&&Number.isInteger(Number(c.days))&&Number(c.days)>=0?Number(c.days):null;
    return entryDays ?? contactDays;
  };
  const setFireDays = (key,days,source='manual') =>{
    const contact=state.contacts.get(key);if(!contact)return;
    const entry={days:safeCount(days,0,100000,0),lastDate:isoDay(),source,updated:Date.now()};
    contact.fireDaysEvidence=entry;contact.days=entry.days;
    if(contact.conversationStableId&&contact.key===`id:${contact.conversationStableId}`){const all=fireData();all[key]=entry;gmSet('fireDaysByContact',all);}
    persistContacts();
  };
  const syncFireFromContact = c=>{
    if(state.settings.autoFetchFireDays && Number.isInteger(c?.days)&&c.days>0)setFireDays(c.key,c.days,'page');
  };
  const bumpFireDays = c=>{
    if(state.settings.autoFetchFireDays)return;
    const e=getFireEntry(c);
    if(e?.lastDate===isoDay())return;
    const baseline=getFireDays(c)??safeCount(state.settings.fireDays,1,100000,1);
    setFireDays(c.key,baseline+1,'estimated');
  };
  const textLines = s=>String(s||'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const pickVariant=(kind,lines,random,commit=false)=>{
    if(!lines.length)return '';
    const saved=gmGet('variants:'+kind,[])||[];
    let index;
    if(random){
      const available=lines.map((_,i)=>i).filter(i=>!saved.includes(i));
      const pool=available.length?available:lines.map((_,i)=>i);
      index=pool[Math.floor(Math.random()*pool.length)];
    }else index=saved.length?(saved[saved.length-1]+1)%lines.length:0;
    if(commit)gmSet('variants:'+kind,[...(saved.length>=lines.length?[]:saved),index]);
    return lines[index];
  };
  const gmFetch=(url,asJson,timeout)=>new Promise((resolve,reject)=>{
    if(typeof GM_xmlhttpRequest!=='function')return reject(Error('脚本管理器不支持 GM_xmlhttpRequest'));
    let checked;try{checked=new URL(url);}catch(_){return reject(Error('网址无效'));}
    if(checked.protocol!=='https:' && checked.hostname!=='localhost' && checked.hostname!=='127.0.0.1')return reject(Error('仅允许 HTTPS 请求'));
    let settled=false;
    const timer=setTimeout(()=>{if(!settled){settled=true;reject(Error('请求超时'));}},safeCount(timeout,1000,60000,8000));
    try{
      GM_xmlhttpRequest({method:'GET',url:checked.href,timeout:safeCount(timeout,1000,60000,8000),anonymous:true,withCredentials:false,
        onload:r=>{if(settled)return;settled=true;clearTimeout(timer);if(r.status<200||r.status>=300)return reject(Error('HTTP '+r.status));
          try{const result=asJson?(typeof r.response==='object'&&r.response!==null?r.response:JSON.parse(r.responseText)):String(r.responseText||'');resolve(result);}catch(e){reject(e);} },
        onerror:()=>{if(settled)return;settled=true;clearTimeout(timer);reject(Error('网络失败'));},
        ontimeout:()=>{if(settled)return;settled=true;clearTimeout(timer);reject(Error('网络超时'));}});
    }catch(e){clearTimeout(timer);reject(e);}
  });
  const getHitokoto = async()=>{
    const data=await gmFetch('https://v1.hitokoto.cn/',true,state.settings.hitokotoTimeout);
    const from=String(data.from||''),who=String(data.from_who||'');
    return String(state.settings.hitokotoFormat||'{hitokoto}')
      .replace(/\{hitokoto\}/g,String(data.hitokoto||''))
      .replace(/\{from\}/g,from?String(state.settings.fromFormat||'{from}').replace(/\{from\}/g,from):'')
      .replace(/\{from_who\}/g,who?String(state.settings.fromWhoFormat||'{from_who}').replace(/\{from_who\}/g,who):'');
  };
  const getTxtContent = async (commit=false)=>{
    if(state.settings.txtApiMode==='api')return String(await gmFetch(state.settings.txtApiUrl,false,state.settings.txtApiTimeout)).trim().slice(0,900);
    return pickVariant('txt',textLines(state.settings.txtApiManualText),state.settings.txtApiManualRandom,commit);
  };
  const getSpecial = async (commit=false)=>{
    const k=WEEKDAYS[new Date().getDay()];
    return pickVariant('special:'+k,textLines(state.settings['specialHitokoto'+k]),state.settings.specialHitokotoRandom,commit);
  };
  const buildMessage = async (c,commit=false,override=undefined)=>{
    let msg=String(override===undefined?(state.settings.message||state.settings.baseMessage||'续火'):override);
    const appendLegacy=override===undefined;
    const parts={
      '[天数]':String(getFireDays(c)??'未知'),
      '[昵称]':String(c?.name||''),
      '[日期]':isoDay(),
      '[时间]':new Date().toLocaleTimeString()
    };
    if(state.settings.useHitokoto){try{parts['[API]']=await getHitokoto();state.apiStatus.hitokoto='成功';}catch(e){state.apiStatus.hitokoto='失败: '+e.message;parts['[API]']='';logCategory('warn','api','一言失败 '+e.message);}}
    else parts['[API]']='';
    if(state.settings.useTxtApi){try{parts['[TXTAPI]']=await getTxtContent(commit);state.apiStatus.txt='成功';}catch(e){state.apiStatus.txt='失败: '+e.message;parts['[TXTAPI]']='';logCategory('warn','api','TXTAPI 失败 '+e.message);}}
    else parts['[TXTAPI]']='';
    if(state.settings.useSpecialHitokoto){try{parts['[专属一言]']=await getSpecial(commit);state.apiStatus.special='成功';}catch(e){state.apiStatus.special='失败: '+e.message;parts['[专属一言]']='';}}
    else parts['[专属一言]']='';
    for(const [needle,val] of Object.entries(parts))msg=msg.split(needle).join(val);
    // 兼容旧脚本：模板不含占位符但启用某个来源时在末尾追加。
    if(appendLegacy&&state.settings.useHitokoto&&!String(state.settings.message||'').includes('[API]')&&parts['[API]'])msg+='\n'+parts['[API]'];
    if(appendLegacy&&state.settings.useTxtApi&&!String(state.settings.message||'').includes('[TXTAPI]')&&parts['[TXTAPI]'])msg+='\n'+parts['[TXTAPI]'];
    if(appendLegacy&&state.settings.useSpecialHitokoto&&!String(state.settings.message||'').includes('[专属一言]')&&parts['[专属一言]'])msg+='\n'+parts['[专属一言]'];
    return msg.trim().slice(0,1000);
  };
  const openStickerPanel =()=>tryOpenNativeStickers();
  const previewMessage=async()=>{
    if(state.running)return;
    const c=state.contacts.get([...state.selected][0]);
    const choice=c?resolveMaterial(c):{kind:'INHERIT'};
    const modalText=choice.kind==='MANUAL_STICKER'?'（原生表情包仅支持手动试发，不能预览为文字）':
      ['DISABLED','INVALID'].includes(choice.kind)?'（该会话的素材策略尚未配置完整）':
      await buildMessage(c,false,choice.kind==='INHERIT'?undefined:choice.text);
    const panel=state.root?.querySelector('#spark-preview-result');
    if(panel)panel.textContent=modalText||'(模板为空)';
  };
  const filteredContacts=()=>{
    const term=state.search.toLowerCase().trim();
    return [...state.contacts.values()].filter(c=>(!term||c.name.toLowerCase().includes(term))&&(state.filter==='all'||c.type===state.filter||c.spark===state.filter));
  };
  const saveExport=(filename,data,mime='application/json')=>{
    const bytes=new Blob([data],{type:mime});const url=URL.createObjectURL(bytes);
    const a=document.createElement('a');a.href=url;a.download=filename;a.style.display='none';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
  };
  const exportConfig=()=>{
    const {callbackToken,...settings}=state.settings;
    const payload={format:'spark-full-v2',backupVersion:3,settings,
      contacts:[...state.contacts.values()].map(({node,...c})=>c),
      selected:[...state.selected],fireDays:fireData(),materials:state.materials,
      contactRules:state.contactRules,exportedAt:Date.now()};
    saveExport(`spark-backup-${isoDay()}.json`,JSON.stringify(payload,null,2));
    gmSet('lastBackupAt',Date.now());
    logCategory('info','ui','备份已导出；包含好友备注与消息模板，请勿公开分享');
  };
  const exportLogs=()=>saveExport(`spark-logs-${isoDay()}.json`,JSON.stringify(state.logs,null,2));
  const exportStatistics=()=>{
    // 纯汇总统计，绝不包含昵称、会话 ID、聊天内容和回调鉴权信息。
    const report=aggregateTasks(new Date(),state.statsDays);
    saveExport(`spark-stats-${state.statsDays}d-${isoDay()}.json`,
      JSON.stringify({format:'spark-stats-v1',generatedAt:new Date().toISOString(),
        scope:'本地脚本任务最终状态；并非抖音平台火花续上率',...report},null,2));
  };
  const parseBackup=(text)=>{
    if(typeof text!=='string'||text.length>1e6)throw Error('备份大小超过 1MB');
    const obj=JSON.parse(text);
    if(!obj||obj.format!=='spark-full-v2'||!obj.settings||typeof obj.settings!=='object'||Array.isArray(obj.settings)||!Array.isArray(obj.contacts)||!Array.isArray(obj.selected))throw Error('备份格式不正确');
    if(obj.contacts.length>1000||obj.selected.length>1000 ||
      (Array.isArray(obj.materials)&&obj.materials.length>LIMIT_MATERIALS) ||
      (obj.contactRules&&Object.keys(obj.contactRules).length>LIMIT_RULES))throw Error('备份超出安全数据上限');
    const safeSettings={};
    for(const [key,defaultValue] of Object.entries(DEFAULTS)){
      if(['callbackToken','autoEnabled','enableScriptBCallback','riskAlertsEnabled','failureAlertsEnabled','unknownAlertsEnabled'].includes(key))continue;
      const v=Object.prototype.hasOwnProperty.call(obj.settings,key)?obj.settings[key]:defaultValue;
      if(typeof v===typeof defaultValue && (typeof v!=='string'||v.length<=2000) && (typeof v!=='number'||Number.isFinite(v)))safeSettings[key]=v;
    }
    const contacts=[];const seen=new Set();
    for(const raw of obj.contacts){
      if(!raw||typeof raw!=='object'||typeof raw.key!=='string'||typeof raw.name!=='string')continue;
      if(raw.key.length<3||raw.key.length>350||!raw.name.trim()||raw.name.length>120||seen.has(raw.key))continue;
      seen.add(raw.key);
      const type=['PERSON','GROUP','UNKNOWN'].includes(raw.type)?raw.type:'UNKNOWN';
      const legacyKeyId=raw.stable===true?(/^id:([\w:\-.]{3,180})$/.exec(raw.key)?.[1]||null):null;
      const explicitId=typeof raw.conversationStableId==='string'&&validStableId(raw.conversationStableId)?raw.conversationStableId:legacyKeyId;
      contacts.push({key:raw.key,name:raw.name,displayName:raw.name,type,conversationType:type,stable:Boolean(explicitId),conversationStableId:explicitId,
        avatar:safeUrl(raw.avatar),days:Number.isInteger(raw.days)&&raw.days>=0&&raw.days<100000?raw.days:null,
        spark:['ACTIVE','NEEDS_REKINDLE','REKINDLED','REKINDLE_UNCERTAIN','UNKNOWN'].includes(raw.spark)?raw.spark:'UNKNOWN',
        ambiguous:!!raw.ambiguous,source:'导入·待复核',verifiedAt:0,typeSource:'unknown',requiresReverify:true,
        verificationState:'UNVERIFIED',identityEvidence:null});
    }
    const keys=new Set(contacts.map(c=>c.key));
    const selected=[...new Set(obj.selected.filter(k=>typeof k==='string'&&keys.has(k)))];
    const materials=(Array.isArray(obj.materials)?obj.materials:[]).map(normalizeMaterial).filter(Boolean);
    const materialKeys=new Set(materials.map(m=>m.id));
    const contactRules=Object.fromEntries(Object.entries(obj.contactRules&&typeof obj.contactRules==='object'&&!Array.isArray(obj.contactRules)?obj.contactRules:{}).filter(([k])=>keys.has(k)).map(([k,v])=>{
      const r=normalizeRule(v);r.materialIds=r.materialIds.filter(id=>materialKeys.has(id));return [k,r];
    }));
    const fireDays=Object.create(null);
    for(const [k,v] of Object.entries(obj.fireDays&&typeof obj.fireDays==='object'&&!Array.isArray(obj.fireDays)?obj.fireDays:{})){
      if(!keys.has(k)||!v||typeof v!=='object')continue;
      const days=Number(v.days);if(Number.isInteger(days)&&days>=0&&days<=100000)fireDays[k]={days,lastDate:String(v.lastDate||'').slice(0,10),source:'backup',updated:0};
    }
    return {settings:safeSettings,contacts,selected,materials,contactRules,fireDays,
      exportedAt:Number(obj.exportedAt)||null};
  };
  const importConfig=async file=>{
    if(!file)return;
    const draft=parseBackup(await file.text());
    state.pendingRestore={name:String(file.name||'backup.json').slice(0,120),draft};
    state.tab='backup';state.settings.activeTab='backup';state.settings.collapsed=false;render();
    logCategory('info','ui','备份解析通过，等待用户确认恢复；当前数据未改动');
  };
  const confirmRestore=()=>{
    const draft=state.pendingRestore?.draft;if(!draft)return false;
    if(!window.confirm(`恢复备份将覆盖现有设置、好友与素材库（${draft.contacts.length} 个会话）。自动发送和桌面提醒仍关闭。确定继续？`))return false;
    state.settings={...DEFAULTS,...draft.settings,callbackToken:state.settings.callbackToken,
      autoEnabled:false,enableScriptBCallback:false,riskAlertsEnabled:false,
      failureAlertsEnabled:false,unknownAlertsEnabled:false,collapsed:false,activeTab:'backup'};saveSettings();
    state.contacts=new Map(draft.contacts.map(c=>[c.key,c]));persistContacts();
    state.selected=new Set(draft.selected);saveSelected();
    state.materials=draft.materials;saveMaterials();
    state.contactRules=draft.contactRules;saveRules();
    gmSet('fireDaysByContact',draft.fireDays);
    // 原有今日发送状态必须保留：不能因为导入备份而允许再次发送。
    state.pendingRestore=null;
    logCategory('success','ui','备份已恢复；会话需重新核验，自动发送和通知默认关闭');
    render();return true;
  };
  const setPaused = v=>{
    state.isPaused=!!v;gmSet('isPaused',state.isPaused);
    if(state.isPaused)state.aborted=true;
    else state.aborted=false;
    logCategory('info','state',v?'脚本已暂停':'脚本已恢复');render();
  };
  const todayOutcome=()=>{
    const result={confirmed:0,unknown:0,failed:0,total:0};
    for(const key of state.selected){result.total++;const s=taskFor(key)?.status;
      if(s==='CONFIRMED')result.confirmed++;else if(s==='UNKNOWN'||s==='SUBMITTED')result.unknown++;else if(s==='FAILED')result.failed++;}
    return result;
  };
  const backendNotify = async (payload,attempt=0)=>{
    if(!state.settings.enableScriptBCallback)return;
    const port=safeCount(state.settings.scriptBCallbackPort,1024,65535,7788);
    if(!state.settings.callbackToken)return logCategory('warn','api','本地回调已启用，但尚未设置回调鉴权密钥');
    if(typeof GM_xmlhttpRequest!=='function')return;
    const packet={...payload,token:state.settings.callbackToken,timestamp:Date.now()};
    const success = await new Promise(resolve=>{
      try{GM_xmlhttpRequest({method:'POST',url:`http://127.0.0.1:${port}/done`,headers:{'Content-Type':'application/json'},data:JSON.stringify(packet),timeout:5000,
        onload:r=>{logCategory(r.status===200?'info':'warn','api',`调度器回调 HTTP ${r.status}`);resolve(r.status===200);},
        onerror:()=>{logCategory('warn','api','调度器回调不可达');resolve(false);},
        ontimeout:()=>{logCategory('warn','api','调度器回调超时');resolve(false);}});}catch(e){logCategory('warn','api',e.message);resolve(false);}
    });
    if(!success&&attempt<2&&!state.isPaused){
      const mins=safeCount(state.settings.backendRetryMinutes,1,180,25);
      setTimeout(()=>void backendNotify(payload,attempt+1),mins*60000);
    }
  };
  const inspectAllSelected=async()=>{
    if(state.running)return;
    const selected=[...state.selected];
    for(const key of selected){if(state.aborted||state.isPaused)break;await inspectContact(key);await sleep(300);}
    render();
  };

  const safeDOMShape=(root,depth=0)=>{
    if(!root||depth>3)return null;
    const classTokens=String(root.className&&typeof root.className==='string'?root.className:'').split(/\s+/).filter(Boolean).slice(0,8);
    const shape={tag:String(root.tagName||'').toLowerCase(),classes:classTokens,
      identityAttributeNames:ID_ATTRS.filter(a=>root.hasAttribute?.(a)),
      dateMetadata:Boolean(root.tagName==='TIME'||root.hasAttribute?.('datetime')||markedDateOrTime(root)),
      textLength:Math.min(9999,String(root.textContent||'').length),children:[]};
    if(depth<3)shape.children=[...root.children||[]].slice(0,12).map(n=>safeDOMShape(n,depth+1));
    return shape;
  };
  const safeAncestorShapes=(root,maxDepth=6)=>{
    const out=[];let cursor=root,depth=0;
    while(cursor&&cursor.nodeType===1&&depth<maxDepth){
      out.push({depth,tag:String(cursor.tagName||'').toLowerCase(),
        classes:String(cursor.className&&typeof cursor.className==='string'?cursor.className:'').split(/\s+/).filter(Boolean).slice(0,10),
        identityAttributeNames:ID_ATTRS.filter(a=>cursor.hasAttribute?.(a)),
        dateMetadata:Boolean(cursor.tagName==='TIME'||cursor.hasAttribute?.('datetime')||markedDateOrTime(cursor))});
      if(!withinConversationBoundary(cursor.parentElement,root))break;
      cursor=cursor.parentElement;depth++;
    }
    return out;
  };
  const safeDateNodeShapes=root=>{
    if(!root)return [];
    try{return [...root.querySelectorAll('time,[datetime],[class*="time"],[class*="Time"],[class*="date"],[class*="Date"],[data-e2e*="time"],[data-e2e*="date"]')]
      .filter(n=>n!==root&&markedDateOrTime(n)).slice(0,12).map(n=>({tag:String(n.tagName||'').toLowerCase(),
        classes:String(n.className&&typeof n.className==='string'?n.className:'').split(/\s+/).filter(Boolean).slice(0,8),
        parentTag:String(n.parentElement?.tagName||'').toLowerCase(),
        parentClasses:String(n.parentElement?.className&&typeof n.parentElement.className==='string'?n.parentElement.className:'').split(/\s+/).filter(Boolean).slice(0,8),
        textLength:Math.min(9999,String(n.textContent||'').length)}));}catch(_){return [];}
  };
  const identityDOMDiagnostics=()=>{
    const header=currentHeader(),selected=activeRowEvidence(),headerRecords=header&&visible(header)?identityRecords(header,{kind:'current-header'}):[],route=routeIdentityRecords();
    const match=selected.id?[...state.contacts.values()].filter(c=>c.conversationStableId===selected.id):[];
    const verified=match.length===1?verificationFor(match[0]):{ok:false,state:'UNVERIFIED'};
    const title=first(SELECTORS.title,selected.row||document);
    const nameNode=leafDisplayNode(title,['[data-e2e*="nickname"]','[data-e2e*="user-name"]','[class*="nickname"]','[class*="Nickname"]','[class*="userName"]','[class*="UserName"]']);
    return {activeRowCount:selected.count,selectedRowIdAvailable:Boolean(selected.id),selectedRowIdConflict:selected.conflict,
      selectionMethod:selected.method||'unknown',
      headerIdAvailable:uniqueIds(headerRecords).length===1,headerIdConflict:recordConflict(headerRecords),
      routeIdAvailable:uniqueIds(route).length===1,detailIdAvailable:uniqueIds([...headerRecords,...route]).length===1,
      matchedStableId:Boolean(verified.ok),verificationState:verified.state,
      evidenceSources:[...new Set([...selected.records,...headerRecords,...route].map(r=>r.source))],
      selectedRowStructure:safeDOMShape(selected.row),selectedRowAncestors:safeAncestorShapes(selected.row),
      titleStructure:safeDOMShape(title),displayNameNode:nameNode?{tag:String(nameNode.tagName||'').toLowerCase(),
        classes:String(nameNode.className&&typeof nameNode.className==='string'?nameNode.className:'').split(/\s+/).filter(Boolean).slice(0,8),
        parentTag:String(nameNode.parentElement?.tagName||'').toLowerCase(),
        parentClasses:String(nameNode.parentElement?.className&&typeof nameNode.parentElement.className==='string'?nameNode.parentElement.className:'').split(/\s+/).filter(Boolean).slice(0,8),
        textLength:Math.min(9999,String(nameNode.textContent||'').length)}:null,
      dateNodeStructures:safeDateNodeShapes(title),headerStructure:safeDOMShape(header),headerAncestors:safeAncestorShapes(header)};
  };
  const getHealth = () => {
    const rows=firstAll(SELECTORS.conversations).filter(visible);
    const editor=locateEditor();const header=currentHeader();
    const selected=[...state.selected].map(k=>state.contacts.get(k)).filter(Boolean);
    const ambiguous=selected.filter(c=>c.ambiguous || [...state.contacts.values()].filter(x=>x.name===c.name).length>1).length;
    const eligible=selected.filter(c=>trustedForSchedule(c) && c.type==='PERSON').length;
    const pending=selected.filter(c=>['UNKNOWN','SUBMITTED'].includes(taskFor(c.key)?.status)).length;
    const invalidPlans=selected.filter(c=>['INVALID','MANUAL_STICKER'].includes(resolveMaterial(c).kind)).length;
    const customTimes=selected.filter(c=>ruleFor(c.key).schedule==='custom').length;
    const identityDOM=identityDOMDiagnostics();
    const result={checkedAt:Date.now(),chatPage:location.pathname.startsWith('/chat'),list:rows.length>0,detail:Boolean(header&&visible(header)),editor:Boolean(editor&&visible(editor)),selected:selected.length,eligible,ambiguous,pending,materials:state.materials.length,invalidPlans,customTimes,webLocks:Boolean(navigator.locks?.request),scheduled:!!state.settings.autoEnabled,paused:state.isPaused,identityDOM};
    state.health=result;return result;
  };
  const safeDiagnostics = () => {
    const v=getHealth();
    // 不导出个人昵称、会话 ID、消息内容、Cookie、截图或敏感设置。
    return {version:VERSION,buildId:BUILD_ID,checkedAt:new Date(v.checkedAt).toISOString(),page:'douyin-chat',checks:v,identityDOM:v.identityDOM,selectors:{conversation:SELECTORS.conversations,editor:SELECTORS.editor,detail:SELECTORS.detail},note:'仅含 DOM 标签、通用类名、属性名、布尔值与数量；不含昵称、稳定 ID 值、聊天内容、URL、Cookie 或 Token'};
  };
  const renderHealth = parent => {
    const data=getHealth();
    parent.append(el('div','notice',`本地 Build ID：${BUILD_ID}。健康诊断只读页面可见 DOM，不访问隐藏接口或上传登录信息。检查通过不等于发送已经成功。`));
    const list=el('div','stack');
    const rows=[['聊天页面',data.chatPage],['会话列表可见',data.list],['当前详情标题可见',data.detail],['聊天编辑器可见',data.editor],['选中项稳定 ID 可读',data.identityDOM.selectedRowIdAvailable],['详情 ID 与选中项匹配',data.identityDOM.matchedStableId],['跨标签执行锁可用',data.webLocks]];
    for(const [title,ok] of rows)list.append(add(el('div','row between health-row'),el('span','',title),el('span',ok?'ok':'bad',ok?'正常':'待检查')));
    parent.append(list);
    parent.append(el('div','section-title','待处理问题'));
    parent.append(el('div','hint',`已选择 ${data.selected} · 符合个人+稳定 ID 候选 ${data.eligible} · 重名/重复 ${data.ambiguous} · 发送结果待核实 ${data.pending} · 素材 ${data.materials} · 专属时间 ${data.customTimes} · 无法执行策略 ${data.invalidPlans}`));
    if(data.ambiguous)parent.append(el('div','notice','有重名或重复会话，禁止自动发送。请在官方聊天界面核对身份。'));
    if(data.pending)parent.append(el('div','notice','有发送结果待核实，不会自动重发。需到抖音官方聊天记录确认。'));
    if(data.invalidPlans)parent.append(el('div','notice','部分好友未选有效素材，或只选了原生表情；这些计划不会进入自动文字发送队列。'));
    if(!data.editor)parent.append(el('div','hint','编辑器通常在选中一条聊天后才出现，未找到并不一定表示登录失败。'));
    parent.append(add(el('div','tools'),button('重新检测','health'),button('导出脱敏诊断','exportDiagnostic')));
    parent.append(el('div','hint',`版本 ${VERSION} · ${BUILD_ID}。自动发送保持关闭；身份验证必须有列表选中项与聊天详情的稳定 ID 交叉证据，昵称和头像不能解锁发送。`));
  };

  const css = `
    :host{all:initial;color-scheme:dark;font:13px/1.45 system-ui,-apple-system,"Microsoft YaHei",sans-serif;}
    *,*:before,*:after{box-sizing:border-box}
    button,input,textarea,select{font:inherit}
    button{cursor:pointer}
    .trigger{position:fixed;right:18px;bottom:20px;background:#171c27;color:#f6f8fb;border:1px solid #344057;border-radius:100px;padding:9px 13px;display:flex;align-items:center;gap:9px;box-shadow:0 10px 28px #0006;z-index:2147483647}
    .trigger:hover{border-color:#ea6377}.dot{background:#fb5164;border-radius:50%;width:7px;height:7px}
    .panel{position:fixed;right:18px;bottom:68px;width:min(370px,calc(100vw - 28px));max-height:min(690px,calc(100vh - 86px));display:flex;flex-direction:column;background:#161c27;border:1px solid #344057;color:#eaf0f7;border-radius:15px;overflow:hidden;box-shadow:0 20px 60px #0009;z-index:2147483646}
    .header{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid #2a3344}.head-title{font-size:15px;font-weight:720;display:flex;align-items:center;gap:7px}.sub{font-size:11px;color:#9aa7bb}.muted{color:#9aa7bb}.mini{border:1px solid #39455b;background:#202938;border-radius:8px;color:#d9e4f4;padding:5px 8px}
    .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;padding:10px 13px}.metric{background:#202838;border-radius:8px;padding:8px;text-align:center}.metric b{display:block;font-size:17px;color:white}.metric span{font-size:10px;color:#aebbd0}
    .tabs{display:flex;gap:4px;padding:0 13px 9px;border-bottom:1px solid #2b3545}.tab{padding:7px 9px;border:0;border-radius:7px;color:#a8b7c8;background:transparent}.tab.active{background:#2e3a50;color:#fff}
    .content{overflow:auto;padding:12px 13px 14px;min-height:110px;scrollbar-width:thin}.row{display:flex;align-items:center;gap:8px}.between{justify-content:space-between}.stack{display:flex;flex-direction:column;gap:8px}.tools{display:flex;gap:6px;flex-wrap:wrap}
    .primary{background:#ed4c69;color:white;border:0;border-radius:8px;padding:8px 11px;font-weight:650}.primary:hover{background:#fa5c7a}.secondary{background:#252e40;color:#e5edf8;border:1px solid #3c4960;border-radius:8px;padding:7px 9px}.secondary:hover{background:#314158}.secondary:disabled,.primary:disabled{opacity:.45;cursor:not-allowed}
    input[type="text"],input[type="time"],input[type="number"],textarea,select{background:#101722;border:1px solid #3b4960;border-radius:8px;color:#f3f7ff;min-width:0;padding:8px;outline:none;width:100%}input:focus,textarea:focus{border-color:#f06b81}
    textarea{min-height:90px;resize:vertical}label{cursor:pointer}.label{display:block;margin:0 0 5px;color:#b5c1d0;font-size:12px}.hint{font-size:11px;color:#98a7bb;line-height:1.6}
    .person{display:grid;grid-template-columns:18px 31px minmax(0,1fr) auto;gap:8px;align-items:center;padding:10px 2px;border-bottom:1px solid #2a3445}.person:last-child{border-bottom:none}.avatar{width:31px;height:31px;border-radius:100%;object-fit:cover;background:#323e55}.avatar.blank{display:flex;align-items:center;justify-content:center;color:#cbd7e8}.who{overflow:hidden}.name{font-weight:650;white-space:nowrap;text-overflow:ellipsis;overflow:hidden;max-width:165px}.meta{font-size:11px;color:#a3b3c8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tag{border-radius:5px;background:#354156;color:#dbe4f1;font-size:10px;padding:2px 5px}.status{color:#ffbc65}.ok{color:#71dba9}.bad{color:#ff879a}.empty{color:#9ba8bb;padding:20px;text-align:center;background:#202939;border-radius:10px}
    .footer{padding:9px 13px;border-top:1px solid #2a3546;font-size:11px;color:#9aa9bc;display:flex;justify-content:space-between;gap:8px}.emoji{padding:6px 9px;background:#273246;border-radius:7px;border:1px solid #3b4a61;font-size:19px}.log{font-size:11px;border-bottom:1px solid #2b3646;padding:7px 0;overflow-wrap:anywhere}
    .badge{border-radius:6px;font-size:10px;padding:2px 5px;background:#334158;color:#c2d0df}.disabled{opacity:.65}
    .notice{background:#2b2933;border:1px solid #66515b;color:#efcecb;padding:8px;border-radius:8px;font-size:11px;line-height:1.6}
    .panel{width:min(350px,calc(100vw - 24px));max-height:min(580px,calc(100vh - 82px));}
    .tabs{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;flex:0 0 auto;padding:5px 10px 7px;white-space:nowrap}.tabs button{min-width:0;white-space:nowrap;flex-shrink:0;padding:5px 1px;font-size:11px}
    .checkrow{background:#222c3b;padding:8px;border-radius:8px}.checkrow input{accent-color:#ee5370;width:15px;height:15px}
    .section-title{font-size:13px;font-weight:700;margin-top:10px;color:#f7c7d1;border-bottom:1px solid #3b4659;padding:6px 0}
    .preview{white-space:pre-wrap;overflow-wrap:anywhere;background:#101823;padding:10px;border-radius:9px;color:#e5edf7;min-height:52px;max-height:220px;overflow:auto;font:12px/1.6 monospace}
    .countdown{color:#f7b25d;font-size:20px;font-weight:750;font-variant-numeric:tabular-nums}.help-detail{border-bottom:1px solid #333e52;padding:8px 2px}.help-detail summary{cursor:pointer;font-weight:650}.help-detail>div{padding:7px 2px}
    .streak-row{border-bottom:1px solid #303b4f;padding:9px 0;min-width:0}.streak-row>div{min-width:0;overflow:hidden}.streak-row span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .content select{max-width:100%}.content input[type=number]{max-width:130px}.content .tools select{flex:1;min-width:90px}
    .content button{line-height:1.35}.content{max-height:calc(100vh - 245px);overflow-y:auto;min-height:120px}
    .health-row{padding:9px 3px;border-bottom:1px solid #313d50}.summary{padding:6px 12px;gap:5px}.metric{padding:5px}.metric b{font-size:15px}.header{padding:9px 12px}.trigger{padding:7px 10px}
    .material-item{padding:9px;background:#202a39;border:1px solid #334359;border-radius:10px;display:flex;flex-direction:column;gap:7px}
    .material-item .stack{gap:2px}.material-preview{white-space:pre-wrap;word-break:break-word;color:#cfdceb;font-size:12px;max-height:75px;overflow:auto}
    .material-choices{display:flex;flex-direction:column;gap:4px;max-height:180px;overflow:auto;padding:6px;border:1px solid #364155;border-radius:9px}
    .rule-summary{border-bottom:1px solid #2b384e;padding:8px 0}.rule-summary .stack{gap:0;min-width:0}.rule-summary strong{max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media(max-width:420px){.panel{width:calc(100vw - 20px)}.content{padding:10px}.trigger{max-width:190px}}
    .alert-entry{display:flex;flex-direction:column;gap:5px;padding:9px 11px;border-radius:10px;border:1px solid #334057;background:#151d2a;margin:5px 0;overflow-wrap:anywhere}
    .stat-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .stat-card{display:flex;flex-direction:column;gap:3px;background:#172131;border:1px solid #354358;border-radius:9px;padding:10px}
    .stat-card b{font-size:20px;color:#dcebf6}.stat-card .muted{font-size:11px}
    .stat-day{display:flex;flex-direction:column;gap:3px;margin:4px 0}
    .stat-track{height:6px;border-radius:6px;background:#263344;overflow:hidden;display:flex}
    .stat-track span{height:100%;display:block}.okbar{background:#31c8a0}.unknownbar{background:#f2b557}.failbar{background:#eb6a75}.otherbar{background:#8092a9}
  `;
  const el = (tag, className = '', text = '') => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (name, action, value = '', className = 'secondary') => {
    const b = el('button', className, name);
    b.type = 'button'; b.dataset.action = action;
    if (value) b.dataset.value = value;
    return b;
  };
  const add = (parent, ...children) => { parent.append(...children); return parent; };
  const input = (type, value, onChange, props = {}) => {
    const x = el(type === 'textarea' ? 'textarea' : 'input');
    if (type !== 'textarea') x.type = type;
    if (type === 'checkbox') x.checked = Boolean(value);
    else x.value = value ?? '';
    Object.entries(props).forEach(([k, v]) => x.setAttribute(k, v));
    x.addEventListener(type === 'checkbox' ? 'change' : 'input', () => onChange(type === 'checkbox' ? x.checked : x.value));
    return x;
  };
  const field = (label, element) => add(el('div'), el('label', 'label', label), element);
  const kindLabel = type => ({ PERSON: '个人', GROUP: '群聊', UNKNOWN: '未识别' }[type] || '未识别');
  const sparkLabel = c => {
    const observed=Number.isInteger(Number(c?.days))&&Number(c.days)>0;
    const source=getFireEntry(c)?.source;
    const d=observed?`${source==='page'?'':source==='estimated'?'估算 ':source==='manual'?'手动 ':''}${c.days}天`:'天数未知';
    return ({ ACTIVE: `🔥 ${d}`, NEEDS_REKINDLE: `✨ 待重燃 · ${d}`, REKINDLED: `🔥 已重燃 · ${d}`, REKINDLE_UNCERTAIN: `重燃信息待确认 · ${d}`, UNKNOWN: observed ? `${d} · 火花状态未知` : '火花未知' })[c?.spark] || '火花未知';
  };
  const renderContacts = parent => {
    const toolbar = el('div', 'stack');
    toolbar.append(add(el('div', 'row between'), el('span', '', `已识别 ${state.contacts.size} 个会话`), button(state.scanning ? '扫描中…' : '扫描更多', 'scan', '', 'secondary')));
    toolbar.append(add(el('div','tools'),button('全选当前筛选','selectFiltered'),button('取消当前筛选','unselectFiltered'),button('核对已选聊天','inspectSelected')));
    toolbar.append(add(el('div','tools'),button('核对当前聊天火花 / 重燃','inspectCurrent'),button('健康检查','tab','health')));
    toolbar.append(input('text', state.search, value => { state.search = value; refreshContactList(); }, { placeholder: '搜索昵称 / 群聊' }));
    const filter = el('select');
    for (const [value, label] of [['all','全部'],['PERSON','个人'],['GROUP','群聊'],['UNKNOWN','未识别'],['NEEDS_REKINDLE','待重燃']]) {
      const option = el('option', '', label); option.value = value; filter.append(option);
    }
    filter.value = state.filter;
    filter.addEventListener('change', () => { state.filter = filter.value; refreshContactList(); });
    toolbar.append(filter);
    const info = el('div','hint','提示：会话类型或重燃状态无明确页面证据时，将显示「未识别」，需要点击详情核对。');
    const list = el('div'); list.id = 'spark-contacts';
    parent.append(toolbar, info, list);
    refreshContactList(list);
  };
  const refreshContactList = (inflightList = null) => {
    const list = inflightList || state.root?.querySelector('#spark-contacts');
    if (!list) return;
    list.replaceChildren();
    const term = state.search.toLowerCase().trim();
    const contacts = [...state.contacts.values()]
      .filter(c => (!term || c.name.toLowerCase().includes(term)) && (state.filter === 'all' || c.type === state.filter || c.spark === state.filter))
      .sort((a,b) => Number(state.selected.has(b.key)) - Number(state.selected.has(a.key)) || a.name.localeCompare(b.name,'zh-CN'));
    if (!contacts.length) { list.append(el('div','empty',state.contacts.size ? '没有符合筛选的会话' : '尚无会话，请打开抖音聊天列表并点击「扫描更多」')); return; }
    for (const c of contacts) {
      const row = el('div','person');
      const check = input('checkbox',state.selected.has(c.key),v=>{
        if (v) state.selected.add(c.key); else state.selected.delete(c.key);
        saveSelected(); refreshHeaderMetrics();
      });
      check.title = `选择${c.name}`;
      const avatar = c.avatar ? el('img','avatar') : el('span','avatar blank','👤');
      if (c.avatar) { avatar.src = c.avatar; avatar.referrerPolicy = 'no-referrer'; }
      const content = el('div','who');
      const name = el('div','name',c.name); name.title = c.name;
      const meta = el('div','meta',`${kindLabel(c.type)} · ${sparkLabel(c)}${c.requiresReverify?' · 身份待核验':''}${c.ambiguous?' · 重复会话':''}`);
      meta.title = `${c.source}读取 · ${c.requiresReverify?'身份待核验':c.verifiedAt ? new Date(c.verifiedAt).toLocaleString() : '未打开详情核对'} · ${c.stable?'有稳定会话ID':'未找到稳定会话ID'}${c.ambiguous?' · 数据重复，请检查':''}`;
      content.append(name,meta);
      const inspect = button('详情','inspect',c.key,'secondary'); inspect.title = c.requiresReverify
        ? '导入会话需核验身份；打开详情检查稳定会话 ID，无法识别时请重新扫描并选择新会话'
        : '打开该会话，核对火花和身份';
      row.append(check,avatar,content,inspect);
      const rule=ruleFor(c.key);
      const actionsRow=add(el('div','tools'),button('发送策略','editRule',c.key));
      actionsRow.style.gridColumn='3 / span 2';row.append(actionsRow);
      if(!rule.enabled)meta.textContent+=' · 已暂停';
      else if(rule.mode!=='inherit')meta.textContent+=rule.mode==='fixed'?' · 专属文案':' · 文案轮换';
      const t = taskFor(c.key);
      if (c.verifiedAt) {
        const classifyRow = el('div','tools');
        classifyRow.style.gridColumn='3 / span 2';
        classifyRow.append(button('核实为个人','setTypePerson',c.key),button('核实为群聊','setTypeGroup',c.key));
        row.append(classifyRow);
      }
      if (t) {
        const foot = el('div','hint',`今日任务：${t.status} · 尝试 ${t.attempts||0} 次 · ${t.reason || ''}`);
        foot.style.gridColumn = '3 / span 2';
        row.append(foot);
        if(t.status==='UNKNOWN' || t.status==='SUBMITTED') {
          const confirm = button('我已核对发出', 'confirmSent', c.key);
          confirm.style.gridColumn = '3 / span 2';
          row.append(confirm);
        }
      }
      list.append(row);
    }
  };
  const metrics = () => {
    let confirmed=0, unknown=0;
    for (const key of state.selected) {
      const s = taskFor(key)?.status;
      if (s === 'CONFIRMED') confirmed++;
      if (s === 'UNKNOWN' || s === 'SUBMITTED') unknown++;
    }
    return { selected: state.selected.size, confirmed, unknown };
  };
  const refreshHeaderMetrics = () => {
    const {selected, confirmed, unknown} = metrics();
    const labels = state.root?.querySelectorAll('[data-metric]');
    if (labels) labels.forEach(node=>{ node.textContent = String(({selected,confirmed,unknown})[node.dataset.metric]); });
    const triggerText = state.root?.querySelector('#spark-trigger-text');
    if (triggerText) triggerText.textContent = `${confirmed}/${selected} 已确认${unreadAlerts()?` · 🔔${unreadAlerts()}`:''}`;
  };
  const renderSend = parent => {
    const wrap = el('div','stack');
    wrap.append(el('div','notice','试用版：默认不自动发送。只支持文字和 Unicode Emoji；抖音原生表情包使用官网面板手动选择，尚未实现自动表情包发送。'));
    const textArea = input('textarea',state.settings.message,value=>{
      state.settings.message=value; saveSettings();
    },{placeholder:'输入给已选好友的消息'});
    wrap.append(field('发送内容（当前只发送单条文本）',textArea));
    const emojis = el('div','tools');
    for(const emoji of ['🔥','❤️','😂','🥰','😘','👍','✨','🫶']) emojis.append(button(emoji,'emoji',emoji,'emoji'));
    wrap.append(emojis);
    const actions=el('div','tools');
    actions.append(button('发送给已选会话','send','', 'primary'),button('打开抖音表情面板','stickers'));
    wrap.append(actions);
    wrap.append(el('div','hint','发送前要求当前会话标题匹配；编辑框有草稿时不覆盖。发送结果无法确认会标记 UNKNOWN，今日不再自动重发。'));
    parent.append(wrap);
  };
  const renderSettings = parent => {
    const wrap=el('div','stack');
    const enable=input('checkbox',state.settings.autoEnabled,v=>{
      if(v && !window.confirm('开启后，只对识别为个人且有稳定会话 ID 的已选好友尝试自动发送。需要保持抖音聊天页面在前台且登录有效。确定开启？')) {enable.checked=false;return;}
      state.settings.autoEnabled=v; saveSettings(); log('info',`定时发送${v?'开启':'关闭'}`);
    });
    wrap.append(add(el('label','row'),enable,el('span','','启用定时发送（默认关闭）')));
    wrap.append(field('计划发送时间（本地时间）',input('time',state.settings.sendTime,v=>{if(parseClock(v)!==null){state.settings.sendTime=v;saveSettings();}})));
    wrap.append(field('允许延迟执行分钟（1–120）',input('number',state.settings.graceMinutes,v=>{
      state.settings.graceMinutes=Math.max(1,Math.min(120,Number(v)||60));saveSettings();
    },{min:'1',max:'120'})));
    wrap.append(el('div','notice','仅在浏览器窗口保持打开、该标签页位于前台、账号仍登录并能可靠识别会话时尝试。非 GitHub Actions/云端常驻方案。'));
    wrap.append(button('清理今天的任务状态（慎用）','clearTasks'));
    parent.append(wrap);
  };
  const renderLogs = parent => {
    const head=el('div','row between');head.append(el('b','','运行记录'),button('清空记录','clearLogs'));parent.append(head);
    const list=el('div');
    for(const entry of [...state.logs].reverse().slice(0,60)) {
      const row=el('div','log');
      const line=el('span',entry.level==='error'?'bad':entry.level==='success'?'ok':'muted',`[${entry.at}] [${entry.level}] `);
      row.append(line,el('span','',entry.message));list.append(row);
    }
    if(!list.childNodes.length)list.append(el('div','empty','暂无运行记录'));
    parent.append(list);
  };
  const setOption = (key,value)=>{state.settings[key]=value;saveSettings();};
  const numberControl=(title,key,min,max)=>field(title,input('number',state.settings[key],v=>setOption(key,safeCount(v,min,max,state.settings[key])),{min:String(min),max:String(max)}));
  const textControl=(title,key,placeholder='')=>field(title,input('text',state.settings[key],v=>setOption(key,v),{placeholder}));
  const textAreaControl=(title,key)=>field(title,input('textarea',state.settings[key],v=>setOption(key,v)));
  const checkControl=(title,key)=>{
    const cb=input('checkbox',state.settings[key],v=>{setOption(key,v);logCategory('info','ui',title+' '+(v?'开启':'关闭'));if(['sendTimeRandom'].includes(key))render();});
    return add(el('label','row checkrow'),cb,el('span','',title));
  };
  const selectControl=(title,key,opts)=>{
    const sel=el('select');
    for(const [v,lab] of opts){const o=el('option','',lab);o.value=v;sel.append(o);}
    sel.value=String(state.settings[key]);
    sel.addEventListener('change',()=>{setOption(key,sel.value);if(['txtApiMode'].includes(key))render();});
    return field(title,sel);
  };
  const sectionTitle = (v)=>el('div','section-title',v);
  const materialKindLabel=k=>({TEXT:'文字',EMOJI:'Emoji',STICKER:'原生表情名称'}[k]||'文字');
  const selectWidget=(options,value,onChange)=>{
    const sel=el('select');
    for(const [v,label] of options){const option=el('option','',label);option.value=v;sel.append(option);}
    sel.value=value;
    sel.addEventListener('change',()=>onChange(sel.value));return sel;
  };
  const renderLibrary=parent=>{
    parent.append(el('div','notice','素材仅保存在本机脚本存储中。文字/Unicode Emoji 可参与自动轮换；抖音原生表情只保存准确名称，必须在官方面板手动试发、人工核对。'));
    parent.append(sectionTitle(state.materialEditId?'编辑素材':'新增素材'));
    const draft=state.materialDraft;
    parent.append(field('素材名称',input('text',draft.title,v=>{draft.title=v;},{maxlength:'60',placeholder:'例如：周一问候'})));
    parent.append(field('素材类型',selectWidget([['TEXT','普通文字'],['EMOJI','Unicode Emoji（文本）'],['STICKER','抖音原生表情（仅手动）']],draft.kind,v=>{draft.kind=v;})));
    parent.append(field('文字内容 / 表情的准确名称',input('textarea',draft.content,v=>{draft.content=v;},{rows:'3',maxlength:'900',placeholder:'例如：今天也要续火🔥 / 原生表情精确名称'})));
    parent.append(field('标签（用空格或逗号区分）',input('text',draft.tags,v=>{draft.tags=v;},{maxlength:'100',placeholder:'问候 周末'})));
    parent.append(add(el('div','tools'),button(state.materialEditId?'保存修改':'新增到素材库','saveMaterial','', 'primary'),button('清空编辑','resetMaterialDraft')));
    parent.append(sectionTitle(`已收藏 ${state.materials.length}/${LIMIT_MATERIALS} 项`));
    if(!state.materials.length)parent.append(el('div','empty','还没有素材，先添加一条文字或 Emoji 文案。'));
    for(const m of state.materials){
      const wrap=el('div','material-item');
      wrap.append(add(el('div','row between'),add(el('div','stack'),el('strong','',m.title),el('span','muted',`${materialKindLabel(m.kind)}${m.tags?' · '+m.tags:''}`)),
        add(el('div','tools'),button('编辑','editMaterial',m.id),button('删除','removeMaterial',m.id))));
      wrap.append(el('div','material-preview',m.content));
      if(m.kind==='STICKER')wrap.append(button('设为手动试发表情','useStickerMaterial',m.id));
      parent.append(wrap);
    }
  };
  const renderPlans=parent=>{
    parent.append(el('div','notice','好友个性化策略仅对当前选择的会话生效。只有稳定 ID、已核对为个人的会话才能执行定时任务。默认沿用全局文案和时间。'));
    const people=[...state.contacts.values()].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
    if(!people.length){parent.append(el('div','empty','请先到「会话」页扫描好友'));return;}
    const chosen=state.contacts.has(state.editContactKey)?state.editContactKey:people[0].key;
    state.editContactKey=chosen;
    parent.append(field('编辑哪位好友的策略',selectWidget(people.map(c=>[c.key,`${c.name}（${kindLabel(c.type)}${c.stable?' · 有ID':' · 待核实'}）`]),chosen,v=>{state.editContactKey=v;render();})));
    const c=state.contacts.get(chosen),rule=ruleFor(chosen);
    parent.append(el('div','hint',`当前：${kindLabel(c.type)} · ${c.stable?'稳定会话 ID 已识别':'无稳定会话 ID'} · ${c.ambiguous?'同名/重复，禁止自动发送':'会话信息可继续核对'}`));
    const enabled=input('checkbox',rule.enabled,v=>{state.contactRules[chosen]={...ruleFor(chosen),enabled:v};saveRules();render();});
    parent.append(add(el('label','row checkrow'),enabled,el('span','','允许此会话参与发送')));
    parent.append(field('分组备注（仅本地分类）',input('text',rule.group,v=>{state.contactRules[chosen]={...ruleFor(chosen),group:String(v).slice(0,40)};saveRules();},{maxlength:'40'})));
    parent.append(field('消息策略',selectWidget([['inherit','使用全局消息模板'],['fixed','固定使用一条收藏素材'],['rotate','从多条收藏素材中轮换']],rule.mode,v=>{
      state.contactRules[chosen]={...ruleFor(chosen),mode:v};saveRules();render();
    })));
    if(rule.mode!=='inherit'){
      const box=el('div','material-choices');
      if(!state.materials.length)box.append(el('div','hint','素材库为空，请先到「素材」页添加内容。'));
      for(const m of state.materials){
        const checked=rule.materialIds.includes(m.id);
        const cb=input(rule.mode==='fixed'?'radio':'checkbox',checked,v=>{
          const prev=ruleFor(chosen);
          if(rule.mode==='fixed')prev.materialIds=[m.id];
          else prev.materialIds=v?[...new Set([...prev.materialIds,m.id])]:prev.materialIds.filter(id=>id!==m.id);
          state.contactRules[chosen]=prev;saveRules();
          if(rule.mode==='fixed')render();
        });
        if(rule.mode==='fixed'){cb.name='spark-fixed-material';cb.checked=rule.materialIds[0]===m.id;cb.addEventListener('change',()=>{state.contactRules[chosen]={...ruleFor(chosen),materialIds:[m.id]};saveRules();render();});}
        const note=m.kind==='STICKER'?'（仅人工试发，定时跳过）':'';
        box.append(add(el('label','row checkrow'),cb,el('span','',`${m.title} · ${materialKindLabel(m.kind)}${note}`)));
      }
      parent.append(field(rule.mode==='fixed'?'指定唯一素材':'轮换素材池（按显示顺序）',box));
      if(rule.mode==='rotate')parent.append(el('div','hint','轮换位置只在确认该条文字已发送后推进；预览和发送失败不会消耗下一条素材。'));
    }
    parent.append(field('每日计划',selectWidget([['inherit','跟随全局固定/随机时间'],['custom','使用这个好友自己的固定时间']],rule.schedule,v=>{
      state.contactRules[chosen]={...ruleFor(chosen),schedule:v};saveRules();render();
    })));
    if(rule.schedule==='custom')parent.append(field('该好友的发送时间（本地 HH:mm）',input('time',rule.time,v=>{
      if(parseClock(v)!==null){state.contactRules[chosen]={...ruleFor(chosen),time:v};saveRules();}
    })));
    const chosenMaterial=resolveMaterial(c);
    const planText=chosenMaterial.kind==='MANUAL_STICKER'?'原生表情：仅支持手动发送，计划不会自动执行':
      chosenMaterial.kind==='INVALID'?'未选有效素材，计划无法执行':
      chosenMaterial.kind==='DISABLED'?'该好友已暂停发送':
      (chosenMaterial.kind==='INHERIT'?'全局模板':`素材：${state.materials.find(m=>m.id===chosenMaterial.materialId)?.title||'未知'}`);
    const timeText=rule.schedule==='custom'?rule.time:'跟随全局计划';
    parent.append(el('div','notice',`当前计划：${timeText} · ${planText}\n重要：定时需手动开启全局自动发送，且必须满足身份与页面可见性检查。`));
    parent.append(add(el('div','tools'),button('预览此好友消息','previewRule',chosen),button('删除自定义策略','resetRule',chosen)));
    const preview=el('pre','preview','点击「预览」查看此人的下一条消息');preview.id='spark-rule-preview';parent.append(preview);
    parent.append(sectionTitle('好友策略总览'));
    for(const cc of people.filter(x=>state.selected.has(x.key)).slice(0,80)){
      const r=ruleFor(cc.key);
      const summary=`${r.enabled?'启用':'暂停'} · ${r.mode==='inherit'?'全局模板':r.mode==='fixed'?'固定素材':'轮换素材'} · ${r.schedule==='inherit'?'全局时间':r.time}`;
      const row=el('div','row between rule-summary');row.append(add(el('div','stack'),el('strong','',cc.name),el('span','muted',`${r.group} · ${summary}`)),button('编辑','editRule',cc.key));parent.append(row);
    }
  };
  const renderSendFull = parent=>{
    parent.append(el('div','notice','优先测试好友单次文字/Emoji 发送，原生表情包使用抖音官方面板手动选择。本工具不会通过非公开接口发送贴纸。'));
    const area=input('textarea',state.settings.message,v=>setOption('message',v),{rows:'5',placeholder:'支持 [昵称] [天数] [日期] [API] [TXTAPI] [专属一言]'});
    area.id='spark-template-area';parent.append(field('消息模板',area));
    const emojis=el('div','tools');for(const emoji of ['🔥','❤️','😂','🥰','😘','👍','✨','🫶','🎉','🌙'])emojis.append(button(emoji,'emoji',emoji,'emoji'));
    parent.append(emojis);
    parent.append(add(el('div','tools'),button('预览最终文案','preview','', 'primary'),button('打开原生表情','stickers'),button('立即批量发送','send','', 'secondary')));
    parent.append(field('实验：官方表情包准确名称（需对方同意）',input('text',state.settings.stickerName,v=>setOption('stickerName',v),{placeholder:'输入当前官方面板里看到的准确表情名称'})));
    parent.append(button('试发指定原生表情（单人 · 实验）','sendSticker'));
    parent.append(el('div','hint','仅当面板和素材均可唯一定位时尝试点击；不能保证自动发送成功，不支持定时表情包，结果始终需人工核实。'));
    const preview=el('pre','preview','单击「预览最终文案」显示内容（预览不会消耗随机文案序列）。');preview.id='spark-preview-result';parent.append(preview);
    parent.append(el('div','hint',`最近接口状态：一言 ${state.apiStatus.hitokoto||'未请求'} · TXT ${state.apiStatus.txt||'未请求'} · 专属 ${state.apiStatus.special||'未请求'}`));
    parent.append(add(el('div','tools'),button('打开素材库','tab','materials'),button('好友独立计划','tab','plans')));
    parent.append(sectionTitle('发送方式'));
    parent.append(selectControl('好友发送顺序','multiUserMode',[['sequential','按选择顺序'],['random','随机顺序']]));
    parent.append(numberControl('相邻好友间隔（秒）','interUserDelay',1,120));
    parent.append(checkControl('立即发送前显示确认','confirmEachRun'));
    parent.append(checkControl('失败后仍保留当前用户待重试','multiUserRetrySame'));
    parent.append(el('div','hint','安全限制：如果找不到目标会话、编辑框含草稿或结果不明确，不会猜测已成功；UNKNOWN 状态不自动重发。'));
  };
  const renderTimeFull = parent=>{
    parent.append(add(el('div','row between'),el('strong','',state.isPaused?'⏸ 已暂停':'▶️ 调度器就绪'),button(state.isPaused?'恢复执行':'暂停全部', 'pause')));
    const auto=input('checkbox',state.settings.autoEnabled,v=>{
      if(v && !window.confirm('启用定时发送？确保好友知情、确认账号正常登录，并保持网页可运行。自动发送仅允许已经确认的个人会话。')){auto.checked=false;return;}
      setOption('autoEnabled',v);logCategory('info','state','自动发送'+(v?'启用':'禁用'));render();
    });
    parent.append(add(el('label','row checkrow'),auto,el('span','','启用每日自动发送（默认关闭）')));
    // 为兼容旧备份保留设置字段，但 V0.3 不再允许缺乏稳定 ID 的自动发送。
    parent.append(el('div','hint','V0.3 自动发送仅允许有稳定 ID 且能与当前活动会话 ID 交叉核对的个人聊天。无法确认则跳过，不靠昵称猜测。'));
    parent.append(checkControl('从指定范围随机选时间','sendTimeRandom'));
    if(state.settings.sendTimeRandom){
      parent.append(field('随机范围开始',input('time',state.settings.sendTimeRangeStart,v=>{if(parseClock(v)!==null){setOption('sendTimeRangeStart',v);render();}})));
      parent.append(field('随机范围结束（可跨午夜）',input('time',state.settings.sendTimeRangeEnd,v=>{if(parseClock(v)!==null){setOption('sendTimeRangeEnd',v);render();}})));
    }else parent.append(field('固定发送时间',input('time',state.settings.sendTime,v=>{if(parseClock(v)!==null){setOption('sendTime',v);render();}})));
    parent.append(numberControl('迟到容忍（分钟）','graceMinutes',1,180));
    parent.append(numberControl('首次进入页面延迟（秒）','initialDelay',0,180));
    const plan=choosePlan();
    parent.append(el('div','notice',`本次全局计划：${new Date(plan.when).toLocaleString()}。好友独立时间仅在聊天页持续打开时才能执行。本地外部调度器仍按全局时间启动浏览器；关闭电脑后不执行。`));
    const timer=el('div','countdown','--:--:--');timer.id='spark-next-countdown';parent.append(add(el('div','row between'),el('span','muted','距离下次计划发送'),timer));queueMicrotask(updateCountdown);
    parent.append(add(el('div','tools'),button('刷新计划时间','refreshPlan'),button('立即检查是否到时','tick')));
    parent.append(sectionTitle('失败重试'));
    parent.append(numberControl('最大尝试次数（仅发送前失败）','maxRetryCount',1,8));
    parent.append(numberControl('每次重试间隔（分钟）','autoRetryInterval',1,120));
    parent.append(checkControl('超过最大次数后允许下次重新尝试','retryAfterMaxReached'));
    parent.append(numberControl('重试恢复间隔（分钟）','retryResetInterval',1,1440));
    parent.append(el('div','hint','触发发送后的结果 UNKNOWN 不会重试。重试次数和失败记录会持久化，避免刷新的意外重复。'));
  };
  const renderTextFull = parent=>{
    parent.append(sectionTitle('一言 API'));
    parent.append(checkControl('使用一言 API','useHitokoto'));
    parent.append(textControl('一言格式','hitokotoFormat'));
    parent.append(textControl('来源格式','fromFormat'));
    parent.append(textControl('作者格式','fromWhoFormat'));
    parent.append(numberControl('一言接口超时（毫秒）','hitokotoTimeout',1000,60000));
    parent.append(sectionTitle('TXTAPI / 本地文案'));
    parent.append(checkControl('启用 TXTAPI 模板','useTxtApi'));
    parent.append(selectControl('TXTAPI 模式','txtApiMode',[['manual','手动文案列表'],['api','从 HTTPS 地址取文本']]));
    if(state.settings.txtApiMode==='manual'){
      parent.append(textAreaControl('自定义文案（每行一条）','txtApiManualText'));
      parent.append(checkControl('随机抽取不重复文案','txtApiManualRandom'));
    }else{
      parent.append(textControl('TXT API HTTPS URL','txtApiUrl'));
      parent.append(el('div','notice','自定义 URL 仅允许 HTTPS。此请求可能将你的 IP 暴露给第三方，建议只使用你信任的网站。不会附带抖音 Cookie。'));
      parent.append(numberControl('TXT API 超时（毫秒）','txtApiTimeout',1000,60000));
    }
    parent.append(sectionTitle('每周专属一言'));
    parent.append(checkControl('启用专属一言','useSpecialHitokoto'));
    parent.append(checkControl('按天随机抽取不重复','specialHitokotoRandom'));
    WEEKDAYS.forEach((key,i)=>parent.append(textAreaControl(['周日','周一','周二','周三','周四','周五','周六'][i],`specialHitokoto${key}`)));
    parent.append(add(el('div','tools'),button('恢复文案轮换记录','resetVariants'),button('预览当前消息','preview')));
    const p=el('pre','preview','');p.id='spark-preview-result';parent.append(p);
  };
  const renderStreakFull = parent=>{
    parent.append(el('div','notice','火花天数是抖音界面读数，不是脚本发送计数。没有真实界面证据时，仅能显示估算或未知；重燃状态必须进入聊天详情确认。'));
    parent.append(checkControl('自动从页面同步火花天数','autoFetchFireDays'));
    parent.append(numberControl('续火估算起始天数（不代表抖音页面读数）','fireDays',1,100000));
    parent.append(add(el('div','tools'),button('重新扫描可见会话','scan'),button('核对当前聊天重燃状态','inspectCurrent')));
    const list=el('div','stack');
    for(const c of [...state.contacts.values()].sort((a,b)=>getFireDays(b)-getFireDays(a)).slice(0,150)){
      const row=el('div','row between streak-row');
      const name=el('span','',c.name);name.title=c.name;
      const count=el('span','muted',sparkLabel(c));
      row.append(add(el('div','stack'),name,count),button('修改天数','editDays',c.key));list.append(row);
    }
    if(!list.children.length)list.append(el('div','empty','暂无好友，请先扫描聊天列表'));
    parent.append(list);
    parent.append(add(el('div','tools'),button('清空火花天数缓存','clearStreaks'),button('重置今日发送记录','clearTasks')));
  };
  const renderLogsFull = parent=>{
    parent.append(add(el('div','row between'),el('b','','日志中心'),add(el('div','tools'),button('导出日志','exportLogs'),button('清空','clearLogs'))));
    const filter=state.logFilter;
    const row=el('div','tools');
    const day=el('select');const days=[...new Set(state.logs.map(x=>x.day||isoDay()))].sort().reverse();
    for(const [v,l] of [['','全部日期'],...days.map(d=>[d,d])]){const o=el('option','',l);o.value=v;day.append(o);}day.value=filter.day;
    day.addEventListener('change',()=>{filter.day=day.value;render();});
    const level=el('select');for(const [v,l] of [['all','全部级别'],['info','普通'],['success','成功'],['warn','警告'],['error','错误']]){const o=el('option','',l);o.value=v;level.append(o);}level.value=filter.level;
    level.addEventListener('change',()=>{filter.level=level.value;render();});
    const category=el('select');for(const [v,l] of [['all','全部分类'],['send','发送'],['api','接口'],['ui','界面'],['state','状态'],['system','系统']]){const o=el('option','',l);o.value=v;category.append(o);}category.value=filter.category;
    category.addEventListener('change',()=>{filter.category=category.value;render();});
    row.append(day,level,category);parent.append(row);
    parent.append(input('text',filter.keyword,k=>{filter.keyword=k;refreshLogs();},{placeholder:'搜索日志关键词'}));
    const list=el('div');list.id='spark-log-list';parent.append(list);queueMicrotask(refreshLogs);
  };
  const refreshLogs=()=>{
    const holder=state.root?.querySelector('#spark-log-list');if(!holder)return;
    holder.replaceChildren();const f=state.logFilter;
    const rows=state.logs.filter(e=>(!f.day||e.day===f.day)&&(f.level==='all'||e.level===f.level)&&(f.category==='all'||(e.category||'system')===f.category)&&(!f.keyword||String(e.message).includes(f.keyword))).slice(-safeCount(state.settings.maxViewLogs,20,1000,100)).reverse();
    for(const entry of rows){const row=el('div','log');row.append(el('span',entry.level==='error'?'bad':entry.level==='success'?'ok':'muted',`[${entry.at}] [${entry.category||'system'}] ${entry.level}: `),el('span','',entry.message));holder.append(row);}
    if(!rows.length)holder.append(el('div','empty','暂无符合条件的日志'));
  };
  const renderAdvanced = parent=>{
    parent.append(sectionTitle('账号与本地调度器'));
    parent.append(checkControl('允许本地调度器接收完成通知','enableScriptBCallback'));
    parent.append(numberControl('本地回调端口','scriptBCallbackPort',1024,65535));
    parent.append(field('本地回调鉴权令牌',input('text',state.settings.callbackToken,v=>setOption('callbackToken',v),{placeholder:'填写与调度器 config.json 一致的随机令牌'})));
    parent.append(numberControl('后端等待重试间隔（分钟）','backendRetryMinutes',1,180));
    parent.append(el('div','notice','本地回调发向 127.0.0.1，只供你的个人电脑调度器使用，不包含 Cookie。多账号应使用隔离的浏览器 Profile。'));
    parent.append(sectionTitle('页面适配与日志'));
    parent.append(numberControl('搜索超时（毫秒）','userSearchTimeout',1000,30000));
    parent.append(numberControl('聊天页等待（毫秒）','pageLoadWaitTime',200,15000));
    parent.append(numberControl('编辑器检测间隔（毫秒）','chatInputCheckInterval',200,5000));
    parent.append(numberControl('面板实时日志条数','maxLiveLogs',3,50));
    parent.append(numberControl('单次最多查看日志数','maxViewLogs',20,1000));
    parent.append(numberControl('每天最多保留日志数','maxHistoryLogs',20,5000));
    parent.append(numberControl('日志保留天数','logRetentionDays',1,90));
    parent.append(sectionTitle('导入导出与重置'));
    parent.append(add(el('div','tools'),button('导出设置/好友','exportConfig'),button('导出日志','exportLogs'),button('导入备份','importConfig')));
    parent.append(add(el('div','tools'),button('恢复默认设置','resetConfig'),button('清空全部数据','clearEverything')));
    const hidden=el('input');hidden.type='file';hidden.accept='application/json,.json';hidden.id='spark-import-file';hidden.style.display='none';
    hidden.addEventListener('change',()=>{void importConfig(hidden.files?.[0]).catch(e=>{logCategory('error','ui','导入失败：'+e.message);render();});});parent.append(hidden);
    parent.append(el('div','hint','备份文件不包含回调令牌、登录 Cookie 与浏览器身份数据。导入备份后定时发送仍保持关闭。'));
  };
  const renderAlerts=parent=>{
    parent.append(el('div','notice','以下仅为你自设的每日检查时间提醒，绝非抖音官方断火截止时间。消息发送确认也不等于火花一定续上。桌面通知需手动开启，且脚本须保持运行。'));
    parent.append(sectionTitle('提醒规则'));
    parent.append(checkControl('启用每日未确认消息提醒','riskAlertsEnabled'));
    parent.append(field('每日检查时间（本地时间）',input('time',state.settings.riskCheckTime,v=>{
      if(parseClock(v)!==null){setOption('riskCheckTime',v);render();}
    })));
    parent.append(numberControl('提前提醒（分钟）','riskLeadMinutes',5,360));
    parent.append(checkControl('发送前失败：桌面通知 + 站内提醒','failureAlertsEnabled'));
    parent.append(checkControl('发送后结果不明：桌面通知 + 站内提醒','unknownAlertsEnabled'));
    const risk=riskAssessment();
    parent.append(sectionTitle(`今日待关注 ${risk.items.length} 个（来自已选单聊）`));
    parent.append(el('div','hint',`检查时间 ${state.settings.riskCheckTime} · 提前 ${risk.lead} 分钟提醒 · 每天只发一次汇总。${risk.skipped.length} 个会话因群聊/未知身份/停用而未参与。`));
    if(!risk.items.length)parent.append(el('div','empty','没有需关注的已选单聊；这不代表平台火花状态正常。'));
    for(const item of risk.items.slice(0,80)){
      const c=state.contacts.get(item.key);
      const label=item.severity==='REKINDLE_CHECK'?'详情曾显示「待重燃」 · 请重新核实':item.severity==='FAILED'?'发送前失败':item.severity==='VERIFY'?'消息结果不明 · 禁止重复发送':'今日无确认发送记录';
      const timeHint=item.windowStatus==='EARLY'?'检查时间尚早':item.windowStatus==='WINDOW'?'接近自设检查时间':'已过自设检查时间（不代表平台断火）';
      const row=el('div','alert-entry');
      row.append(add(el('div','row between'),el('strong','',c?.name||'未命名会话'),el('span',item.severity==='REKINDLE_CHECK'?'bad':'muted',label)),el('div','hint',timeHint));
      parent.append(row);
    }
    parent.append(add(el('div','tools'),button('立即重新评估','refreshRisk'),button('清除已读提醒','clearReadAlerts')));
    parent.append(sectionTitle(`通知中心 · 未读 ${unreadAlerts()} 条`));
    parent.append(field('筛选通知',selectWidget([['all','全部通知'],['unread','只看未读'],['risk','检查提醒'],['FAILED','发送前失败'],['UNKNOWN','待核实结果']],state.alertFilter,v=>{state.alertFilter=v;render();})));
    const entries=state.alerts.filter(a=>state.alertFilter==='all'||state.alertFilter==='unread'&&!a.read||a.kind===state.alertFilter).slice(-70).reverse();
    if(!entries.length)parent.append(el('div','empty','暂无通知'));
    for(const item of entries){
      const row=el('div','alert-entry');
      row.append(add(el('div','row between'),el('span',item.read?'muted':'','● '+new Date(item.ts).toLocaleString()),
        item.read?el('span','muted','已读'):button('标记已读','readAlert',item.id)));
      row.append(el('div','',item.message));parent.append(row);
    }
    parent.append(el('div','hint','站内提醒仅存本机；桌面通知只含事件类别和数量，不包含好友昵称、消息正文或登录信息。'));
  };
  const renderStatistics=parent=>{
    parent.append(el('div','notice','此处统计的是本地脚本任务最终状态。CONFIRMED = 观察到新己方消息或人工确认，不能当作抖音续火成功率。旧版本只保留有限历史记录。'));
    parent.append(field('统计时段',selectWidget([['7','最近 7 天'],['30','最近 30 天']],String(state.statsDays),v=>{state.statsDays=Number(v);render();})));
    const {totals,series}=aggregateTasks(new Date(),state.statsDays);
    const blocks=el('div','stat-grid');
    for(const [key,title] of [['total','有记录任务'],['confirmed','确认发出'],['unknown','待核实'],['failed','发送前失败']]){
      const card=el('div','stat-card');card.append(el('b','',String(totals[key])),el('span','muted',title));blocks.append(card);
    }
    parent.append(blocks);
    parent.append(el('div','hint',`消息确认占有记录任务的 ${totals.total?Math.round(totals.confirmed/totals.total*100):0}%（不是火花续上率；未运行的任务未计入分母）。`));
    parent.append(sectionTitle('每日记录（仅供本地排查）'));
    for(const row of series){
      const wrap=el('div','stat-day');
      wrap.append(add(el('div','row between'),el('span','muted',row.day.slice(5)),el('span','',`${row.confirmed} 确认 · ${row.unknown} 未知 · ${row.failed} 失败`)));
      const bar=el('div','stat-track');
      for(const [key,cls] of [['confirmed','okbar'],['unknown','unknownbar'],['failed','failbar'],['other','otherbar']]){
        if(!row[key])continue;const seg=el('span',cls);seg.style.width=`${row[key]/Math.max(1,row.total)*100}%`;bar.append(seg);
      }
      wrap.append(bar);parent.append(wrap);
    }
    parent.append(add(el('div','tools'),button('导出匿名统计 JSON','exportStatistics'),button('查看运行日志','tab','logs')));
    parent.append(el('div','hint','匿名统计导出仅含日期与数量，不含昵称、会话 ID、原始日志、消息内容或 Cookie。'));
  };
  const renderBackup=parent=>{
    parent.append(el('div','notice','备份保留好友昵称、备注、消息模板和素材，属于私人信息，请妥善保管。不会备份 Cookie、回调令牌或浏览器 Profile。恢复后自动发送与提醒都关闭。'));
    const recent=Number(gmGet('lastBackupAt',0));
    parent.append(sectionTitle('本地数据概览'));
    parent.append(el('div','hint',`好友 ${state.contacts.size} · 已选 ${state.selected.size} · 素材 ${state.materials.length} · 策略 ${Object.keys(state.contactRules).length} · 本地任务 ${Object.keys(state.tasks).length} · 通知 ${state.alerts.length}`));
    parent.append(el('div','hint',`最近一次从当前设备导出备份：${recent?new Date(recent).toLocaleString():'无记录'}`));
    parent.append(add(el('div','tools'),button('下载设置与好友备份','exportConfig','', 'primary'),button('下载日志','exportLogs'),button('导入并预览备份','importBackupFile')));
    const chooser=el('input');chooser.type='file';chooser.accept='application/json,.json';chooser.id='spark-restore-chooser';chooser.style.display='none';
    chooser.addEventListener('change',()=>{void importConfig(chooser.files?.[0]).catch(e=>{
      state.pendingRestore=null;logCategory('error','ui','导入失败：'+e.message);window.alert('备份解析失败：'+e.message);render();
    });});parent.append(chooser);
    if(state.pendingRestore){
      const d=state.pendingRestore.draft;
      parent.append(sectionTitle('待恢复备份 · 只读预览'));
      parent.append(el('div','notice',`文件：${state.pendingRestore.name}
会话 ${d.contacts.length} · 勾选 ${d.selected.length} · 素材 ${d.materials.length} · 好友策略 ${Object.keys(d.contactRules).length}
注意：恢复会覆盖现有设置/好友/素材，但保留本机任务记录以防重复发送。所有导入会话需要重新核验身份。`));
      parent.append(add(el('div','tools'),button('确认恢复此备份','restoreBackup','', 'primary'),button('取消恢复','cancelRestore')));
    }else parent.append(el('div','hint','导入只做本地解析与预览，不会立刻覆盖现有数据。导入前建议先下载一份当前备份。'));
    parent.append(sectionTitle('数据安全说明'));
    parent.append(el('div','hint','恢复不会将历史任务状态清零，不会恢复自动发送开关、桌面通知开关或回调通道。其他账号的备份不应混用；会话需要重新进入聊天核对。'));
  };
  const renderHelp = parent=>{
    const topics=[
      ['⑩ V0.5 断火检查提醒','在提醒页设置每天的自定义检查时间。提醒仅表示未确认发送，不能读取抖音官方断火时刻。'],
      ['⑪ 数据统计和备份','统计只统计本地任务结果。备份先预览后恢复，导入后会停用自动发送并要求重新核验会话身份。'],
      ['① 安装与登录','安装 ScriptCat/Tampermonkey，导入本脚本，打开 https://www.douyin.com/chat 并手动扫码登录。'],
      ['② 选择好友','扫描会话，按头像/名称/类型核对；点击详情读取火花、重燃信息。无法确认的会话不进入自动发送。'],
      ['③ 生成文案','发送页编辑消息模板；支持 [昵称]、[天数]、[日期]、[API]、[TXTAPI]、[专属一言]。在文案页配置开关。'],
      ['④ 自动发送','在定时页选择固定或随机窗口，确保网页保持打开、可见、账号已登录。切勿用于大量未经同意的私信。'],
      ['⑤ 素材库','在素材页收藏文字/Emoji/原生表情准确名称。原生表情不能自动定时发送；素材库数据仅保存在本地。'],
      ['⑥ 个性化计划','在会话页点击「发送策略」或「计划」页，为每位好友设置素材池、轮换方式和每日发送时间。没有稳定 ID 的会话自动任务会跳过。'],
      ['⑦ 调度器回调','高级页启用本地回调、设置令牌；在配套工具 config.json 中使用相同端口/令牌/浏览器 Profile。'],
      ['⑧ 安全处理','消息发送结果未知时，不会自动重复发送。只在确认看到已发气泡后手动标记成功。不会获取/导出 Cookie。'],
      ['⑨ 兼容性','抖音网页 DOM 更新后，可能无法识别搜索框/重燃/编辑器。此时会拒绝发送并保留日志。']
    ];
    parent.append(el('div','notice','使用帮助（点击下面各项展开详细说明）'));
    for(const [title,body] of topics){const det=el('details','help-detail');det.append(el('summary','',title),el('div','hint',body));parent.append(det);}
    parent.append(add(el('div','tools'),button('打开项目仓库','openRepo'),button('恢复折叠按钮','toggle')));
  };
  const renderAll =()=>{
    if(!state.root)return;
    state.root.replaceChildren();
    const trigger=el('button','trigger');trigger.type='button';trigger.dataset.action='toggle';trigger.append(el('span','dot'),el('b','',state.isPaused?'⏸ 续火':'🔥 续火'),el('span','sub','0/0 已确认'));
    trigger.lastElementChild.id='spark-trigger-text';trigger.title='单击展开/折叠，按住拖动移动位置';
    state.root.append(trigger);
    if(!state.settings.collapsed){
      const panel=el('section','panel');panel.setAttribute('role','dialog');panel.setAttribute('aria-label','抖音火花助手 Full');
      const head=el('div','header');head.id='spark-drag-header';
      const title=el('div');title.append(el('div','head-title','🔥 抖音火花助手 Full'),el('div','sub',`v${VERSION} · ${BUILD_ID} · ${(state.isPaused?'已暂停':'本地运行')} · 支持拖动面板`));
      head.append(title,add(el('div','tools'),button(state.isPaused?'▶ 继续':'⏸ 暂停','pause'),button('收起','toggle')));panel.append(head);
      const summary=el('div','summary');for(const [key,label] of [['selected','已选择'],['confirmed','已确认'],['unknown','待核实']]){
        const metric=el('div','metric');const b=el('b','','0');b.dataset.metric=key;metric.append(b,el('span','',label));summary.append(metric);}
      panel.append(summary);
      const tabs=el('div','tabs');
      for(const [key,label] of [['contacts','会话'],['send','发送'],['materials','素材'],['plans','计划'],['time','定时'],['texts','文案'],['streaks','火花'],['logs','日志'],['health','诊断'],['alerts','提醒'],['stats','统计'],['backup','备份'],['advanced','高级'],['help','帮助']])tabs.append(button(label,'tab',key,`tab${state.tab===key?' active':''}`));
      panel.append(tabs);
      const body=el('div','content stack');
      if(state.tab==='contacts')renderContacts(body);
      else if(state.tab==='send')renderSendFull(body);
      else if(state.tab==='materials')renderLibrary(body);
      else if(state.tab==='plans')renderPlans(body);
      else if(state.tab==='time')renderTimeFull(body);
      else if(state.tab==='texts')renderTextFull(body);
      else if(state.tab==='streaks')renderStreakFull(body);
      else if(state.tab==='logs')renderLogsFull(body);
      else if(state.tab==='health')renderHealth(body);
      else if(state.tab==='alerts')renderAlerts(body);
      else if(state.tab==='stats')renderStatistics(body);
      else if(state.tab==='backup')renderBackup(body);
      else if(state.tab==='advanced')renderAdvanced(body);
      else renderHelp(body);
      panel.append(body);
      panel.append(add(el('div','footer'),el('span','','仅在 douyin.com/chat 生效'),el('span','',state.queueRunning?'任务执行中 · 请勿关闭页面':'非官方 · 数据本地保存')));
      state.root.append(panel);
    }
    applyPosition();refreshHeaderMetrics();
  };
  const updateCountdown=()=>{
    const target=state.root?.querySelector('#spark-next-countdown');if(!target)return;
    const now=Date.now(),today=choosePlan();
    const when=today.when>now?today.when:choosePlan(isoDay(dateShift(new Date(),1))).when;
    const seconds=Math.max(0,Math.floor((when-now)/1000));
    const h=String(Math.floor(seconds/3600)).padStart(2,'0'),m=String(Math.floor((seconds%3600)/60)).padStart(2,'0'),s=String(seconds%60).padStart(2,'0');
    target.textContent=`${h}:${m}:${s}`;
  };
  const applyPosition=()=>{
    const rawX=state.settings.positionX,rawY=state.settings.positionY;
    const x=rawX===null?18:safeCount(rawX,0,window.innerWidth-55,18);
    const y=rawY===null?20:safeCount(rawY,0,window.innerHeight-55,20);
    const trigger=state.root?.querySelector('.trigger');const panel=state.root?.querySelector('.panel');
    if(trigger){trigger.style.right=x+'px';trigger.style.bottom=y+'px';}
    if(panel){panel.style.right=x+'px';panel.style.bottom=(y+49)+'px';}
  };
  const setupDragging=()=>{
    const container=state.root;
    let origin=null,dragged=false;
    container.addEventListener('pointerdown',e=>{
      const draggable=e.target.closest?.('.trigger, #spark-drag-header');
      if(!draggable||e.target.closest('[data-action]') && !e.target.closest('.trigger'))return;
      origin={x:e.clientX,y:e.clientY,rx:state.settings.positionX??18,ry:state.settings.positionY??20};dragged=false;
    });
    window.addEventListener('pointermove',e=>{
      if(!origin)return;
      const dx=e.clientX-origin.x,dy=e.clientY-origin.y;if(Math.abs(dx)+Math.abs(dy)>6)dragged=true;
      if(!dragged)return;
      state.settings.positionX=Math.max(0,Math.min(window.innerWidth-65,origin.rx-dx));
      state.settings.positionY=Math.max(0,Math.min(window.innerHeight-70,origin.ry-dy));applyPosition();
    });
    window.addEventListener('pointerup',()=>{if(origin&&dragged)saveSettings();origin=null;});
    // 防止拖动悬浮球释放时误触发折叠
    container.addEventListener('click',e=>{if(dragged&&e.target.closest?.('.trigger')){e.stopImmediatePropagation();e.preventDefault();dragged=false;}},true);
    window.addEventListener('resize',applyPosition);
  };

  const render = renderAll;
  const handleAction = async (action,value) => {
    if(action==='toggle') {state.settings.collapsed=!state.settings.collapsed;saveSettings();render();return;}
    if(action==='tab'){state.tab=value;state.settings.activeTab=value;saveSettings();render();return;}
    if(action==='pause'){setPaused(!state.isPaused);return;}
    if(action==='editRule'){if(state.contacts.has(value)){state.editContactKey=value;state.tab='plans';state.settings.activeTab='plans';state.settings.collapsed=false;saveSettings();render();}return;}
    if(action==='resetRule'){if(window.confirm('将该好友恢复为全局发送策略？')){delete state.contactRules[value];saveRules();render();}return;}
    if(action==='previewRule'){
      const c=state.contacts.get(value);if(!c)return;
      const choice=resolveMaterial(c);
      const message=['DISABLED','INVALID','MANUAL_STICKER'].includes(choice.kind)?'该会话不可自动发送文字素材':
        await buildMessage(c,false,choice.kind==='INHERIT'?undefined:choice.text);
      const output=state.root?.querySelector('#spark-rule-preview');if(output)output.textContent=message;
      return;
    }
    if(action==='editMaterial'){
      const m=state.materials.find(x=>x.id===value);if(!m)return;
      state.materialEditId=m.id;state.materialDraft={title:m.title,kind:m.kind,content:m.content,tags:m.tags};render();return;
    }
    if(action==='resetMaterialDraft'){
      state.materialEditId='';state.materialDraft={title:'',kind:'TEXT',content:'',tags:''};render();return;
    }
    if(action==='saveMaterial'){
      try{upsertMaterial(state.materialDraft,state.materialEditId);state.materialEditId='';state.materialDraft={title:'',kind:'TEXT',content:'',tags:''};logCategory('success','ui','素材已保存');}
      catch(e){logCategory('warn','ui','素材无法保存：'+e.message);window.alert(e.message);}
      render();return;
    }
    if(action==='removeMaterial'){
      const m=state.materials.find(x=>x.id===value);
      if(m&&window.confirm(`删除素材「${m.title}」？关联好友的素材池会同步移除此条。`)){deleteMaterial(value);render();}
      return;
    }
    if(action==='useStickerMaterial'){
      const m=state.materials.find(x=>x.id===value);
      if(m?.kind==='STICKER'){
        state.settings.stickerName=m.content;state.tab='send';state.settings.activeTab='send';saveSettings();render();
        logCategory('info','ui','已填入原生表情名称；必须手动确认会话并试发');
      }return;
    }
    if(action==='selectFiltered'||action==='unselectFiltered'){for(const c of filteredContacts()){if(action==='selectFiltered')state.selected.add(c.key);else state.selected.delete(c.key);}saveSelected();render();return;}
    if(action==='inspectSelected'){await inspectAllSelected();return;}
    if(action==='preview'){await previewMessage();return;}
    if(action==='tick'){tick();render();return;}
    if(action==='refreshPlan'){gmSet('plan:'+isoDay(),null);choosePlan();render();return;}
    if(action==='resetVariants'){if(window.confirm('重置每日随机文案轮换记录？')){for(const w of WEEKDAYS)gmSet('variants:special:'+w,[]);gmSet('variants:txt',[]);render();}return;}
    if(action==='exportConfig'){exportConfig();return;}
    if(action==='exportLogs'){exportLogs();return;}
    if(action==='exportStatistics'){exportStatistics();return;}
    if(action==='refreshRisk'){checkRiskReminder();render();return;}
    if(action==='readAlert'){const item=state.alerts.find(a=>a.id===value);if(item){item.read=true;saveAlerts();render();}return;}
    if(action==='clearReadAlerts'){state.alerts=state.alerts.filter(a=>!a.read);saveAlerts();render();return;}
    if(action==='importBackupFile'){state.root.querySelector('#spark-restore-chooser')?.click();return;}
    if(action==='restoreBackup'){confirmRestore();return;}
    if(action==='cancelRestore'){state.pendingRestore=null;render();return;}
    if(action==='importConfig'){state.root.querySelector('#spark-import-file')?.click();return;}
    if(action==='openRepo'){window.open('https://github.com/dr-190/ScriptCat-Douyin-Fire-Helper','_blank','noopener');return;}
    if(action==='editDays'){const c=state.contacts.get(value);if(!c)return;const v=window.prompt(`手动修改「${c.name}」火花天数（不代表平台已重燃）：`,String(getFireDays(c)??''));if(v!==null&&/^\d{1,5}$/.test(v.trim())){setFireDays(value,Number(v));logCategory('info','ui',`手动更新「${c.name}」火花天数`);render();}return;}
    if(action==='clearStreaks'){if(window.confirm('确定清空火花天数本地缓存？')){gmSet('fireDaysByContact',{});render();}return;}
    if(action==='resetConfig'){if(window.confirm('恢复全部默认配置？自动发送将保持关闭。')){state.settings={...DEFAULTS,callbackToken:state.settings.callbackToken,autoEnabled:false};saveSettings();render();}return;}
    if(action==='clearEverything'){if(window.confirm('清除设置、好友、日志及发送记录？此操作无法撤销，确认后再点一次。')&&window.confirm('最终确认：确定清空全部本地数据？')){for(const k of ['settings','contacts','selected','tasks','logs','fireDaysByContact','isPaused','materials','contactRules','alerts'])gmSet(k,null);state.settings={...DEFAULTS};state.contacts=new Map();state.selected=new Set();state.tasks={};state.logs=[];state.materials=[];state.contactRules={};state.alerts=[];state.pendingRestore=null;state.isPaused=false;saveSettings();render();}return;}
    if(action==='scan'){await scanMore();return;}
    if(action==='inspect'){await inspectContact(value);return;}
    if(action==='inspectCurrent'){inspectCurrent();return;}
    if(action==='health'){getHealth();render();return;}
    if(action==='exportDiagnostic'){saveExport(`spark-diagnostic-${isoDay()}.json`,JSON.stringify(safeDiagnostics(),null,2));return;}
    if(action==='setTypePerson' || action==='setTypeGroup'){
      const contact=state.contacts.get(value);
      if(!contact || !contact.verifiedAt || !verifyOpenConversation(contact)){
        log('warn','请先打开并核对目标聊天详情，再手动确认身份');render();return;
      }
      const kind=action==='setTypePerson'?'PERSON':'GROUP';
      if(window.confirm(`你确认当前会话「${contact.name}」是${kindLabel(kind)}吗？此信息由你手动核实。`)){
        mergeContact({...contact,type:kind,typeSource:'manual',source:'详情',verifiedAt:Date.now()});
        persistContacts();render();
      }
      return;
    }
    if(action==='send'){await sendQueue('manual');return;}
    if(action==='stickers'){tryOpenNativeStickers();return;}
    if(action==='sendSticker'){await sendNamedSticker();return;}
    if(action==='confirmSent'){
      const contact=state.contacts.get(value);
      const task=taskFor(value);
      if(contact && task && ['UNKNOWN','SUBMITTED'].includes(task.status) && window.confirm(`你是否已在抖音聊天记录中亲眼看到发给「${contact.name}」的消息？\n只有确认看到后才能标记成功。`)) {
        recordTask(value,'CONFIRMED','用户人工核实聊天记录');
        if(task.materialChoice){commitMaterialRotation(contact,task.materialChoice);commitLegacyVariants(task.materialChoice);}
        log('success', `「${contact.name}」由用户人工核实成功`);render();
      }
      return;
    }
    if(action==='emoji'){
      const area=state.root.querySelector('textarea');
      if(area){const start=area.selectionStart,end=area.selectionEnd;const old=area.value;
        const next=old.slice(0,start)+value+old.slice(end);area.value=next;
        area.focus();area.selectionStart=area.selectionEnd=start+value.length;
        state.settings.message=next;saveSettings();}
      return;
    }
    if(action==='clearLogs'){if(window.confirm('清空本地运行日志？')){state.logs=[];gmSet('logs',[]);render();}return;}
    if(action==='clearTasks'){
      if(window.confirm('清除今日发送状态会增加重复发送风险。确定清除？')){
        for(const key of Object.keys(state.tasks))if(key.startsWith(`${isoDay()}|`))delete state.tasks[key];
        saveTasks();render();
      }
    }
  };
  const mount = () => {
    if(document.getElementById(UI_ID))return;
    const host=el('div');host.id=UI_ID;host.style.cssText='all:initial;position:static;z-index:2147483647';
    document.body.append(host);state.host=host;
    const root=host.attachShadow({mode:'open'});state.root=root;
    const style=el('style');style.textContent=css;root.append(style);
    // CSS 必须保留在 shadow root 内。render 只重绘容器内容，不删除样式。
    const content=el('div');root.append(content);
    state.root=content;
    content.addEventListener('click',event=>{
      const actionNode=event.target.closest?.('[data-action]');
      if(!actionNode)return;
      event.preventDefault();
      void handleAction(actionNode.dataset.action,actionNode.dataset.value || '');
    });
    render();
    scanOnce();render();
    window.setInterval(()=>{ if(!state.running&&!state.scanning)scanOnce(); tick(); },30000);
    window.setInterval(updateCountdown,1000);
    setupDragging();
    if(state.settings.initialDelay>0)window.setTimeout(tick,safeCount(state.settings.initialDelay,0,180,15)*1000);else tick();
    window.addEventListener('focus',tick);
    document.addEventListener('visibilitychange',tick);
    log('info','ScriptCat 火花助手 Full 已启动');
    if(typeof GM_registerMenuCommand==='function'){
      for(const [label,action,value] of [['打开/折叠火花助手','toggle',''],['立即发送','send',''],['选择好友','tab','contacts'],['偏好/高级设置','tab','advanced'],['历史日志','tab','logs'],['健康诊断','tab','health'],['提醒中心','tab','alerts'],['统计记录','tab','stats'],['备份恢复','tab','backup'],['暂停/恢复','pause',''],['预览文案','tab','send'],['火花天数管理','tab','streaks'],['使用帮助','tab','help'],['重置今日记录','clearTasks','']])
        GM_registerMenuCommand(label,()=>{if(action==='tab'){state.settings.collapsed=false;state.tab=value;saveSettings();render();}else void handleAction(action,value);});
    }
  };

  if (typeof window !== 'undefined' && (window.__SPARK_FULL_TEST_MODE__ || window.__SPARK_LITE_TEST_MODE__)) {
    window.__SPARK_FULL_TEST_HOOKS__ = { version:VERSION,buildId:BUILD_ID,classify,conversationTypeFromRow,classifySpark, parseClock, shouldRunAt, textForSend, isoDay, sparkLabel, state, taskId, gmGet, gmSet, choosePlan, isDueNow, pickVariant, buildMessage, getFireDays, setFireDays, todayOutcome, mayRetry, markPreSendFailure, extractId, contactFromRow, collect, scanOnce, verifyOpenConversation, activeRowIdentity, visibleConversationEvidence,manualTargetEvidence,applyDetail, inspectCurrent, identityReadyForSend,sendToContact,sendQueue,sendNamedSticker,tryOpenNativeStickers,isOutgoing, snapshotMessages, confirmedOutgoing,exactOutgoingPresent, getHealth, safeDiagnostics, trustedForSchedule, commitLegacyVariants, upsertMaterial, deleteMaterial, resolveMaterial, commitMaterialRotation, scheduleForContact, scheduledContacts, normalizeRule, ruleFor, materialChoices, saveRules, saveMaterials, recordTask,
      riskAssessment, aggregateTasks, checkRiskReminder, pushAlert, emitTaskAlert, unreadAlerts,
      parseBackup, confirmRestore, importConfig, exportStatistics };
    window.__SPARK_LITE_TEST_HOOKS__=window.__SPARK_FULL_TEST_HOOKS__;
    return;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
  else mount();
})();
