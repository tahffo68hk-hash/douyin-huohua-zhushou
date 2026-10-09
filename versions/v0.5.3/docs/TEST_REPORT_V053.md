# V0.5.3 DOM 适配结果

日期：2026-10-09（Asia/Shanghai）  
Build ID：`v053-dom-adapter-20261009-r1`  
本地结论：`CODE_AND_REGRESSION_PASS / LIVE_DOM_COMPATIBILITY_PARTIAL / V053_BUILD_CONFIRMED`

## 修复内容

- 列表昵称读取精确的 `.conversationConversationItemtitle` 节点；星期/时间标签是 `.conversationConversationItemtitleWrapper` 下的兄弟节点，在线提示在描述区。旧的无 ID 临时缓存不会再按行位置恢复或持久复用。
- 个人行使用 `.commonIMAvataravatarContainer`，群聊行使用 `.commonConversationIconnoDrag`。遇到未知或冲突结构返回 `UNKNOWN`。
- 当前选中类 `conversationConversationItemcurConversation` 只表示页面选择状态。它允许当前页面读取非身份元数据，不作为稳定身份凭证。
- `inspectCurrent()` 可在当前行和详情标题唯一精确匹配时读取页面状态，同时保持 `UNVERIFIED`。火花天数/来源、重燃状态、今日任务状态各自独立；未读到平台天数时显示未知。
- 无稳定 ID 时新增单收件人、单次手动确认：要求一条选中行、无 ID 冲突、可见列表无重名、昵称与聊天标题完全相等且类型已识别。确认不会持久化；多收件人手动队列和自动发送仍要求稳定身份。首次升级关闭自动发送。

## 真实 Chrome 只读观察

真实 Chrome 已显示 V0.5.3 Build ID `v053-dom-adapter-20261009-r1`。本轮只读复测列表和指定会话详情，没有发送新消息。

- 扫描实际收集 13 条会话：12 条被标为个人、1 条被标为群聊。目标个人会话在助手列表中的显示名与聊天顶部标题一致；日期、星期和在线状态没有混入姓名。列表行结构观察为 12 条使用 `.commonIMAvataravatarContainer`，1 条使用 `IMG.commonConversationIconnoDrag`；行外层均为 `[data-e2e="conversation-item"]`。
- 昵称节点 `.conversationConversationItemtitle` 与 `.ConversationItemTagNextToTitlewrapper` 是标题包装器的兄弟节点；星期标签位于 `ConversationItemTagNextToTitletimeStr`，在线状态位于 `ConversationItemDesconlineStatus`。因此星期、日期、在线文字不会作为姓名提取。
- 选中行带 `conversationConversationItemcurConversation` 类；它不提供稳定 ID。首次在未打开详情页时调用行内“详情”未能关联页面，日志为“详情匹配不确定”，没有写入火花状态。手动打开指定会话后，“核对当前聊天火花 / 重燃”和行内“详情”均成功读取页面状态；身份仍为 `UNVERIFIED`，自动发送继续阻止，助手列表仍显示火花未知。
- 好友选择复测中，选中目标后计数变为 1，取消选择后恢复为 0；没有新增好友选择。定时页“启用每日自动发送”复选框为未勾选（值 0）。
- 输入区可见 `data-e2e="msg-input"`、`contenteditable` 的 `.messageEditorinputArea`，发送图标为 `.e2e-send-msg-btn`。另有一个没有 `role`、`aria-label`、`title` 或 `data-e2e` 的 `.messageMsgInputiconAction` SVG；当前无法证明它是官方表情入口，未点击、未尝试发送。
- 指定聊天历史中仍可见此前的单条 V0.5.1 测试消息；本轮没有再次发送。真实页面没有出现本适配器能识别的火花天数/重燃专用 DOM 节点。V0.5.3 保留 `UNKNOWN`，不能据此判断火花正常或已重燃。

## 自动化测试

| 命令 | 结果 |
|---|---|
| `npm run check` | PASS |
| `npm run test` | PASS，109 项 |
| `npm run test:scheduler` | PASS，8/8 |
| `npm run test:browser` | PASS，88 项；含 10 项新增 V0.5.3 真实结构合成夹具 |

新增夹具使用真实页面类名形状，不访问抖音。覆盖类型识别、标题/日期分离、旧临时缓存清理、同名阻止、当前详情读取但不升级身份、天数未知、今日任务分离、自动门禁、多收件人阻止、人工确认单次流程，以及不点击无标签表情图标。夹具中的发送模拟仅在本地 HTML 页面发生。

## 尚未解决

- 抖音当前页面未暴露可用的火花天数/重燃节点，相关状态继续未知。
- 未打开聊天详情时，行内“详情”首次调用不能可靠地自动打开并关联会话；手动打开目标聊天后详情读取通过。该导航行为仍待后续兼容性改进。
- 原生表情包入口未能可靠识别，选择、收藏及手动试发链路保持未验证。
- 自动发送依赖稳定身份 ID；继续保持 BLOCKED。没有关闭门禁或对群聊/多个会话发送。

本轮没有真实消息发送；自动发送保持关闭。没有推送。
