/* =========================================================
 * Spark V0.9.2 UI adapter. The reference execution engine stays in place.
 * This layer calls its existing scan/send/schedule/settings entry points.
 * ========================================================= */
const SPARK_UI_BUILD = 'ref-engine-ui-dialog-theme-20261009-r3';
const SPARK_UI_KEY = 'spark:reference-ui:v1';
const sparkUiRead = () => {
    const raw = GM_getValue(SPARK_UI_KEY, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
};
let sparkUi = sparkUiRead();
if (!Array.isArray(sparkUi.materials)) sparkUi.materials = [];
if (typeof sparkUi.quickEmoji !== 'boolean') sparkUi.quickEmoji = true;
// Visual-only palette preferences; kept separately from the reference sender config.
const SPARK_THEME_PRESETS = Object.freeze({
    daylight: {name:'日光', mode:'light', icon:'☀️', bg:'#ffffff', surface:'#f6f8fc', nav:'#f0f3f8', active:'#e7efff', text:'#182538', sub:'#63758d', muted:'#8190a1', line:'#e0e6ef', softLine:'#edf0f4', control:'#ffffff', buttonText:'#35577d', accent:'#2563eb', accentText:'#1b55bb', onAccent:'#ffffff', noteBg:'#f3f6fc', float:'#182f4f', shadow:'rgba(16,43,68,.20)'},
    midnight: {name:'曜夜', mode:'dark', icon:'🌙', bg:'#151b27', surface:'#212b3d', nav:'#263449', active:'#30466a', text:'#f0f4fa', sub:'#b8c4d5', muted:'#95a6be', line:'#39475a', softLine:'#303d50', control:'#202c3d', buttonText:'#d8e8fc', accent:'#6b9eff', accentText:'#b9d1ff', onAccent:'#0a1a31', noteBg:'#26344a', float:'#466da9', shadow:'rgba(0,0,0,.48)'},
    ocean: {name:'深海', mode:'dark', icon:'🌊', bg:'#0c2330', surface:'#143344', nav:'#174052', active:'#1a5264', text:'#e8f7fb', sub:'#adcad5', muted:'#8eb7c7', line:'#2b5767', softLine:'#234b5b', control:'#143645', buttonText:'#cef3fa', accent:'#47d3d0', accentText:'#6ee5de', onAccent:'#08292f', noteBg:'#164052', float:'#146e78', shadow:'rgba(0,18,29,.50)'},
    forest: {name:'森林', mode:'light', icon:'🌿', bg:'#f8fcf7', surface:'#eff5ed', nav:'#edf4eb', active:'#dff1e0', text:'#1c382a', sub:'#537361', muted:'#6c8b78', line:'#d1e1d1', softLine:'#dceadd', control:'#ffffff', buttonText:'#315d3a', accent:'#23834b', accentText:'#176b39', onAccent:'#ffffff', noteBg:'#e9f4e8', float:'#215c3d', shadow:'rgba(24,70,42,.20)'},
    sakura: {name:'樱粉', mode:'light', icon:'🌸', bg:'#fffafc', surface:'#fff0f5', nav:'#fbeaf0', active:'#ffe0eb', text:'#503344', sub:'#8b6377', muted:'#a27f91', line:'#efd5e1', softLine:'#f5e0e9', control:'#ffffff', buttonText:'#924c71', accent:'#d94b87', accentText:'#ad3769', onAccent:'#ffffff', noteBg:'#fff0f6', float:'#a93f73', shadow:'rgba(105,38,73,.18)'},
    amber: {name:'暖沙', mode:'light', icon:'🍂', bg:'#fffcf5', surface:'#faf1e4', nav:'#f5ead6', active:'#f9e4b8', text:'#483727', sub:'#816b4f', muted:'#a18a6c', line:'#e9d9c1', softLine:'#f0e5d5', control:'#fffdf9', buttonText:'#775126', accent:'#b77926', accentText:'#89540f', onAccent:'#ffffff', noteBg:'#f9efdf', float:'#7a552d', shadow:'rgba(85,56,25,.21)'}
});
const SPARK_THEME_TOKEN_NAMES = Object.freeze({
    bg:'bg', surface:'surface', nav:'nav', active:'active', text:'text', sub:'sub', muted:'muted',
    line:'line', softLine:'soft-line', control:'control', buttonText:'btn-text',
    accent:'accent', accentText:'accent-text', onAccent:'on-accent', noteBg:'note-bg',
    float:'floating', shadow:'shadow'
});
if (!Object.prototype.hasOwnProperty.call(SPARK_THEME_PRESETS, sparkUi.theme)) sparkUi.theme = 'daylight';
if (!Object.prototype.hasOwnProperty.call(SPARK_THEME_PRESETS, sparkUi.lastLightTheme) || SPARK_THEME_PRESETS[sparkUi.lastLightTheme].mode !== 'light') sparkUi.lastLightTheme='daylight';
if (!Object.prototype.hasOwnProperty.call(SPARK_THEME_PRESETS, sparkUi.lastDarkTheme) || SPARK_THEME_PRESETS[sparkUi.lastDarkTheme].mode !== 'dark') sparkUi.lastDarkTheme='midnight';
function sparkApplyTheme(name, persist=false) {
    const selected=Object.prototype.hasOwnProperty.call(SPARK_THEME_PRESETS,name) ? name : 'daylight';
    const p=SPARK_THEME_PRESETS[selected];
    sparkUi.theme=selected;
    if (p.mode==='dark') sparkUi.lastDarkTheme=selected;
    else sparkUi.lastLightTheme=selected;
    // Only name-spaced variables, and selectors under our own panel/dialog elements.
    const root=document.documentElement;
    root.setAttribute('data-spark-ui-theme',selected);
    root.style.setProperty('--sp-scheme',p.mode);
    for (const [key,token] of Object.entries(SPARK_THEME_TOKEN_NAMES)) root.style.setProperty('--sp-'+token,p[key]);
    const toggle=document.getElementById('spark-theme-quick');
    if (toggle) {
        toggle.textContent=p.mode==='dark'?'☀️ 白天':'🌙 夜间';
        toggle.title=p.mode==='dark'?'切换到白天主题':'切换到夜间主题';
        toggle.setAttribute('aria-label',toggle.title);
    }
    const current=document.getElementById('spark-theme-current');
    if(current) current.textContent=p.icon+' '+p.name;
    document.querySelectorAll('#spark-theme-choices [data-spark-theme-choice]').forEach(button=>{
        const chosen=button.dataset.sparkThemeChoice===selected;
        button.setAttribute('aria-pressed',String(chosen));
        button.setAttribute('aria-checked',String(chosen));
    });
    if(persist) sparkWriteUi();
}
function sparkToggleDayNight() {
    const active=SPARK_THEME_PRESETS[sparkUi.theme] || SPARK_THEME_PRESETS.daylight;
    sparkApplyTheme(active.mode==='dark'?sparkUi.lastLightTheme:sparkUi.lastDarkTheme,true);
}
function sparkThemeOptionsHtml() {
    return Object.entries(SPARK_THEME_PRESETS).map(([key,p])=>
        `<button type="button" class="spark-theme-option" data-spark-theme-choice="${key}" role="radio" aria-checked="${key===sparkUi.theme}" aria-pressed="${key===sparkUi.theme}" style="--sp-preview-bg:${p.bg};--sp-preview-accent:${p.accent};--sp-preview-text:${p.text}"><span class="spark-theme-preview" aria-hidden="true"><i></i><em></em></span><span>${p.icon} ${p.name}</span></button>`
    ).join('');
}

let sparkCandidates = new Map();
let sparkScanning = false;
let sparkTab = 'today';
const sparkSelected = () => (userConfig.targetUsernames || '').split('\n').map(x=>x.trim()).filter(Boolean);
const sparkEsc = escapeHtml;
const sparkWriteUi = () => GM_setValue(SPARK_UI_KEY, sparkUi);
function sparkImportOldUiOnce() {
    if (GM_getValue('spark:reference-ui:migrated-v082', false)) return;
    // Keep the old version's data unchanged; do not import its send ledger or auto schedules.
    const old = GM_getValue('spark-full:v2:simple:v1:state', null);
    const priorReference = GM_getValue('userConfig', null);
    if (old && typeof old === 'object' && (!priorReference || priorReference.customMessage === DEFAULT_CONFIG.customMessage)) {
        if (Array.isArray(old.materials) && !sparkUi.materials.length) {
            sparkUi.materials = old.materials.filter(m=>m&&typeof m.content==='string'&&m.content.length<=900).slice(0,100).map(m=>({title:String(m.title||'常用内容').slice(0,50),content:m.content}));
            sparkWriteUi();
        }
        if (typeof old.draft === 'string' && old.draft.trim() && old.draft.length <= 900) {
            userConfig.customMessage = old.draft;
            userConfig.baseMessage = old.draft;
            userConfig.useHitokoto = false;
            userConfig.useTxtApi = false;
            userConfig.useSpecialHitokoto = false;
            saveConfig();
        }
        if (old.fireRecords && typeof old.fireRecords === 'object' && !GM_getValue('userFireDays', null)) {
            const fire = {};
            for (const [name, rec] of Object.entries(old.fireRecords)) {
                if (name && rec && Number.isInteger(rec.days) && rec.days >= 0 && rec.days <= 99999) {
                    fire[name] = { days: rec.days, lastDate: '' };
                }
            }
            if (Object.keys(fire).length) GM_setValue('userFireDays', fire);
        }
    }
    GM_setValue('spark:reference-ui:migrated-v082', true);
}
const sparkHide = element => { if (element) element.hidden = true; };
function sparkToast(message) {
    const el = document.getElementById('spark-toast');
    if (!el) return;
    el.textContent = message;
    el.hidden = false;
}
function sparkRefreshCounts() {
    const targets = sparkSelected();
    const vals = { 'spark-scan-count': sparkCandidates.size,
        'spark-selected-count': targets.length,
        'spark-done-count': targets.filter(n=>sentUsersToday.includes(n)).length,
        'spark-pending-count': targets.filter(n=>!sentUsersToday.includes(n)&&!failedUsersToday.includes(n)).length };
    for (const [id,val] of Object.entries(vals)) {
        const el = document.getElementById(id);
        if (el) el.textContent = String(val);
    }
    const btn = document.getElementById('dy-fire-send');
    if (btn) {
        btn.disabled = isProcessing || isPaused || !targets.length || sparkScanning;
        btn.textContent = isProcessing ? '正在自动发送…' : `一键自动发送（${vals['spark-pending-count']} 待处理）`;
    }
    const pause = document.getElementById('dy-fire-pause');
    if (pause) pause.textContent = isPaused ? '▶ 恢复' : '⏸ 暂停';
    const schedule = document.getElementById('spark-auto-on');
    if (schedule) schedule.checked = !!userConfig.automationEnabled;
    const retry = document.getElementById('spark-retry-on');
    if (retry) retry.checked = !!userConfig.retryAfterMaxReached;
    const fire = document.getElementById('spark-fire-on');
    if (fire) fire.checked = !!userConfig.autoFetchFireDays;
    const dynamic = document.getElementById('spark-dynamic-on');
    if (dynamic) dynamic.checked = !!sparkUi.dynamic;
    const quick = document.getElementById('spark-quick-emoji-on');
    if (quick) quick.checked = !!sparkUi.quickEmoji;
    const emojis = document.getElementById('spark-emoji-row');
    if (emojis) emojis.hidden = !sparkUi.quickEmoji;
    const rotate = document.getElementById('spark-rotate-on');
    if (rotate) rotate.checked = !!sparkUi.rotate;
    const cb = document.getElementById('spark-callback-on');
    if (cb) cb.checked = !!userConfig.enableScriptBCallback;
}
function sparkRenderContacts() {
    const input = document.getElementById('spark-filter');
    const root = document.getElementById('spark-contacts');
    if (!root) return;
    const q = (input?.value || '').trim().toLowerCase();
    const selected = new Set(sparkSelected());
    const candidates = [...sparkCandidates.values()].filter(it => !q || it.nickname.toLowerCase().includes(q));
    root.innerHTML = candidates.length ? candidates.map(it => `
        <label class="spark-contact"><input type="checkbox" data-spark-name="${sparkEsc(it.nickname)}" ${selected.has(it.nickname)?'checked':''}>
          <span class="spark-contact-text"><b>${sparkEsc(it.nickname)}</b><small>${it.days>0?'🔥 '+it.days+' 天':'聊天联系人'}${sentUsersToday.includes(it.nickname)?' · 今天已处理':''}</small></span>
        </label>`).join('') : '<div class="spark-empty">暂无会话。请进入抖音聊天页后点击「扫描全部」。</div>';
    sparkRefreshCounts();
}
function sparkSaveTargets(names) {
    // The original engine accepts an exact nickname list, not a JS-only virtual selection.
    userConfig.targetUsernames = [...new Set(names.map(n=>n.trim()).filter(Boolean))].join('\n');
    userConfig.enableTargetUser = !!userConfig.targetUsernames;
    saveConfig();
    parseTargetUsers();
    updateUserStatusDisplay();
    sparkRenderContacts();
}
function sparkScanAll() {
    if (sparkScanning || isProcessing) return;
    const panel = document.getElementById('dy-fire-helper');
    if (!panel) return;
    sparkScanning = true;
    sparkCandidates = new Map();
    const scan = document.getElementById('spark-scan-btn');
    if (scan) { scan.disabled = true; scan.textContent = '正在扫描…'; }
    sparkToast('正在读取页面上的聊天列表…');
    try {
        autoScrollChatListAndCollect(panel, items => {
            for (const item of items) {
                if (!item.nickname || /(?:^|\s)(?:周[一二三四五六日]|昨天|今天)\s*$/.test(item.nickname)) continue;
                sparkCandidates.set(item.nickname, item);
            }
            sparkRenderContacts();
        }, () => {
            sparkScanning = false;
            if (scan) { scan.disabled = false; scan.textContent = '↻ 扫描全部'; }
            sparkRenderContacts();
            sparkToast(`扫描结束：读取 ${sparkCandidates.size} 个会话，已勾选 ${sparkSelected().length} 位`);
        });
    } catch (err) {
        sparkScanning = false;
        if (scan) { scan.disabled = false; scan.textContent = '↻ 扫描全部'; }
        sparkToast('扫描错误：' + String(err.message).slice(0, 100));
    }
}
function sparkSaveMessage() {
    const area = document.getElementById('spark-message');
    if (!area) return true;
    const msg = area.value;
    if (!msg.trim() || msg.length > 900) { sparkToast('请填写 1–900 字的正文'); return false; }
    userConfig.customMessage = msg;
    userConfig.baseMessage = msg;
    // Sending selected text is the default. Dynamic API enrichment requires explicit opt-in.
    if (!sparkUi.dynamic) {
        userConfig.useHitokoto = false;
        userConfig.useTxtApi = false;
        userConfig.useSpecialHitokoto = false;
    }
    saveConfig();
    return true;
}
function sparkSendDirect() {
    if (!sparkSaveMessage()) return;
    if (sparkUi.rotate && !sparkUi.materials.length) {sparkToast('请先在高级功能中添加轮换素材');return;}
    const names = sparkSelected();
    if (!names.length) { sparkToast('先勾选要发送的好友'); return; }
    if (isPaused) { sparkToast('目前已暂停，请先点击恢复'); return; }
    if (isProcessing) { sparkToast('任务正在运行'); return; }
    // No extra per-user confirmation and no replacement executor.
    sparkToast(`正在交给原版执行引擎：${names.length} 位联系人`);
    sendMessage();
    sparkRefreshCounts();
}
function sparkSwitchTab(tab) {
    sparkTab = tab === 'advanced' ? 'advanced' : 'today';
    const today = document.getElementById('spark-today');
    const advanced = document.getElementById('spark-advanced');
    if (today) today.hidden = sparkTab !== 'today';
    if (advanced) advanced.hidden = sparkTab !== 'advanced';
    for (const btn of document.querySelectorAll('[data-spark-tab]')) {
        btn.setAttribute('aria-selected', String(btn.dataset.sparkTab===sparkTab));
    }
    sparkRefreshCounts();
}
function sparkRenderMaterials() {
    const el=document.getElementById('spark-material-list');if(!el)return;
    el.innerHTML = sparkUi.materials.map((m,i)=>`<div class="spark-row"><span class="spark-pill" style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${sparkEsc(m.title||m.content)}</span><span><button class="spark-secondary" data-spark-use="${i}">使用</button> <button class="spark-secondary" data-spark-delete="${i}">删除</button></span></div>`).join('') || '<p class="spark-note">暂无保存的素材</p>';
}
function sparkImportConfigFile(file) {
    if(!file) return;
    if(file.size>2_000_000){sparkToast('配置文件超过 2 MB');return;}
    file.text().then(text=>{
        const json=JSON.parse(text);
        if(json.format!=='spark-ref-config'||!json.config||typeof json.config!=='object'||Array.isArray(json.config)) throw Error('配置文件格式不正确');
        const incoming = {...json.config};
        // Import is never authority to arm unattended sends or bypass already-sent records.
        userConfig={...DEFAULT_CONFIG,...userConfig,...incoming,automationEnabled:false,enableScriptBCallback:false};
        delete userConfig.scriptBCallbackToken;
        parseTargetUsers();saveConfig();
        if (Array.isArray(json.materials)) sparkUi.materials=json.materials.filter(m=>m&&typeof m.content==='string'&&m.content.length<=900).slice(0,100);
        sparkUi.rotate=false;sparkWriteUi();
        const editor=document.getElementById('spark-message');if(editor)editor.value=userConfig.customMessage||'';
        const time=document.getElementById('spark-send-time');if(time)time.value=(userConfig.sendTime||'20:30:00').slice(0,5);
        sparkRenderMaterials();sparkRenderContacts();sparkRefreshCounts();
        sparkToast('配置已导入；自动定时和回调保持关闭，旧发送记录未覆盖');
    }).catch(err=>sparkToast('导入失败：'+String(err.message).slice(0,80)));
}
function sparkExportDiagnostic() {
    const diag={version:'0.9.2',build:SPARK_UI_BUILD,at:new Date().toISOString(),scanCount:sparkCandidates.size,selectedCount:sparkSelected().length,
       searchInputPresent:!!queryFirst(SELECTORS.searchInput).el,
       editorPresent:!!queryFirst(SELECTORS.chatInput).el,
       messageListPresent:!!queryFirst(SELECTORS.conversationList).el,
       processing:!!isProcessing,paused:!!isPaused};
    const blob=new Blob([JSON.stringify(diag,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='spark-reference-diagnostic.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function sparkExportConfig() {
    const config = {...userConfig};
    delete config.scriptBCallbackToken;
    delete config.scriptBAccountId;
    const blob = new Blob([JSON.stringify({version:'0.9.2',format:'spark-ref-config',config,targets:sparkSelected(),materials:sparkUi.materials,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');a.href=url;a.download='spark-reference-config.json';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function sparkInitStyle() {
    if (document.getElementById('spark-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'spark-ui-style';
    style.textContent = `
      #dy-fire-helper.spark-shell{position:fixed!important;top:auto!important;right:20px!important;bottom:76px!important;width:370px!important;max-width:calc(100vw - 16px)!important;height:min(660px,calc(100vh - 90px))!important;overflow:hidden!important;display:flex;flex-direction:column;background:var(--sp-bg)!important;color:var(--sp-text)!important;color-scheme:var(--sp-scheme)!important;border:1px solid var(--sp-line)!important;border-radius:16px!important;font:13px/1.45 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif!important;box-shadow:0 22px 70px var(--sp-shadow)!important;z-index:2147483646!important;backdrop-filter:none!important}
      #dy-fire-helper.spark-shell *{box-sizing:border-box}
      #dy-fire-helper.spark-shell button,#dy-fire-helper.spark-shell input,#dy-fire-helper.spark-shell textarea{font:inherit}
      #dy-fire-helper.spark-shell button{cursor:pointer}
      #dy-fire-helper.spark-shell button:disabled{opacity:.5;cursor:not-allowed}
      #dy-fire-helper.spark-shell .spark-top{padding:15px 16px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid var(--sp-soft-line)}
      #dy-fire-helper.spark-shell .spark-top b{font-size:16px;color:var(--sp-text)}
      #dy-fire-helper.spark-shell .spark-nav{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid var(--sp-soft-line)}
      #dy-fire-helper.spark-shell .spark-nav button{flex:1;background:var(--sp-nav);border:0;border-radius:8px;padding:8px;color:var(--sp-sub)}
      #dy-fire-helper.spark-shell .spark-nav button[aria-selected=true]{background:var(--sp-active);color:var(--sp-accent-text);font-weight:700}
      #dy-fire-helper.spark-shell .spark-content{padding:14px;overflow-y:auto;flex:1;min-height:0;overscroll-behavior:contain}
      #dy-fire-helper.spark-shell .spark-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px}
      #dy-fire-helper.spark-shell .spark-stat{padding:11px 6px;text-align:center;background:var(--sp-surface);border-radius:10px}
      #dy-fire-helper.spark-shell .spark-stat strong{font-size:20px;display:block;color:var(--sp-text)}
      #dy-fire-helper.spark-shell .spark-stat small{font-size:11px;color:var(--sp-sub)}
      #dy-fire-helper.spark-shell .spark-row{display:flex;justify-content:space-between;align-items:center;gap:7px;margin:9px 0}
      #dy-fire-helper.spark-shell .spark-secondary{border:1px solid var(--sp-line);background:var(--sp-control);color:var(--sp-btn-text);border-radius:9px;padding:7px 10px}
      #dy-fire-helper.spark-shell .spark-primary{display:block;width:100%;border:0;background:var(--sp-accent);color:var(--sp-on-accent);border-radius:9px;padding:11px 14px;font-weight:700;margin-top:12px}
      #dy-fire-helper.spark-shell .spark-contacts{max-height:230px;overflow-y:auto;border:1px solid var(--sp-line);border-radius:10px;padding:4px;margin:8px 0;overscroll-behavior:contain}
      #dy-fire-helper.spark-shell .spark-contact{display:flex;gap:9px;align-items:center;padding:8px;border-bottom:1px solid var(--sp-soft-line);cursor:pointer}
      #dy-fire-helper.spark-shell .spark-contact:last-child{border:0}
      #dy-fire-helper.spark-shell .spark-contact input{width:17px;height:17px;accent-color:var(--sp-accent);flex:0 0 auto}
      #dy-fire-helper.spark-shell .spark-contact-text{flex:1;min-width:0}
      #dy-fire-helper.spark-shell .spark-contact b{display:block;color:var(--sp-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
      #dy-fire-helper.spark-shell .spark-contact small{display:block;color:var(--sp-muted);font-size:11px}
      #dy-fire-helper.spark-shell .spark-empty{padding:18px 9px;text-align:center;color:var(--sp-muted)}
      #dy-fire-helper.spark-shell .spark-input{display:block;width:100%;padding:9px;border:1px solid var(--sp-line);border-radius:9px;background:var(--sp-control);color:var(--sp-text);margin:7px 0}
      #dy-fire-helper.spark-shell textarea.spark-input{min-height:80px;resize:vertical;line-height:1.6}
      #dy-fire-helper.spark-shell .spark-note{color:var(--sp-sub);font-size:11px;line-height:1.5;margin-top:7px}
      #dy-fire-helper.spark-shell .spark-pill{font-size:11px;color:var(--sp-sub)}
      #dy-fire-helper.spark-shell .spark-switch{display:flex;gap:9px;align-items:center;justify-content:space-between;border-bottom:1px solid var(--sp-soft-line);padding:10px 0;cursor:pointer;color:var(--sp-text)}
      #dy-fire-helper.spark-shell .spark-switch input{width:16px;height:16px;accent-color:var(--sp-accent)}
      #dy-fire-helper.spark-shell .spark-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
      #dy-fire-helper.spark-shell .spark-buttons button{border:1px solid var(--sp-line);border-radius:8px;background:var(--sp-control);color:var(--sp-btn-text);padding:8px}
      #dy-fire-helper.spark-shell .spark-subhead{font-size:13px;color:var(--sp-text);font-weight:700;margin:12px 0 7px}
      #dy-fire-helper.spark-shell .spark-status{font-size:11px;color:var(--sp-sub);background:var(--sp-note-bg);border-radius:8px;padding:8px;margin-top:9px}
      #dy-fire-helper.spark-shell #spark-toast{color:var(--sp-sub);font-size:12px;padding:7px 14px;border-top:1px solid var(--sp-soft-line);background:var(--sp-bg);max-height:66px;overflow-y:auto}
      #dy-fire-helper.spark-shell .spark-actions{display:flex;gap:8px;margin-top:10px}
      #dy-fire-helper.spark-shell .spark-actions button{flex:1}
      #dy-fire-helper.spark-shell .spark-top-actions{display:flex;align-items:center;gap:6px}
      #dy-fire-helper.spark-shell .spark-theme-quick{white-space:nowrap;font-size:12px;padding:7px 9px}
      #dy-fire-helper.spark-shell .spark-theme-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:10px 0 6px}
      #dy-fire-helper.spark-shell .spark-theme-option{min-width:0;background:var(--sp-control);color:var(--sp-text);border:1px solid var(--sp-line);border-radius:10px;padding:8px 5px;display:flex;flex-direction:column;align-items:center;gap:7px;font-size:11px;line-height:1.2}
      #dy-fire-helper.spark-shell .spark-theme-option[aria-pressed=true]{border-color:var(--sp-accent);box-shadow:0 0 0 1px var(--sp-accent) inset;background:var(--sp-active);font-weight:700}
      #dy-fire-helper.spark-shell .spark-theme-preview{display:block;width:100%;height:32px;border-radius:7px;background:var(--sp-preview-bg);border:1px solid var(--sp-line);position:relative;overflow:hidden}
      #dy-fire-helper.spark-shell .spark-theme-preview i{display:block;background:var(--sp-preview-accent);position:absolute;left:9px;top:9px;width:38%;height:6px;border-radius:4px}
      #dy-fire-helper.spark-shell .spark-theme-preview em{display:block;background:var(--sp-preview-text);opacity:.25;position:absolute;left:9px;top:20px;width:60%;height:3px;border-radius:3px}
      #dy-fire-helper.spark-shell .spark-input::placeholder{color:var(--sp-muted);opacity:1}
      #dy-fire-helper.spark-shell .spark-input:focus-visible,#dy-fire-helper.spark-shell button:focus-visible{outline:2px solid var(--sp-accent);outline-offset:2px}
      #dy-fire-helper.spark-shell .spark-contact:hover{background:var(--sp-surface)}
      #dy-fire-helper.spark-shell .spark-content{scrollbar-color:var(--sp-line) transparent}
      #dy-fire-helper.spark-shell #dy-fire-status{color:var(--sp-accent-text)!important}
      #dy-fire-helper.spark-shell .spark-switch,#dy-fire-helper.spark-shell .spark-input{color-scheme:var(--sp-scheme)}
      #dy-fire-helper.spark-shell [hidden]{display:none!important}
      #dy-fire-helper.spark-shell #dy-fire-log{max-height:90px;overflow:auto;background:var(--sp-surface);color:var(--sp-sub);font-size:11px;border-radius:8px}
      #dy-fire-helper.spark-shell #dy-fire-log .dyfire-log-line{border-bottom:1px solid var(--sp-soft-line);padding:5px}

      /* Only the two requested original dialogs use the six Spark palettes. */
      #dy-fire-user-select-panel.spark-themed-dialog,
      #dy-fire-help-panel.spark-themed-dialog {
        position:fixed!important;top:50%!important;left:50%!important;
        transform:translate(-50%,-50%)!important;
        background:var(--sp-bg)!important;color:var(--sp-text)!important;
        color-scheme:var(--sp-scheme)!important;
        border:1px solid var(--sp-line)!important;border-radius:17px!important;
        box-shadow:0 22px 70px var(--sp-shadow)!important;
        backdrop-filter:none!important;
        font:13px/1.5 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif!important;
        overflow:hidden!important;display:flex!important;flex-direction:column!important;
        z-index:2147483647!important;box-sizing:border-box!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog{width:min(540px,calc(100vw - 26px))!important;max-height:min(710px,calc(100vh - 32px))!important;min-height:310px}
      #dy-fire-help-panel.spark-themed-dialog{width:min(990px,calc(100vw - 26px))!important;max-height:min(800px,calc(100vh - 32px))!important}
      #dy-fire-user-select-panel.spark-themed-dialog *,#dy-fire-help-panel.spark-themed-dialog *{box-sizing:border-box;color-scheme:var(--sp-scheme)}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-modal-header,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-modal-header{
        padding:15px 17px!important;background:var(--sp-bg)!important;
        border-bottom:1px solid var(--sp-soft-line)!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog h3,
      #dy-fire-help-panel.spark-themed-dialog h3{color:var(--sp-text)!important;font-size:16px!important;font-weight:700!important;line-height:1.45!important}
      #dy-fire-user-select-panel.spark-themed-dialog #dy-fire-user-select-count{color:var(--sp-accent-text)!important;font-size:12px!important;font-weight:600}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-close-btn,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-close-btn{
        color:var(--sp-sub)!important;background:var(--sp-nav)!important;
        width:31px;height:31px;border-radius:9px;border:1px solid var(--sp-line)!important;
        font-size:19px!important;line-height:1!important;box-shadow:none!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-close-btn:hover,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-close-btn:hover{background:var(--sp-active)!important;color:var(--sp-text)!important;transform:none!important}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-toolbar,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-filter-bar{
        background:var(--sp-bg)!important;border-bottom:1px solid var(--sp-soft-line)!important;
        padding:12px 17px!important;gap:10px!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-toolbar{align-items:center;flex-wrap:wrap;justify-content:flex-start}
      #dy-fire-user-select-panel.spark-themed-dialog #dy-fire-user-select-loading-badge{font-size:12px!important;color:var(--sp-sub)!important;order:3;width:100%}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-btn,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-btn{
        border-radius:9px!important;font-family:inherit!important;font-size:12px!important;font-weight:600!important;line-height:1.5!important;
        background:var(--sp-control)!important;color:var(--sp-btn-text)!important;
        border:1px solid var(--sp-line)!important;box-shadow:none!important;
        padding:9px 12px!important;transform:none!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-btn-primary,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-btn-primary{
        background:var(--sp-accent)!important;border-color:var(--sp-accent)!important;
        color:var(--sp-on-accent)!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-btn-danger{background:var(--sp-nav)!important;color:var(--sp-sub)!important}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-btn:hover,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-btn:hover{filter:brightness(.98);transform:none!important}
      #dy-fire-user-select-panel.spark-themed-dialog button:focus-visible,
      #dy-fire-user-select-panel.spark-themed-dialog input:focus-visible,
      #dy-fire-help-panel.spark-themed-dialog button:focus-visible,
      #dy-fire-help-panel.spark-themed-dialog input:focus-visible,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-nav-item:focus-visible{
        outline:2px solid var(--sp-accent)!important;outline-offset:2px;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-list{
        flex:1;min-height:160px;max-height:none!important;margin:12px 17px!important;
        border:1px solid var(--sp-line)!important;border-radius:11px!important;
        background:var(--sp-bg)!important;overflow-y:auto!important;padding:5px!important;
        scrollbar-color:var(--sp-line) transparent;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-row{
        border-bottom:1px solid var(--sp-soft-line)!important;
        border-radius:7px;padding:11px!important;
        transition:background .14s ease;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-row:hover{background:var(--sp-surface)!important}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-row:last-child{border-bottom:0!important}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-row label{display:flex!important;width:100%;gap:6px;color:var(--sp-text)!important}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-row span[style*="color:#fff"]{color:var(--sp-text)!important;font-size:13px!important;min-width:0;overflow:hidden;text-overflow:ellipsis}
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-row input[type="checkbox"]{
        appearance:auto;flex:none;width:17px!important;height:17px!important;
        accent-color:var(--sp-accent)!important;margin:0 5px 0 0!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-user-row span[style*="color:#ff9500"]{
        margin-left:auto!important;background:var(--sp-note-bg)!important;border:1px solid var(--sp-line)!important;color:var(--sp-accent-text)!important;
      }
      #dy-fire-user-select-panel.spark-themed-dialog .dyfire-modal-footer,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-modal-footer{
        padding:13px 17px!important;background:var(--sp-bg)!important;
        border-top:1px solid var(--sp-soft-line)!important;
      }
      #dy-fire-help-panel.spark-themed-dialog .dyfire-filter-bar span[style]{color:var(--sp-sub)!important}
      #dy-fire-help-panel.spark-themed-dialog #dy-fire-help-search{
        min-width:0!important;width:100%;flex:1;border:1px solid var(--sp-line)!important;
        border-radius:9px!important;padding:9px 11px!important;
        background:var(--sp-control)!important;color:var(--sp-text)!important;
        outline:none!important;
      }
      #dy-fire-help-panel.spark-themed-dialog #dy-fire-help-search:focus{border-color:var(--sp-accent)!important}
      #dy-fire-help-panel.spark-themed-dialog #dy-fire-help-search::placeholder{color:var(--sp-muted)!important;opacity:1}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-nav{
        background:var(--sp-nav)!important;border-right:1px solid var(--sp-line)!important;
        width:172px!important;padding:10px 8px!important;scrollbar-color:var(--sp-line) transparent;
      }
      #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-nav-item{
        display:block!important;border:0!important;border-radius:9px!important;
        padding:11px 12px!important;margin-bottom:3px!important;
        color:var(--sp-sub)!important;font-weight:500;
      }
      #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-nav-item:hover{background:var(--sp-surface)!important;color:var(--sp-text)!important}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-nav-item.active{
        background:var(--sp-active)!important;color:var(--sp-accent-text)!important;font-weight:700!important;
      }
      #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-body{
        min-width:0;min-height:0;flex:1;background:var(--sp-bg)!important;color:var(--sp-text)!important;
        padding:18px!important;scrollbar-color:var(--sp-line) transparent;
      }
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section{
        background:var(--sp-surface)!important;border:1px solid var(--sp-line)!important;
        border-radius:11px!important;margin-bottom:13px!important;padding:15px 16px!important;
        color:var(--sp-text)!important;
      }
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section h4{color:var(--sp-text)!important;font-size:14px!important;margin:0 0 10px!important}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section [style*="color:#"],
      #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-body > [style*="color:#"]{color:var(--sp-sub)!important}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section b,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section strong,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section b[style*="color:#"]{color:var(--sp-accent-text)!important}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section a{color:var(--sp-accent-text)!important;text-decoration:underline}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section code,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section [style*="background:#222"]{
        background:var(--sp-nav)!important;color:var(--sp-text)!important;
        border-radius:5px!important;padding:2px 5px!important;
      }
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section table,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section table td,
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section table th{border-color:var(--sp-line)!important;color:var(--sp-sub)!important}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section table{max-width:100%;width:100%;border-collapse:collapse}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section table td{padding:10px 8px!important;overflow-wrap:anywhere}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-help-highlight{color:#261a00!important}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-modal-footer #dy-fire-help-gotit{width:100%!important;min-height:40px}
      #dy-fire-help-panel.spark-themed-dialog .dyfire-section:focus-within{border-color:var(--sp-accent)!important}
      @media(max-width:700px){
        #dy-fire-help-panel.spark-themed-dialog > div[style*="height:calc"]{flex-direction:column!important;height:calc(100vh - 210px)!important;min-height:0!important}
        #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-nav{
          display:flex!important;gap:5px;flex:none!important;width:100%!important;
          min-height:49px!important;max-height:80px!important;overflow-x:auto!important;overflow-y:hidden!important;
          padding:6px 9px!important;border-right:0!important;border-bottom:1px solid var(--sp-line)!important;
        }
        #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-nav-item{flex:none;white-space:nowrap;margin:0!important;padding:8px 10px!important}
        #dy-fire-help-panel.spark-themed-dialog .dyfire-settings-body{padding:12px!important}
      }
      @media(max-width:480px){
        #dy-fire-user-select-panel.spark-themed-dialog .dyfire-toolbar{gap:6px!important}
        #dy-fire-user-select-panel.spark-themed-dialog .dyfire-toolbar .dyfire-btn{font-size:11px!important;padding:7px 9px!important}
        #dy-fire-user-select-panel.spark-themed-dialog .dyfire-modal-footer{padding:10px!important}
        #dy-fire-help-panel.spark-themed-dialog .dyfire-filter-bar{flex-wrap:nowrap!important}
        #dy-fire-help-panel.spark-themed-dialog #dy-fire-help-search{min-width:0!important;font-size:12px!important}
      }

      #spark-floating{position:fixed;right:22px;bottom:20px;z-index:2147483646;padding:12px 17px;background:var(--sp-floating);color:var(--sp-on-accent);border:0;border-radius:50px;box-shadow:0 10px 25px var(--sp-shadow);font-weight:700;cursor:pointer}
      @media(max-width:390px){#dy-fire-helper.spark-shell{right:8px!important;bottom:66px!important}#spark-floating{right:10px;bottom:10px}}
    `;
    document.head.appendChild(style);
}
function createControlPanel() {
    if (document.getElementById('dy-fire-helper')) document.getElementById('dy-fire-helper').remove();
    sparkInitStyle();
    sparkImportOldUiOnce();
    const panel = document.createElement('div');
    panel.id = 'dy-fire-helper';
    panel.className = 'spark-shell';
    panel.innerHTML = `
      <div class="spark-top"><b>🔥 续火助手</b><div class="spark-top-actions"><button id="spark-theme-quick" type="button" class="spark-secondary spark-theme-quick" aria-label="切换夜间主题">🌙 夜间</button><button id="dy-fire-helper-close" class="spark-secondary" aria-label="收起">收起 ↓</button></div></div>
      <div class="spark-nav"><button data-spark-tab="today" aria-selected="true">今天</button><button data-spark-tab="advanced" aria-selected="false">高级</button></div>
      <div id="spark-today" class="spark-content">
        <div class="spark-stats"><div class="spark-stat"><strong id="spark-scan-count">0</strong><small>扫描会话</small></div><div class="spark-stat"><strong id="spark-selected-count">0</strong><small>已勾选</small></div><div class="spark-stat"><strong id="spark-done-count">0</strong><small>今日处理</small></div></div>
        <div class="spark-row"><b>勾选要续火的聊天</b><button id="spark-scan-btn" class="spark-secondary">↻ 扫描全部</button></div>
        <input id="spark-filter" class="spark-input" placeholder="搜索聊天昵称" aria-label="搜索聊天昵称">
        <div id="spark-contacts" class="spark-contacts"><div class="spark-empty">正在读取聊天列表…</div></div>
        <div class="spark-row"><span class="spark-pill"><span id="spark-pending-count">0</span> 位待处理</span><span><button id="spark-select-all" class="spark-secondary">全选</button> <button id="spark-clear-all" class="spark-secondary">取消全选</button></span></div>
        <div class="spark-subhead">发送内容</div>
        <textarea id="spark-message" class="spark-input" maxlength="900" aria-label="发送内容">${sparkEsc(userConfig.customMessage||userConfig.baseMessage||'续火🔥')}</textarea>
        <div id="spark-emoji-row" class="spark-actions"><button class="spark-secondary" data-spark-emoji="🔥">🔥</button><button class="spark-secondary" data-spark-emoji="❤️">❤️</button><button class="spark-secondary" data-spark-emoji="🫶">🫶</button><button class="spark-secondary" data-spark-emoji="😊">😊</button></div>
        <div class="spark-actions"><button id="dy-fire-pause" class="spark-secondary">⏸ 暂停</button><button id="spark-preview" class="spark-secondary">消息预览</button></div>
        <button id="dy-fire-send" class="spark-primary">一键自动发送</button>
        <div class="spark-note">点击后直接使用参考项目原版自动搜索、切换、输入和发送流程；不逐人弹窗。仅对明确勾选的联系人执行。</div>
        <div class="spark-status"><span>执行状态：</span><b id="dy-fire-status">未发送</b> · <span id="dy-fire-user-status">未开始</span> · <span id="dy-fire-user-progress">0/0</span></div>
      </div>
      <div id="spark-advanced" class="spark-content" hidden>
        <div class="spark-subhead">界面主题</div>
        <p class="spark-note">当前主题：<strong id="spark-theme-current">日光</strong>。顶部可一键切换日夜；这里可选择 6 种配色，刷新后保持。</p>
        <div id="spark-theme-choices" class="spark-theme-grid" role="radiogroup" aria-label="界面主题">${sparkThemeOptionsHtml()}</div>
        <div class="spark-subhead">原版功能 · 按需配置</div>
        <label class="spark-switch"><span>每日定时自动发送</span><input id="spark-auto-on" type="checkbox"></label>
        <label>每日发送时间 <input id="spark-send-time" class="spark-input" type="time" value="${sparkEsc((userConfig.sendTime||'20:30:00').slice(0,5))}"></label>
        <label class="spark-switch"><span>失败自动重试</span><input id="spark-retry-on" type="checkbox"></label>
        <label class="spark-switch"><span>读取官方页面火花天数</span><input id="spark-fire-on" type="checkbox"></label>
        <label class="spark-switch"><span>动态文案（按原版设置）</span><input id="spark-dynamic-on" type="checkbox"></label>
        <label class="spark-switch"><span>显示快捷 Emoji</span><input id="spark-quick-emoji-on" type="checkbox"></label>
        <label class="spark-switch"><span>为好友轮换发送常用素材</span><input id="spark-rotate-on" type="checkbox"></label>
        <label>每位好友之间间隔（秒）<input id="spark-delay" class="spark-input" type="number" min="3" max="30" value="${Number(sparkUi.delaySeconds)||3}"></label>
        <div class="spark-subhead">常用文案库</div>
        <textarea id="spark-new-material" class="spark-input" placeholder="填写要保存的常用文案（最多900字）"></textarea>
        <button id="spark-add-material" class="spark-secondary">＋ 保存到文案库</button>
        <div id="spark-material-list"></div>
        <label class="spark-switch"><span>多账号调度器完成回调</span><input id="spark-callback-on" type="checkbox"></label>
        <div class="spark-subhead">多账号配套工具</div>
        <input id="spark-account-id" class="spark-input" placeholder="账号标识，如 account_1" value="${sparkEsc(userConfig.scriptBAccountId||'')}">
        <input id="spark-callback-token" class="spark-input" type="password" placeholder="调度器回调令牌" value="${sparkEsc(userConfig.scriptBCallbackToken||'')}">
        <div class="spark-note">多账号请运行 tools/manager.py，脚本与调度器填写相同账号标识、端口及令牌。</div>
        <div class="spark-buttons"><button id="spark-fire-panel">🔥 火花管理</button><button id="spark-log-panel">📋 日志筛选</button><button id="spark-settings">⚙ 全部原版设置</button><button id="spark-targets">👥 原版选人窗口</button><button id="spark-help">📖 使用帮助</button><button id="spark-export">⬇ 导出配置</button><button id="spark-import-btn">⬆ 导入配置</button><button id="spark-diagnostics">兼容诊断</button><button id="spark-reset-today">↻ 重置今日标记</button><button id="spark-reset-retries">重置重试并发送</button></div>
        <input id="spark-import-file" type="file" accept=".json,application/json" hidden>
        <div class="spark-subhead">状态与实时日志</div>
        <div class="spark-stats"><div class="spark-stat"><strong id="dy-fire-retry">0/3</strong><small>重试次数</small></div><div class="spark-stat"><strong id="dy-fire-days">0</strong><small>火花天数</small></div><div class="spark-stat"><strong id="dy-fire-countdown">--:--</strong><small>倒计时</small></div></div>
        <p class="spark-note">下次定时：<span id="dy-fire-next">--</span> <span id="dy-fire-pause-status" hidden> · 已暂停</span></p>
        <div id="dy-fire-log"></div>
        <div hidden><span id="dy-fire-hitokoto"></span><span id="dy-fire-special-hitokoto"></span><span id="dy-fire-txtapi"></span></div>
        <p class="spark-note">基于原项目 2026.10.02 发送内核 · UI ${SPARK_UI_BUILD}。原版的“成功”日志是提交动作后的乐观判定，并非平台送达证明。</p>
      </div>
      <div id="spark-toast" role="status" aria-live="polite" hidden></div>
    `;
    document.body.appendChild(panel);
    sparkApplyTheme(sparkUi.theme);
    let floating = document.getElementById('dy-fire-reopen-btn');
    if (!floating) {
        floating = document.createElement('button');
        floating.id = 'dy-fire-reopen-btn';floating.textContent = '🔥 续火';
        floating.style.cssText = 'display:none';
        document.body.appendChild(floating);
    }
    floating.textContent = '🔥 续火';floating.style.cssText='display:none';
    const floatingStyle = document.getElementById('spark-ui-style');
    if (floatingStyle) floatingStyle.textContent += '\n#dy-fire-reopen-btn{position:fixed;right:22px;bottom:20px;z-index:2147483646;padding:12px 17px;background:var(--sp-floating);color:var(--sp-on-accent);border:0;border-radius:50px;box-shadow:0 10px 25px var(--sp-shadow);font-weight:700;cursor:pointer}';
    floating.addEventListener('click',()=>{panel.style.display='flex';floating.style.display='none';});
    document.getElementById('dy-fire-helper-close').addEventListener('click',()=>{panel.style.display='none';floating.style.display='block';});
    panel.addEventListener('click',event=>{
      const themeChoice=event.target.closest('[data-spark-theme-choice]');if(themeChoice){sparkApplyTheme(themeChoice.dataset.sparkThemeChoice,true);return;}
      if(event.target.closest('#spark-theme-quick')){sparkToggleDayNight();return;}
      const tab=event.target.closest('[data-spark-tab]');if(tab){sparkSwitchTab(tab.dataset.sparkTab);return;}
      if(event.target.closest('#spark-scan-btn')) return sparkScanAll();
      if(event.target.closest('#spark-select-all')) return sparkSaveTargets([...sparkCandidates.keys()]);
      if(event.target.closest('#spark-clear-all')) return sparkSaveTargets([]);
      if(event.target.closest('#dy-fire-send')) return sparkSendDirect();
      if(event.target.closest('#dy-fire-pause')) {togglePause();sparkRefreshCounts();return;}
      if(event.target.closest('#spark-preview')) {sparkSaveMessage();showMessagePreview();return;}
      if(event.target.closest('#spark-fire-panel')) return showFireDaysPanel();
      if(event.target.closest('#spark-log-panel')) return showLogPanel();
      if(event.target.closest('#spark-settings')) return showSettingsPanel();
      if(event.target.closest('#spark-targets')) return showUserSelectPanel();
      if(event.target.closest('#spark-help')) return showHelpPanel();
      if(event.target.closest('#spark-export')) return sparkExportConfig();
      if(event.target.closest('#spark-import-btn')) return panel.querySelector('#spark-import-file').click();
      if(event.target.closest('#spark-diagnostics')) return sparkExportDiagnostic();
      if(event.target.closest('#spark-add-material')) {
          const text=panel.querySelector('#spark-new-material').value;
          if(!text.trim()||text.length>900||sparkUi.materials.length>=100){sparkToast('素材为空、超过900字或已满100条');return;}
          sparkUi.materials.push({title:text.split('\n')[0].slice(0,50)||'常用内容',content:text});sparkWriteUi();
          panel.querySelector('#spark-new-material').value='';sparkRenderMaterials();sparkToast('已保存');return;
      }
      const materialUse=event.target.closest('[data-spark-use]');
      if(materialUse){const m=sparkUi.materials[Number(materialUse.dataset.sparkUse)];if(m){panel.querySelector('#spark-message').value=m.content;sparkSaveMessage();sparkSwitchTab('today');sparkToast('素材已填入正文');}return;}
      const materialDelete=event.target.closest('[data-spark-delete]');
      if(materialDelete){sparkUi.materials.splice(Number(materialDelete.dataset.sparkDelete),1);sparkWriteUi();sparkRenderMaterials();return;}
      const emoji=event.target.closest('[data-spark-emoji]');
      if(emoji){const area=panel.querySelector('#spark-message'),pos=area.selectionStart??area.value.length;area.value=area.value.slice(0,pos)+emoji.dataset.sparkEmoji+area.value.slice(pos);sparkSaveMessage();area.focus();area.setSelectionRange(pos+emoji.dataset.sparkEmoji.length,pos+emoji.dataset.sparkEmoji.length);return;}
      if(event.target.closest('#spark-reset-today')) {if(confirm('重置原版的今日发送记录？请先确定不会造成重复发送。')){resetTodaySentUsers();sparkRefreshCounts();}return;}
      if(event.target.closest('#spark-reset-retries')) return resetRetryAndSend();
    });
    panel.addEventListener('change',event=>{
      const c=event.target;
      if(c.matches('[data-spark-name]')){
        const names=new Set(sparkSelected());
        if(c.checked)names.add(c.dataset.sparkName);else names.delete(c.dataset.sparkName);
        sparkSaveTargets([...names]);return;
      }
      if(c.id==='spark-auto-on'){
        userConfig.automationEnabled=c.checked;saveConfig();
        if(c.checked&&!isPaused){updateStatus(false);_scheduleNextAutoCheck();}else{if(_autoSendTimer)clearTimeout(_autoSendTimer);if(countdownInterval)clearInterval(countdownInterval);_autoSendTimer=null;countdownInterval=null;}
        sparkToast(c.checked?'已启用原版每日定时任务（需保持页面运行）':'已关闭定时发送');sparkRefreshCounts();return;
      }
      if(c.id==='spark-retry-on') {userConfig.retryAfterMaxReached=c.checked;saveConfig();sparkRefreshCounts();return;}
      if(c.id==='spark-fire-on') {userConfig.autoFetchFireDays=c.checked;saveConfig();return;}
      if(c.id==='spark-quick-emoji-on') {sparkUi.quickEmoji=c.checked;sparkWriteUi();sparkRefreshCounts();return;}
      if(c.id==='spark-rotate-on') {sparkUi.rotate=c.checked;sparkWriteUi();return;}
      if(c.id==='spark-delay') {sparkUi.delaySeconds=Math.max(3,Math.min(30,Number(c.value)||3));sparkWriteUi();return;}
      if(c.id==='spark-dynamic-on') {sparkUi.dynamic=c.checked;sparkWriteUi();sparkToast(c.checked?'动态模板已启用，请到原版设置配置内容来源':'发送内容使用主界面原文');return;}
      if(c.id==='spark-callback-on') {userConfig.enableScriptBCallback=c.checked;saveConfig();sparkToast(c.checked?'回调已开启：请填写账号标识与令牌':'回调已关闭');return;}
      if(c.id==='spark-send-time') {userConfig.sendTime=c.value+':00';userConfig.sendTimeRandom=false;saveConfig();if(userConfig.automationEnabled)updateStatus(false);return;}
      if(c.id==='spark-account-id') {userConfig.scriptBAccountId=c.value.trim();saveConfig();return;}
      if(c.id==='spark-callback-token') {userConfig.scriptBCallbackToken=c.value;saveConfig();return;}
    });
    panel.querySelector('#spark-filter').addEventListener('input',sparkRenderContacts);
    panel.querySelector('#spark-import-file').addEventListener('change',e=>sparkImportConfigFile(e.target.files?.[0]));
    sparkRenderMaterials();
    panel.querySelector('#spark-message').addEventListener('change',sparkSaveMessage);
    sparkRefreshCounts();
    // Original engine changes progress text asynchronously; reflect it in the new UI.
    for (const id of ['dy-fire-user-progress','dy-fire-status','dy-fire-user-status']) {
        const n=document.getElementById(id);
        if (n) new MutationObserver(sparkRefreshCounts).observe(n,{childList:true,characterData:true,subtree:true});
    }
    setTimeout(sparkScanAll,800);
}
