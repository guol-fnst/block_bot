/* Block Bot – content script
 * Runs only on https://x.com/*
 * Handles: tweet scraping.
 */
(() => {
  'use strict';

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function getThreadAuthorHandleFromUrl() {
    const m = window.location.pathname.match(/^\/([^/]+)\/status\/\d+/i);
    if (!m || !m[1]) return '';
    return `@${decodeURIComponent(m[1]).toLowerCase()}`;
  }

  function isLikelyHandleSlug(slug) {
    if (!slug) return false;
    const reserved = new Set([
      'home',
      'explore',
      'notifications',
      'messages',
      'search',
      'compose',
      'settings',
      'i',
      'tos',
      'privacy',
      'hashtag'
    ]);
    return !reserved.has(slug.toLowerCase());
  }

  function parseTweetFromArticle(article, threadAuthorHandle) {
    const userNameBlock = article.querySelector('[data-testid="User-Name"]');
    if (!userNameBlock) return null;

    const profileAnchors = userNameBlock.querySelectorAll('a[href^="/"]');
    let handleSlug = '';
    for (const a of profileAnchors) {
      const rawPath = a.getAttribute('href') || '';
      const slug = rawPath.replace(/^\//, '').split('/')[0].split('?')[0];
      if (isLikelyHandleSlug(slug)) {
        handleSlug = slug;
        break;
      }
    }
    if (!handleSlug) return null;

    const handle = `@${handleSlug}`;
    if (threadAuthorHandle && handle.toLowerCase() === threadAuthorHandle) return null;

    let displayName = '';
    const spans = userNameBlock.querySelectorAll('span');
    for (const s of spans) {
      const t = s.textContent.trim();
      if (t && !t.startsWith('@') && s.children.length === 0) {
        displayName = t;
        break;
      }
    }

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText.trim() : '';

    const timeEl = article.querySelector('time');
    const statusA = timeEl ? timeEl.closest('a') : null;
    const statusPath = statusA ? statusA.getAttribute('href') || '' : '';
    const tweetUrl = statusPath ? `https://x.com${statusPath}` : '';
    const tweetIdMatch = statusPath.match(/\/status\/(\d+)/);
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : '';

    const fallbackId = `${handle.toLowerCase()}|${text.slice(0, 180).toLowerCase()}`;
    const uniqueId = tweetId || fallbackId;

    return {
      uniqueId,
      tweetId,
      tweetUrl,
      displayName,
      handle,
      text,
      profileUrl: `https://x.com/${handleSlug}`
    };
  }

  function collectVisibleTweets(threadAuthorHandle) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const map = new Map();

    articles.forEach(article => {
      try {
        const parsed = parseTweetFromArticle(article, threadAuthorHandle);
        if (!parsed) return;
        if (!map.has(parsed.uniqueId)) {
          map.set(parsed.uniqueId, parsed);
        }
      } catch (_) {
        // skip malformed tweet nodes
      }
    });

    return Array.from(map.values());
  }

  function mergeTweetsIntoMap(targetMap, tweets) {
    tweets.forEach(t => {
      if (!targetMap.has(t.uniqueId)) {
        targetMap.set(t.uniqueId, t);
      }
    });
  }

  async function collectTweetsWithAutoScroll(threadAuthorHandle, maxRounds = 10) {
    const merged = new Map();
    let stagnantRounds = 0;
    let lastSize = 0;
    let lastHeight = 0;

    for (let i = 0; i < maxRounds; i++) {
      const visible = collectVisibleTweets(threadAuthorHandle);
      mergeTweetsIntoMap(merged, visible);

      const currentSize = merged.size;
      const currentHeight = document.body.scrollHeight;
      if (currentSize <= lastSize && currentHeight <= lastHeight + 2) {
        stagnantRounds += 1;
      } else {
        stagnantRounds = 0;
      }
      lastSize = currentSize;
      lastHeight = currentHeight;

      if (stagnantRounds >= 3) break;

      window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 650), behavior: 'auto' });
      await sleep(900);
    }

    mergeTweetsIntoMap(merged, collectVisibleTweets(threadAuthorHandle));
    return Array.from(merged.values()).map(({ uniqueId, ...tweet }) => tweet);
  }

  // ── Tweet scraping ───────────────────────────────────────────────────────────
  async function scrapeTweets() {
    const threadAuthorHandle = getThreadAuthorHandleFromUrl();
    if (/\/status\/\d+/i.test(window.location.pathname)) {
      return collectTweetsWithAutoScroll(threadAuthorHandle, 12);
    }
    return collectVisibleTweets(threadAuthorHandle).map(({ uniqueId, ...tweet }) => tweet);
  }

  // ── Message listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {

      case 'scrapeTweets': {
        scrapeTweets()
          .then(tweets => sendResponse({ ok: true, tweets }))
          .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
      }

      default:
        return false;
    }
  });
})();
