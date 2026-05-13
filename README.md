# Block Bot - AI Spam & Bot Blocker for X / Twitter

Block Bot 是一个面向 `x.com` / `twitter.com` 的 Chrome 扩展，用来扫描当前页面已显示的推文，借助用户自己配置的 AI 模型识别疑似垃圾账号、营销号、水军号、机器人账号和骚扰账号，并在用户确认后把这些账号加入本地屏蔽队列。

Block Bot is a Chrome extension for X / Twitter. It scans visible posts on the current page, uses the AI model provider configured by the user to detect likely spam accounts, bot accounts, scam accounts, engagement-farming accounts, and abusive accounts, then performs local blocking only after the user confirms the candidates.

## Keywords / 搜索关键词

Block Bot, X bot blocker, Twitter bot blocker, X spam blocker, Twitter spam blocker, AI bot detection, AI spam detection, Chrome extension for X, Chrome extension for Twitter, block spam accounts on X, block bots on Twitter, X anti spam, Twitter anti spam, social media moderation, spam account detector, bot account detector.

X 垃圾账号屏蔽, Twitter 垃圾账号屏蔽, X 机器人账号屏蔽, 推特机器人账号屏蔽, 推特垃圾粉丝屏蔽, 推特水军识别, X 水军识别, AI 识别垃圾账号, AI 识别机器人账号, Chrome 推特扩展, X 反垃圾扩展, Twitter 反垃圾扩展, 批量屏蔽垃圾账号, 屏蔽营销号, 屏蔽骚扰账号。

## Why Block Bot / 为什么需要它

X / Twitter 上的垃圾回复、诈骗账号、机器人账号、刷互动账号和低质量营销账号会持续污染时间线、搜索结果和评论区。Block Bot 的目标不是替你自动做决定，而是把当前页面中可疑账号整理出来，让你快速复核，并把确认后的账号按限速策略在本地执行屏蔽。

If your X / Twitter timeline, search results, or reply sections are filled with spam replies, scam accounts, bot accounts, and engagement farming, Block Bot helps you review visible accounts faster. It highlights likely suspicious accounts, keeps the final decision under your control, and blocks selected accounts locally with rate limits.

## Core Features / 核心功能

- AI-powered analysis for visible posts on `x.com` and `twitter.com`.
- Detects likely spam accounts, bot accounts, scam accounts, engagement farming, and suspicious repeated behavior.
- Review-before-block workflow: no account is blocked until the user confirms it.
- Local blocking through the current browser session, without a Block Bot backend.
- Rate-limited block queue with progress display, pause, and resume controls.
- Local settings and cache stored in Chrome extension storage.
- Supports many AI providers and custom OpenAI-compatible endpoints.

中文功能概览：

- 扫描 `x.com` / `twitter.com` 当前页面已经显示的推文。
- 使用 AI 分析疑似垃圾账号、机器人账号、诈骗账号、刷互动账号、水军号和低质量营销号。
- 先展示候选账号，再由用户确认是否加入屏蔽队列。
- 屏蔽动作在本地浏览器内执行，不经过 Block Bot 自有服务器。
- 内置限速屏蔽队列，支持查看进度、暂停和继续。
- 配置、缓存和任务状态保存在 Chrome 本地扩展存储中。
- 支持多个模型服务，也支持自定义 OpenAI 兼容接口。

## Supported AI Providers / 支持的模型服务

Block Bot can call the model service selected by the user from the browser extension background service worker. Built-in presets include:

- Google Gemini
- OpenAI
- Anthropic Claude
- DeepSeek
- Qwen / 阿里云 DashScope
- xAI
- OpenRouter
- Groq
- Mistral AI
- Together AI
- SiliconFlow / 硅基流动
- Moonshot / 月之暗面
- Zhipu GLM / 智谱 GLM
- Volcengine Ark / Doubao / 火山方舟豆包
- Custom OpenAI-compatible `chat/completions` endpoint

除 Gemini 与 Anthropic 原生接口外，其余预设均按 OpenAI 兼容格式调用。你需要在扩展设置页中选择模型服务并填写自己的 API Key。

## Install Manually / 手动安装

推荐使用 `dist/block-bot-chrome-extension-v0.1.1.zip` 手动安装：

1. 下载或找到仓库里的 `dist/block-bot-chrome-extension-v0.1.1.zip`。
2. 解压这个 zip 文件，得到一个扩展目录。
3. 打开 Chrome，在地址栏输入 `chrome://extensions/`。
4. 打开右上角的“开发者模式”。
5. 点击“加载已解压的扩展程序”。
6. 选择第 2 步解压出来的扩展目录。
7. 打开 `x.com` 或 `twitter.com` 页面，点击浏览器工具栏里的 Block Bot 图标开始使用。

English:

