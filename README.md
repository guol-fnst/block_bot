# Block Bot

Block Bot 是一个面向 `x.com` / `twitter.com` 的 Chrome 扩展，用来扫描当前页面已显示的推文，识别疑似垃圾账号或机器人账号，并在用户确认后将这些账号加入本地屏蔽队列。

## 手动安装

推荐使用 `dist/block-bot-chrome-extension-v0.1.0.zip` 手动安装：

1. 下载或找到仓库里的 `dist/block-bot-chrome-extension-v0.1.0.zip`。
2. 解压这个 zip 文件，得到一个扩展目录。
3. 打开 Chrome，在地址栏输入 `chrome://extensions/`。
4. 打开右上角的“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择第 2 步解压出来的扩展目录。
7. 打开 `x.com` 或 `twitter.com` 页面，点击浏览器工具栏里的 Block Bot 图标开始使用。

注意：不要直接选择 zip 文件，Chrome 的“加载已解压的扩展程序”需要选择解压后的文件夹。

如果 Chrome 没有显示扩展图标，可以点击工具栏右侧的拼图图标，在扩展列表中找到 Block Bot 并固定到工具栏。首次使用前，建议先打开扩展的“选项”页面，配置要使用的模型服务和 API Key。

## 功能说明

扩展只在 `x.com` 与 `twitter.com` 页面运行。它会读取当前页面已经渲染出来的推文内容、账号 handle、显示名称、推文链接和资料页链接，然后把候选数据发送到用户在设置页中选择的固定模型服务进行分类分析。

屏蔽动作不会通过 Block Bot 自己的服务器执行。用户确认后，扩展会在本地浏览器内使用当前登录的 X 账号进行限速屏蔽；如果当前页无法直接完成某一笔操作，扩展可能临时在后台打开一个 X 页面来完成该屏蔽任务。

## 权限说明

- `storage`: 保存模型服务配置、分析缓存和队列状态。
- `tabs`: 查询当前标签页并在必要时创建后台 X 标签页完成屏蔽。
- `scripting`: 向已授权的 X 页面注入脚本以读取页面内容并执行本地自动化。
- `host_permissions` for `x.com` / `twitter.com`: 限定扩展只在这些站点工作。

## Privacy Policy

Last updated: 2026-05-11

### Overview

Block Bot does not operate a proprietary backend service in the current version. Data is processed inside the user's browser and, when analysis is requested, sent directly to the model service configured by the user.

### Data We Access

When the user starts an analysis on an X page, Block Bot may access:

- Visible post text from the current page
- Account handles
- Display names
- Post URLs
- Profile URLs

When the user executes block actions, Block Bot may also access the current logged-in X session context that is already available in the browser in order to complete the user-requested block action locally.

### How We Use Data

Block Bot uses the accessed data only for the following purposes:

- To analyze visible posts and detect likely spam or bot accounts
- To present candidate accounts to the user for review
- To execute user-confirmed local block actions on X
- To save local extension settings, queue state, and temporary analysis cache in Chrome storage

### Data Sharing

Block Bot does not send analyzed content to a Block Bot backend.

If the user enables analysis, the extension sends candidate post data directly to the model service configured by the user. Depending on the user's settings, this may include:

- Google Gemini
- DeepSeek
- Qwen

Those third-party services process data under their own terms and privacy policies. Users are responsible for choosing whether to use a given provider.

### Data Storage

Block Bot stores the following data locally in Chrome extension storage:

- Model provider selection
- API keys entered by the user
- Temporary analysis results
- Block queue state

Data retention defaults:

- Analysis cache: temporary, can be cleared by the user at any time, and may be overwritten by later analyses.
- Provider configuration and API key: kept locally until user edits settings or removes the extension.
- Queue state and operation log: kept locally for ongoing task continuity and cleared when extension storage is removed.

### Limited Use

- Block Bot uses accessed user data only to provide the user-facing spam-account detection and user-confirmed local blocking feature.
- Block Bot does not sell user data, does not use user data for advertising, and does not transfer user data to data brokers.

### User Control

Users control whether to:

- Start an analysis
- Choose a model provider
- Provide an API key
- Confirm which accounts should be blocked

Users can remove the extension at any time and can clear stored extension data through Chrome's extension management tools.

## 本地开发

1. 打开 Chrome 的扩展程序页面。
2. 启用开发者模式。
3. 选择“加载已解压的扩展程序”，加载本目录。
4. 打开 X 页面后，从弹窗启动分析。

## 打包产物

仓库中的 `dist/` 目录提供已打包的扩展文件：

- `block-bot-chrome-extension-v0.1.0.zip`: 推荐给普通用户手动安装。先解压，再通过 Chrome 扩展程序页面加载解压后的目录。
- `block-bot-chrome-extension-v0.1.0.crx`: 已打包的 Chrome 扩展安装文件，适合本地测试分发。

说明：

- 普通稳定版 Chrome 对手动安装 `.crx` 的限制较多。如果只是自己安装使用，请优先使用 zip 解压后的目录。
- 如果需要保持扩展 ID 不变，后续重新打包时必须继续使用同一把私钥；私钥文件不应提交到仓库。
