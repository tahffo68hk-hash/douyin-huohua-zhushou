# 抖音火花助手 V0.9.0 · 参考项目内核版

本版**从 `dr-190/ScriptCat-Douyin-Fire-Helper` 2026.10.02 原版源码出发**，不再使用自制 V0.8 的 `runOne()` / `navigateTo()` / 发送 SVG 父级点击链路。主界面改为原 V0.8 的浅色双标签「今天 / 高级」；「今天」勾选好友后直接调用参考项目 `sendMessage()`，原版内核会搜索联系人、导航、输入、合成 Enter、逐个处理。

原项目：https://github.com/dr-190/ScriptCat-Douyin-Fire-Helper（保留原作者署名、MIT License，源码备份 `vendor/reference-original.txt`）。

## 安装

1. **在脚本管理器中停用** V0.7 / V0.8 / 原版等重复运行的抖音续火脚本，避免多脚本争抢页面 DOM；不要清除原有脚本存储。
2. 用 ScriptCat / Tampermonkey 安装 ZIP 根目录中的**唯一安装脚本** `douyin-spark.user.js`。
3. 打开 `https://www.douyin.com/chat`，若有右下角「🔥 续火」按钮就点击它。新安装时主工作台初始展开。
4. 「今天」自动尝试扫描页面会话，也可点击「扫描全部」；勾选目标联系人或全选、编辑发送内容，再点一次「一键自动发送」。**不弹出逐人核对窗口**。
5. 发送期间保留抖音页面处于可访问状态，允许脚本控制其官方聊天搜索框。运行进度由参考引擎展示；「暂停」可停止后续任务调度。
6. 「高级」使用原版的定时、失败重试、火花管理、日志筛选、设置、动态模板，以及新增的常用文案库、轮换、快捷 Emoji、自定义间隔、配置导入导出、诊断与多账号管理。

## 产品交互与功能对齐

| 能力 | 实现路径 |
|---|---|
| 扫描会话、选择、全选/取消 | 直接调用原版 `autoScrollChatListAndCollect`，勾选结果写入原版 `targetUsernames` |
| 一键发送、逐人切换与输入 | UI `sparkSendDirect` → 原版 `sendMessage` → `executeSendProcess` → `findAndClickTargetUserChat` → `inputMessageToChatEditor` → `triggerEnterToSend` |
| 定时与随机时间 | 原版调度；**默认关闭**，高级可启用并编辑执行时间；更完整配置在原版设置 |
| 火花管理 | 原版页面天数解析、本地存储与编辑窗口 |
| 失败重试 | 原版重试状态机，开启额外超限重试需在高级中启用 |
| 暂停恢复 | 原版 `togglePause()` 和持久化状态 |
| 日志与设置 | 原版分片日志、搜索/导出、详细设置窗口 |
| 常用文案/轮换/Emoji | 新界面适配层，轮换正文进入原版发送前的文案生成入口 |
| 备份恢复 | 仅设置、文案库；不导入以前的提交记录，也不会自动打开定时与回调 |
| 多账号调度 | 包内 `tools/manager.py` 和 `scheduler.py/.ps1/.sh`；已适配脚本认证回调格式 |

### 多账号

1. `python tools/manager.py --init` 初始化 `tools/config.json`，通过 `python tools/manager.py --gui` 配置账号、浏览器 Profile。
2. 在每个账号的已登录浏览器 Profile 中安装此用户脚本，在「高级」打开每日定时和多账号调度回调。
3. 填写与管理器一致的**账号标识**和**回调令牌**。默认端口为 `7788`，可在「全部原版设置」中修改 `scriptBCallbackPort`。
4. 使用 `python tools/scheduler.py --config tools/config.json --once --dry-run` 先做不启动浏览器的预演，或通过 `tools/scheduler.ps1` / `.sh` 启动实际调度。调度器只有在收到匹配账号和令牌的合法 `/done` 才计为完成，登录状态需在各自 Profile 中提前配置。
5. **注意**：原版执行结果的“success”仍属于脚本内部状态，不是抖音服务端送达凭证；调度器接收到 `DONE` 不代表对方已收到消息。

## 真实兼容性与注意事项

- **未使用你的已登录真实抖音会话执行任何发信操作。** 当前通过的是**隔离 Chromium 测试**：一键向两位测试联系人切换、输入及发送事件，素材轮换、双标签和本机认证回调。不能据此保证真实抖音一定接受合成 Enter，也不能宣称端到端已验收。
- 保留参考项目最核心的 `simulateMouseClick`、`execCommand('insertText')` 和 `triggerEnterToSend`。它们是网页 DOM 自动化，不是官方 API；真实浏览器可能因为网页更新或合成事件限制而无法发送。
- **原版的成功判定偏乐观**：派发 Enter 并等待后就可能记录“发送成功”，没有严格核验新增己方气泡。这是继承原版发送内核的已知限制，不等于消息已送达，启用每日定时前建议在同意接收消息的单个会话做真实验证。
- 原版的昵称搜索使用模糊匹配作为备选，仍存在同名/近似昵称选错风险；批量发送前请确保名单唯一。原版输入流程可能清空已有输入草稿。
- 一键按钮**不弹逐人确认**，但遇到真正的页面输入或浏览器限制，无法保证软件一定发送成功；这是源码适配能力与平台行为边界，不应隐瞒。
- 不要在浏览器内同时运行原版与本版，不要通过刷新/重置标记盲目重复发送可能已经送达的内容。

## 测试与重建

```
node --check douyin-spark.user.js
python tests/test_source.py
python tests/test_browser.py
python tests/test_features.py
python tests/test_tools.py
python build.py
```

使用本项目 `vendor/reference-original.txt` 作为参考源码快照，可用 `build.py` 重新生成安装脚本。详见 `docs/TEST_REPORT.md`，原版署名与 MIT 授权保留。
