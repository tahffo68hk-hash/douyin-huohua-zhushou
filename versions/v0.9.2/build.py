from pathlib import Path
base = (Path(__file__).parent/'vendor'/'reference-original.txt').read_text(encoding='utf-8-sig')
root = Path(__file__).parent
ui = (root/'overlay_fragment.js').read_text(encoding='utf-8')
assert base.count('function createControlPanel() {')==1
assert base.count('function createReopenButton() {')==1
assert base.count('function notifyScriptB(payload) {')==1
base = base.replace('// @name         抖音续火助手 - 抖音自动续火花·批量自动发送·多用户定时油猴脚本', '// @name         抖音火花助手 · 一键续火')
base = base.replace('// @namespace    http://tampermonkey.net/', '// @namespace    spark-full-local-userscript')
base = base.replace('// @version      2026.10.02', '// @version      0.9.2')
base = base.replace('// @connect      localhost', '// @connect      localhost\n// @connect      127.0.0.1')
base = base.replace('// @author       飔梦 / 阚泥 / xiaohe123awa / YsKiKi', '// @author       飔梦 / 阚泥 / xiaohe123awa / YsKiKi（原版内核），Spark UI contributors（界面适配）')
base = base.replace('// @description  抖音续火、抖音续火花、抖音自动发送、抖音批量发送脚本。支持多用户批量续火花，每日定时或随机时间自动发送，集成一言API与TXTAPI自定义文案，自动记录好友火花天数，专属一言按周一至周日配置，支持暂停继续、自动重试、后端调度器回调实现无人值守挂机。适配 https://www.douyin.com/chat 页面，兼容 ScriptCat、Tampermonkey 等油猴脚本管理器。日志支持多级筛选、按天分片、批量写入。', '// @description  直接使用参考项目的自动搜索、输入、发送与队列内核；采用简洁的扫描勾选与一键发送界面，定时/火花/日志等置于高级。非官方工具。')
# The two legacy dialogs are presentation-only reskins. Keep all original events, copy and HELP_TABS verbatim.
for fn,next_fn,old_class,new_class in [
    ('showUserSelectPanel','showFireDaysPanel',"panel.className = 'dyfire-modal';","panel.className = 'dyfire-modal spark-themed-dialog spark-target-dialog';"),
    ('showHelpPanel','showSettingsPanel',"panel.className = 'dyfire-modal dyfire-modal-wide';","panel.className = 'dyfire-modal dyfire-modal-wide spark-themed-dialog spark-help-dialog';"),
]:
    begin=base.index('function '+fn+'() {')
    end=base.index('function '+next_fn+'(',begin)
    fragment=base[begin:end]
    assert fragment.count(old_class)==1,fn
    base=base[:begin]+fragment.replace(old_class,new_class,1)+base[end:]

base = base.replace('    baseMessage: "续火",', '    baseMessage: "续火🔥",')
base = base.replace('    sendTime: "00:01:00",', '    sendTime: "20:30:00",\n    automationEnabled: false,')
base = base.replace('    customMessage: "—————每日续火—————\\n\\n[TXTAPI]\\n\\n—————每日一言—————\\n\\n[API]\\n\\n—————专属一言—————\\n\\n[专属一言]\\n\\n🔥 火花已续 [天数] 天",', '    customMessage: "续火🔥",')
base = base.replace('    useHitokoto: true,', '    useHitokoto: false,')
base = base.replace('    useTxtApi: true,', '    useTxtApi: false,')
base = base.replace('    useSpecialHitokoto: true,', '    useSpecialHitokoto: false,')
base = base.replace('    retryAfterMaxReached: true,','    retryAfterMaxReached: false,')
# Advanced optional content rotation and pacing only; the original execution flow remains intact.
base = base.replace('async function getMessageContent(username) {', '''async function getMessageContent(username) {\n    if (sparkUi.rotate && sparkUi.materials.length) {\n        const i = Math.max(0, allTargetUsers.indexOf(username));\n        return sparkUi.materials[i % sparkUi.materials.length].content;\n    }''', 1)
base = base.replace('setTimeout(sendMessage, 3000);', 'setTimeout(sendMessage, Math.max(3000,Math.min(30000,(Number(sparkUi.delaySeconds)||3)*1000)));', 1)
# Avoid unrequested auto-sending from the reference defaults; manual send untouched.
base = base.replace('function autoSendIfNeeded() {\n', 'function autoSendIfNeeded() {\n    if (!userConfig.automationEnabled) return;\n',1)
base = base.replace('function _scheduleNextAutoCheck() {\n', 'function _scheduleNextAutoCheck() {\n    if (!userConfig.automationEnabled) return;\n',1)
base = base.replace('function startCountdown(targetTime) {\n', 'function startCountdown(targetTime) {\n    if (!userConfig.automationEnabled) return;\n',1)
# Prevent legacy successful-send status from continuing scheduled runs when schedule disabled.
# Keep the existing reference search, input, keyboard and task sequencing routines unchanged.
start=base.index('function createControlPanel() {')
end=base.index('function createReopenButton() {',start)
base=base[:start]+ui+'\n\n'+base[end:]
start=base.index('function notifyScriptB(payload) {')
end=base.index('/* =========================================================\n * 数据清理',start)
notify = '''function notifyScriptB(payload) {
    if (!userConfig.enableScriptBCallback) return;
    const token = String(userConfig.scriptBCallbackToken||'');
    const account = String(userConfig.scriptBAccountId||'');
    if (!/^[a-zA-Z0-9_-]{1,60}$/.test(account) || token.length < 24) {
        addHistoryLog('本机调度器账号 ID / 回调令牌未配置，未发送回调', LEVEL.WARN, {cat:CAT.API});
        return;
    }
    const status = payload.status === 'success' ? 'DONE' : payload.status === 'all_failed' ? 'FAILED' : 'FAILED';
    const confirmed = Number.isInteger(payload.sentCount) ? payload.sentCount : payload.status === 'success' ? 1 : 0;
    const failed = Number.isInteger(payload.failCount) ? payload.failCount : payload.status === 'all_failed' ? 1 : 0;
    GM_xmlhttpRequest({
        method:'POST', url:`http://127.0.0.1:${userConfig.scriptBCallbackPort||7788}/done`,
        headers:{'Content-Type':'application/json','X-Spark-Token':token},
        data:JSON.stringify({account,status,confirmed,failed,unknown:0,at:nowMs()}),
        timeout:5000,
        onerror:()=>addHistoryLog('本机调度器回调失败', LEVEL.ERROR,{cat:CAT.API}),
        ontimeout:()=>addHistoryLog('本机调度器回调超时', LEVEL.ERROR,{cat:CAT.API}),
        onload:r=>addHistoryLog(`本机调度器回调 HTTP ${r.status}`,r.status===200?LEVEL.INFO:LEVEL.ERROR,{cat:CAT.API})
    });
}

'''
base=base[:start]+notify+base[end:]
# We only need one UI-panel trigger; other reference menu commands stay accessible.
root.joinpath('douyin-spark.user.js').write_text(base,encoding='utf-8')
print('build created',len(base),'characters', len(base.splitlines()),'lines')