1. Download `dist/block-bot-chrome-extension-v0.1.1.zip`.
2. Unzip the archive into a folder.
3. Open Chrome and go to `chrome://extensions/`.
4. Enable Developer mode.
5. Click "Load unpacked".
6. Select the unzipped extension folder.
7. Open `x.com` or `twitter.com`, then click the Block Bot icon in the browser toolbar.

注意：不要直接选择 zip 文件。Chrome 的“加载已解压的扩展程序”需要选择解压后的文件夹。

If the extension icon is not visible, click the puzzle icon in the Chrome toolbar, find Block Bot, and pin it. Before the first analysis, open the extension options page and configure your model provider and API key.

## How It Works / 工作方式

Block Bot only runs on `x.com` and `twitter.com`. When the user starts an analysis, it reads visible post text, account handles, display names, post URLs, and profile URLs from the current page. The extension then sends candidate data directly to the model provider selected by the user.

Block Bot does not run a proprietary backend service in the current version. The analyzed content is not sent to Block Bot servers. If the user confirms block actions, the extension uses the current logged-in X session in the local browser to perform rate-limited blocking. If the current page cannot complete a specific block action, the extension may temporarily open a background X tab to finish that user-confirmed task.

中文说明：扩展只在 `x.com` 与 `twitter.com` 页面运行。它会读取当前页面已经渲染出来的推文内容、账号 handle、显示名称、推文链接和资料页链接，然后把候选数据发送到用户在设置页中选择的模型服务进行分类分析。屏蔽动作不会通过 Block Bot 自己的服务器执行。

## Privacy / 隐私说明

Block Bot is designed to keep the user in control:

- No Block Bot backend is used in the current version.
- Visible post data is sent only to the AI provider configured by the user when analysis is started.
- API keys are stored locally in Chrome extension storage.
- Blocking is performed locally through the user's logged-in X session.
- The extension does not sell user data, does not use user data for advertising, and does not transfer user data to data brokers.

完整隐私政策见 [PRIVACY_POLICY.md](./PRIVACY_POLICY.md)。用于网页发布的版本见 [docs/PRIVACY_POLICY_WEB.md](./docs/PRIVACY_POLICY_WEB.md)。

## Permissions / 权限说明

- `storage`: Saves model provider settings, API keys, analysis cache, consent state, and block queue state locally.
- `tabs`: Reads the active tab URL and may create a background X tab when needed to complete a confirmed block action.
- `scripting`: Injects scripts into authorized X / Twitter pages to read visible content and perform local user-confirmed automation.
- `host_permissions` for `x.com` / `twitter.com`: Limits content-script behavior to supported X / Twitter pages.
- `host_permissions` for model API hosts: Allows the extension background service worker to call the user-configured third-party model API directly.
- `optional_host_permissions`: Allows advanced users to configure custom OpenAI-compatible endpoints when needed.

## Local Development / 本地开发

1. 打开 Chrome 的扩展程序页面。
2. 启用开发者模式。
3. 选择“加载已解压的扩展程序”，加载本目录。
4. 打开 X 页面后，从弹窗启动分析。

## Release Artifacts / 打包产物

仓库中的 `dist/` 目录提供已打包的扩展文件：

- `block-bot-chrome-extension-v0.1.1.zip`: 推荐给普通用户手动安装。先解压，再通过 Chrome 扩展程序页面加载解压后的目录。
- `block-bot-chrome-extension-v0.1.1.crx`: 已打包的 Chrome 扩展安装文件，适合本地测试分发。

说明：

- 普通稳定版 Chrome 对手动安装 `.crx` 的限制较多。如果只是自己安装使用，请优先使用 zip 解压后的目录。
- 如果需要保持扩展 ID 不变，后续重新打包时必须继续使用同一把私钥；私钥文件不应提交到仓库。

## FAQ / 常见问题

### Does Block Bot automatically block accounts?

No. Block Bot shows candidate accounts first. The user must confirm which accounts should be added to the block queue.

### Block Bot 会自动屏蔽账号吗？

不会。Block Bot 会先展示疑似账号列表，用户确认后才会加入屏蔽任务。

### Does Block Bot work outside X / Twitter?

No. The extension is scoped to `x.com` and `twitter.com`.

### Block Bot 会把数据上传到自己的服务器吗？

当前版本没有 Block Bot 自有后端。发起分析时，候选推文数据会直接发送给你在设置页中选择的模型服务。

### Which users should search for this extension?

People looking for an X spam blocker, Twitter bot blocker, AI spam detector, X anti-spam Chrome extension, Twitter moderation helper, or a tool to review and block suspicious accounts on X / Twitter.

### 哪些人适合使用这个扩展？

如果你正在寻找 X 垃圾账号屏蔽工具、Twitter 机器人账号屏蔽工具、AI 识别水军号、推特反垃圾扩展、X 评论区清理工具，或者想更快处理诈骗号、营销号和骚扰账号，Block Bot 就是为这个场景设计的。
