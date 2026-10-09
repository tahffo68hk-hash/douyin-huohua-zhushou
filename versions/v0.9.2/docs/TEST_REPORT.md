# V0.9.2 专项回归记录（2026-10-09）

- [PASS] `node --check douyin-spark.user.js`
- [PASS] `tests/test_source.py`：11 个参考项目核心执行函数保持原文，一处历史间隔参数适配保持不变。
- [PASS] `tests/test_dialogs.py`：原版 `HELP_TABS` 全文与原版两个弹窗事件处理仅差 CSS 类；6 套主题 computed CSS；选人全选/取消/保存；帮助搜索、跳转、关闭；无真实或模拟发送触发；浏览器 JS 错误 0。
- [PASS] `tests/test_themes.py`：6 主题、快捷日夜、存储恢复、不触发发送。
- [PASS] `tests/test_browser.py`：一次点击双人顺序发送模拟场景；非真实 Douyin。
- [PASS] `tests/test_features.py`：双人素材轮换、认证回调模拟场景；非真实 Douyin。
- [PASS] `tests/test_tools.py`：9/9。
- [NOT_TESTED] 真实 Douyin 已登录 Chrome 的消息提交与收件人端送达。
- [DEFERRED] 使用帮助的内容修订，等待仓库确认；不因 UI 换肤改写原文。

---

# V0.9.1 测试报告

## 已完成（隔离环境）

- `tests/test_themes.py`：6 套主题计算后的背景色/文字色、主题单选状态、日夜快捷切换、上一次浅色/深色主题记忆、重新初始化恢复、正文和勾选保留、日程默认关闭、0 次发送、0 JS 异常均 PASS。此测试不提交任何消息。
- 变更范围：`overlay_fragment.js` 的 UI 主题配色、控件和事件；`build.py` 版本标记；README/CHANGELOG/测试，不修改参考内核。

- `node --check`：语法 PASS。
- `tests/test_source.py`：11 个原版关键执行函数逐字一致，`tryFindChatInput` 仅最小发送间隔从常数调整为高级配置（不低于 3 秒）；PASS。
- `tests/test_browser.py`：Chromium 模拟 UI 自动扫描 3 个会话、选择 2 人、输入正文、单次点击调用原版搜索→切换→编辑→Enter→处理下一位，模拟页面生成 2 条发送记录，原版进度 2/2；高级 Tab、定时开启关闭与 UI 最终状态更新；PASS，JS page errors 0。
- `tests/test_features.py`：高级常用文案库保存 2 条、开启轮换，自动按顺序为两个模拟联系人输入不同内容并提交；回调请求账号、认证令牌、URL、状态及计数匹配 scheduler.py 的规范；0 个额外确认弹窗；PASS，JS page errors 0。
- `tests/test_tools.py`：调度器配置、鉴权、无效回调、过期回调、浏览器 dry run 等 9/9 PASS。
- 新版执行复测：主题用例 PASS、源码一致性 PASS、双人模拟发信 PASS、高级文案轮换与回调 PASS、配套工具 9/9 PASS。完整串行跑批曾在进入第二组浏览器脚本时超时，拆分独立执行已通过；超时未计作一次通过。

## 尚未完成（不能冒充通过）

- 真实抖音已登录 Chrome：自动导航、编辑器真实数据同步、合成 Enter 被接收、真实新增己方消息以及多账号连发，均 **NOT TESTED**。
- 参考原版在合成 Enter 后等待约 1.2s 即记成功；本版保留这条原版逻辑，因此不保证真正送达。
- 不支持以模拟夹具的自动制造消息证明真实抖音发送成功。

## 待真实验收的核心测试

仅在用户明确授权的测试会话与正文下，确认该网页确实响应原版输入与 Enter，新增一条真实己方消息，之后才验收第二位联系人；不能使用历史同文消息或原版“成功”提示代替真实消息证据。未获授权不在真实账号发送。
