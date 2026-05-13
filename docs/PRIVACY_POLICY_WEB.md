# Block Bot Privacy Policy (Web Version)

Last updated: 2026-05-11

This Privacy Policy describes how Block Bot handles information.

## 1. Who We Are

Block Bot is a browser extension designed to help users review visible posts on x.com / twitter.com and identify likely spam or bot accounts before user-confirmed local block actions.

Contact: support@blockbot-extension.com

## 2. Data We Access

When the user starts analysis on an X page, Block Bot may access:
- Visible post text from the current page
- Account handles
- Display names
- Post URLs
- Profile URLs

When the user confirms block actions, Block Bot may use the existing logged-in X session context in the browser to complete those actions locally.

## 3. How We Use Data

We use accessed data only to:
- Analyze visible posts and identify likely spam/bot accounts
- Present candidates for user review
- Execute user-confirmed local block actions on X
- Store local extension settings, queue state, and temporary analysis cache

## 4. Data Sharing and Third Parties

Block Bot does not operate a proprietary analysis backend in the current version.

If the user enables analysis, candidate data is sent directly from the browser to the user-configured third-party model provider, such as Google Gemini, OpenAI, Anthropic, DeepSeek, Qwen, xAI, OpenRouter, Groq, Mistral AI, Together AI, SiliconFlow, Moonshot, Zhipu GLM, Volcengine Ark/Doubao, or another user-configured OpenAI-compatible endpoint. These providers process data under their own terms and privacy policies.

## 5. Data Storage

Block Bot stores data locally in Chrome extension storage, including:
- Model provider selection
- API endpoint configuration
- API key entered by the user
- Temporary analysis results
- Block queue state

Retention defaults:
- Analysis cache is temporary and can be cleared by the user
- Provider configuration remains until edited by the user or extension removal
- Queue state remains for task continuity and is removed when extension storage is removed

## 6. Data Security

- Data sent to third-party model services is transmitted over HTTPS.
- Block Bot does not intentionally send locally stored settings to a Block Bot-operated server.

## 7. Limited Use Commitments

- We do not sell user data.
- We do not use user data for advertising.
- We do not transfer user data to data brokers.
- We use data only for the user-facing functionality described above.

## 8. User Control

Users can control whether to:
- Start an analysis
- Choose a model provider
- Provide an API key
- Confirm which accounts should be blocked

Users can remove the extension at any time and clear extension data through Chrome extension management.

## 9. Background Tab Behavior

To complete some user-confirmed block actions reliably, Block Bot may temporarily open or reuse a background X page in the browser and perform those local actions there.

## 10. Changes to This Policy

We may update this Privacy Policy from time to time. The latest update date is shown at the top of this page.
