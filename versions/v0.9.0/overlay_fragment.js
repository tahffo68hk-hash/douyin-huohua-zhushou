/* =========================================================
 * Spark V0.9.0 UI adapter. The reference execution engine stays in place.
 * This layer calls its existing scan/send/schedule/settings entry points.
 * ========================================================= */
const SPARK_UI_BUILD = 'ref-engine-ui-20261009-r1';
const SPARK_UI_KEY = 'spark:reference-ui:v1';
const sparkUiRead = () => {
    const raw = GM_getValue(SPARK_UI_KEY, {});
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
};
let sparkUi = sparkUiRead();
if (!Array.isArray(sparkUi.materials)) sparkUi.materials = [];
if (typeof sparkUi.quickEmoji !== 'boolean') sparkUi.quickEmoji = true;
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
    const diag={version:'0.9.0',build:SPARK_UI_BUILD,at:new Date().toISOString(),scanCount:sparkCandidates.size,selectedCount:sparkSelected().length,
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
    const blob = new Blob([JSON.stringify({version:'0.9.0',format:'spark-ref-config',config,targets:sparkSelected(),materials:sparkUi.materials,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');a.href=url;a.download='spark-reference-config.json';document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function sparkInitStyle() {
    if (document.getElementById('spark-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'spark-ui-style';
    style.textContent = `
      #dy-fire-helper.spark-shell{position:fixed!important;top:auto!important;right:20px!important;bottom:76px!important;width:370px!important;max-width:calc(100vw - 16px)!important;height:min(660px,calc(100vh - 90px))!important;overflow:hidden!important;display:flex;flex-direction:column;background:#fff!important;color:#182538!important;border:1px solid #e0e6ef!important;border-radius:16px!important;font:13px/1.45 system-ui,-apple-system,'PingFang SC','Microsoft YaHei',sans-serif!important;box-shadow:0 22px 70px #102b4433!important;z-index:2147483646!important;backdrop-filter:none!important}
      #dy-fire-helper.spark-shell *{box-sizing:border-box}
      #dy-fire-helper.spark-shell button,#dy-fire-helper.spark-shell input,#dy-fire-helper.spark-shell textarea{font:inherit}
      #dy-fire-helper.spark-shell button{cursor:pointer}
      #dy-fire-helper.spark-shell button:disabled{opacity:.5;cursor:not-allowed}
      #dy-fire-helper.spark-shell .spark-top{padding:15px 16px 10px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #e7edf6}
      #dy-fire-helper.spark-shell .spark-top b{font-size:16px;color:#192a42}
      #dy-fire-helper.spark-shell .spark-nav{display:flex;gap:6px;padding:8px 14px;border-bottom:1px solid #e7edf6}
      #dy-fire-helper.spark-shell .spark-nav button{flex:1;background:#f0f3f8;border:0;border-radius:8px;padding:8px;color:#51657f}
      #dy-fire-helper.spark-shell .spark-nav button[aria-selected=true]{background:#e7efff;color:#1b55bb;font-weight:700}
      #dy-fire-helper.spark-shell .spark-content{padding:14px;overflow-y:auto;flex:1;min-height:0;overscroll-behavior:contain}
      #dy-fire-helper.spark-shell .spark-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:14px}
      #dy-fire-helper.spark-shell .spark-stat{padding:11px 6px;text-align:center;background:#f6f8fc;border-radius:10px}
      #dy-fire-helper.spark-shell .spark-stat strong{font-size:20px;display:block;color:#20334d}
      #dy-fire-helper.spark-shell .spark-stat small{font-size:11px;color:#63758d}
      #dy-fire-helper.spark-shell .spark-row{display:flex;justify-content:space-between;align-items:center;gap:7px;margin:9px 0}
      #dy-fire-helper.spark-shell .spark-secondary{border:1px solid #d9e2ee;background:white;color:#35577d;border-radius:9px;padding:7px 10px}
      #dy-fire-helper.spark-shell .spark-primary{display:block;width:100%;border:0;background:#2563eb;color:#fff;border-radius:9px;padding:11px 14px;font-weight:700;margin-top:12px}
      #dy-fire-helper.spark-shell .spark-contacts{max-height:230px;overflow-y:auto;border:1px solid #e2e7ef;border-radius:10px;padding:4px;margin:8px 0;overscroll-behavior:contain}
      #dy-fire-helper.spark-shell .spark-contact{display:flex;gap:9px;align-items:center;padding:8px;border-bottom:1px solid #edf0f4;cursor:pointer}
      #dy-fire-helper.spark-shell .spark-contact:last-child{border:0}
      #dy-fire-helper.spark-shell .spark-contact input{width:17px;height:17px;accent-color:#2563eb;flex:0 0 auto}
      #dy-fire-helper.spark-shell .spark-contact-text{flex:1;min-width:0}
      #dy-fire-helper.spark-shell .spark-contact b{display:block;color:#263a56;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px}
      #dy-fire-helper.spark-shell .spark-contact small{display:block;color:#8190a1;font-size:11px}
      #dy-fire-helper.spark-shell .spark-empty{padding:18px 9px;text-align:center;color:#8895a8}
      #dy-fire-helper.spark-shell .spark-input{display:block;width:100%;padding:9px;border:1px solid #d6dfeb;border-radius:9px;background:#fff;color:#192d46;margin:7px 0}
      #dy-fire-helper.spark-shell textarea.spark-input{min-height:80px;resize:vertical;line-height:1.6}
      #dy-fire-helper.spark-shell .spark-note{color:#6c7d94;font-size:11px;line-height:1.5;margin-top:7px}
      #dy-fire-helper.spark-shell .spark-pill{font-size:11px;color:#546985}
      #dy-fire-helper.spark-shell .spark-switch{display:flex;gap:9px;align-items:center;justify-content:space-between;border-bottom:1px solid #e8edf5;padding:10px 0;cursor:pointer;color:#273b57}
      #dy-fire-helper.spark-shell .spark-switch input{width:16px;height:16px;accent-color:#2563eb}
      #dy-fire-helper.spark-shell .spark-buttons{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}
      #dy-fire-helper.spark-shell .spark-buttons button{border:1px solid #d9e2ee;border-radius:8px;background:#fff;color:#365579;padding:8px}
      #dy-fire-helper.spark-shell .spark-subhead{font-size:13px;color:#263952;font-weight:700;margin:12px 0 7px}
      #dy-fire-helper.spark-shell .spark-status{font-size:11px;color:#58708e;background:#f3f6fc;border-radius:8px;padding:8px;margin-top:9px}
      #dy-fire-helper.spark-shell #spark-toast{color:#506780;font-size:12px;padding:7px 14px;border-top:1px solid #ecf0f6;background:#f8faff;max-height:66px;overflow-y:auto}
      #dy-fire-helper.spark-shell .spark-actions{display:flex;gap:8px;margin-top:10px}
      #dy-fire-helper.spark-shell .spark-actions button{flex:1}
      #dy-fire-helper.spark-shell [hidden]{display:none!important}
      #dy-fire-helper.spark-shell #dy-fire-log{max-height:90px;overflow:auto;background:#f7f9fd;color:#5e718c;font-size:11px;border-radius:8px}
      #dy-fire-helper.spark-shell #dy-fire-log .dyfire-log-line{border-bottom:1px solid #e6edf5;padding:5px}
      #spark-floating{position:fixed;right:22px;bottom:20px;z-index:2147483646;padding:12px 17px;background:#182f4f;color:#fff;border:0;border-radius:50px;box-shadow:0 10px 25px #142d4b3d;font-weight:700;cursor:pointer}
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
      <div class="spark-top"><b>🔥 续火助手</b><button id="dy-fire-helper-close" class="spark-secondary" aria-label="收起">收起 ↓</button></div>
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
    let floating = document.getElementById('dy-fire-reopen-btn');
    if (!floating) {
        floating = document.createElement('button');
        floating.id = 'dy-fire-reopen-btn';floating.textContent = '🔥 续火';
        floating.style.cssText = 'display:none';
        document.body.appendChild(floating);
    }
    floating.textContent = '🔥 续火';floating.style.cssText='display:none';
    const floatingStyle = document.getElementById('spark-ui-style');
    if (floatingStyle) floatingStyle.textContent += '\n#dy-fire-reopen-btn{position:fixed;right:22px;bottom:20px;z-index:2147483646;padding:12px 17px;background:#182f4f;color:#fff;border:0;border-radius:50px;box-shadow:0 10px 25px #142d4b3d;font-weight:700;cursor:pointer}';
    floating.addEventListener('click',()=>{panel.style.display='flex';floating.style.display='none';});
    document.getElementById('dy-fire-helper-close').addEventListener('click',()=>{panel.style.display='none';floating.style.display='block';});
    panel.addEventListener('click',event=>{
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
