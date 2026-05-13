# Privacy Policy for Block Bot

Last updated: 2026-05-11

## Overview

Block Bot is a Chrome extension that helps users review visible posts on `x.com` / `twitter.com`, identify likely spam or bot accounts with a user-configured model service, and then locally execute block actions after user confirmation.

Block Bot does not operate a proprietary backend service in the current version. Data is processed inside the user's browser and, when analysis is requested, sent directly to the model service configured by the user.

## Data We Access

When the user starts an analysis on an X page, Block Bot may access:

- Visible post text from the current page
- Account handles
- Display names
- Post URLs
- Profile URLs

When the user executes block actions, Block Bot may also access the current logged-in X session context that is already available in the browser in order to complete the user-requested block action locally.

## How We Use Data

Block Bot uses the accessed data only for the following purposes:

- To analyze visible posts and detect likely spam or bot accounts
- To present candidate accounts to the user for review
- To execute user-confirmed local block actions on X
- To save local extension settings, queue state, and temporary analysis cache in Chrome storage

## Data Sharing

Block Bot does not send analyzed content to a Block Bot backend.

If the user enables analysis, the extension sends candidate post data directly to the model service configured by the user. Depending on the user's settings, this may include Google Gemini, OpenAI, Anthropic, DeepSeek, Qwen, xAI, OpenRouter, Groq, Mistral AI, Together AI, SiliconFlow, Moonshot, Zhipu GLM, Volcengine Ark/Doubao, or another user-configured OpenAI-compatible endpoint.

Those third-party services process data under their own terms and privacy policies. Users are responsible for choosing whether to use a given provider.

## Data Storage

Block Bot stores the following data locally in Chrome extension storage:

- Model provider selection
- API endpoint configuration
- API keys entered by the user
- Temporary analysis results
- Block queue state

Block Bot does not intentionally transmit this locally stored configuration to a Block Bot-operated server.

Data retention defaults:

- Analysis cache: temporary, can be cleared by the user at any time, and may be overwritten by later analyses.
- Provider configuration (including API endpoint and API key): kept locally until user edits settings or removes the extension.
- Queue state and operation log: kept locally for ongoing task continuity and cleared when extension storage is removed.

Data transmission security:

- Candidate post/account data sent to third-party model services is transmitted over HTTPS.

Limited Use statement:

- Block Bot uses accessed user data only to provide the user-facing spam-account detection and user-confirmed local blocking feature.
- Block Bot does not sell user data, does not use user data for advertising, and does not transfer user data to data brokers.

## User Control

Users control whether to:

- Start an analysis
- Choose a model provider
- Provide an API key
- Confirm which accounts should be blocked

Users can remove the extension at any time and can clear stored extension data through Chrome's extension management tools.

## Background Tab Behavior

To complete some user-confirmed block actions reliably, Block Bot may temporarily open or reuse a background X page in the browser and perform the local block action there. This behavior is part of the extension's core functionality.

## Contact

For privacy or support requests, contact: support@blockbot-extension.com
