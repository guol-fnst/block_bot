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

If the user enables analysis, the extension sends candidate post data directly to the model service configured by the user. Depending on the user's settings, this may include:

- Google Gemini
- DeepSeek
- Qwen
- Another OpenAI-compatible API endpoint chosen by the user

Those third-party services process data under their own terms and privacy policies. Users are responsible for choosing whether to use a given provider.

## Data Storage

Block Bot stores the following data locally in Chrome extension storage:

- Model provider selection
- API endpoint configuration
- API keys entered by the user
- Temporary analysis results
- Block queue state

Block Bot does not intentionally transmit this locally stored configuration to a Block Bot-operated server.

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

Before publishing, replace this section with a real contact email or support page for the publisher of Block Bot.
