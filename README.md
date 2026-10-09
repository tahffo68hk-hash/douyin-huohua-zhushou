# 抖音火花助手版本归档

这里按版本保存这次提供的历史用户脚本与配套源文件。版本快照来自 SOURCE_ARCHIVES.csv 列出的 ZIP；各版本内的脚本正文按原包复制，未在本次归档中改写。

## 版本目录

| 版本 | 目录 | 来源 |
|---|---|---|
| 0.5.0 | versions/v0.5.0/ | full |
| 0.5.1 | versions/v0.5.1/ | full |
| 0.5.2 | versions/v0.5.2/ | full |
| 0.5.3 | versions/v0.5.3/ | full |
| 0.6.0 | versions/v0.6.0/ | simple |
| 0.7.0 | versions/v0.7.0/ | userscript |
| 0.7.1 | versions/v0.7.1/ | userscript |
| 0.7.2 | versions/v0.7.2/ | userscript |
| 0.8.0 | versions/v0.8.0/ | userscript |
| 0.8.1 | versions/v0.8.1/ | userscript |
| 0.8.2 | versions/v0.8.2/ | userscript |
| 0.8.3 | versions/v0.8.3/ | userscript |
| 0.8.3.1 | versions/v0.8.3.1/ | userscript |
| 0.9.0 | versions/v0.9.0/ | reference UI |
| 0.9.2 | versions/v0.9.2/ | reference UI |

v0.5.1/variants/ 还保留了工作区中的另一份同版本用户脚本。它与 ZIP 中发布脚本的 SHA-256 不同，因此作为单独变体保存。

## 公开副本说明

- 本仓库保存 ZIP 展开的版本快照，不包含原始 ZIP 二进制；SHA-256 记录在 SOURCE_ARCHIVES.csv。
- 为避免公开聊天昵称，本仓库不收录截图；也排除了 Python 缓存文件。版本目录保留脚本、测试和文字文档。
- diagnostics/spark-diagnostic-2026-10-09.json 只记录页面结构与选择器状态，不含聊天正文、昵称、Cookie 或令牌。
- 版本目录内的测试报告保留各版本原有说明；它们不能自动视为真实抖音送达验收。