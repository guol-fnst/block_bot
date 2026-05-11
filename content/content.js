/* Block Bot – content script
 * Runs only on https://x.com/*
 * Handles: tweet scraping.
 */
(() => {
  'use strict';

  // ── Tweet scraping ───────────────────────────────────────────────────────────
  function scrapeTweets() {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const results = [];
    const seen = new Set();

    articles.forEach(article => {
      try {
        const userNameBlock = article.querySelector('[data-testid="User-Name"]');
        if (!userNameBlock) return;

        // First anchor in User-Name → profile link with handle in href
        const profileA = userNameBlock.querySelector('a[href^="/"]');
        if (!profileA) return;

        const rawPath = profileA.getAttribute('href') || '';
        const handleSlug = rawPath.replace(/^\//, '').split('/')[0].split('?')[0];
        if (!handleSlug) return;
        const handle = '@' + handleSlug;

        // Display name: deepest text-only span inside User-Name, not containing @
        let displayName = '';
        const spans = userNameBlock.querySelectorAll('span');
        for (const s of spans) {
          const t = s.textContent.trim();
          if (t && !t.startsWith('@') && s.children.length === 0) {
            displayName = t;
            break;
          }
        }

        // Tweet text
        const textEl = article.querySelector('[data-testid="tweetText"]');
        const text = textEl ? textEl.innerText.trim() : '';

        // Tweet URL from the timestamp anchor
        const timeEl = article.querySelector('time');
        const statusA = timeEl ? timeEl.closest('a') : null;
        const statusPath = statusA ? statusA.getAttribute('href') || '' : '';
        const tweetUrl = statusPath ? `https://x.com${statusPath}` : '';
        const tweetIdMatch = statusPath.match(/\/status\/(\d+)/);
        const tweetId = tweetIdMatch ? tweetIdMatch[1] : '';

        if (tweetId && seen.has(tweetId)) return;
        if (tweetId) seen.add(tweetId);

        results.push({
          tweetId,
          tweetUrl,
          displayName,
          handle,
          text,
          profileUrl: `https://x.com/${handleSlug}`
        });
      } catch (_) {
        // skip malformed tweet nodes
      }
    });

    return results;
  }

  // ── Message listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {

      case 'scrapeTweets': {
        try {
          const tweets = scrapeTweets();
          sendResponse({ ok: true, tweets });
        } catch (e) {
          sendResponse({ ok: false, error: e.message });
        }
        return false;
      }

      default:
        return false;
    }
  });
})();
