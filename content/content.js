/* Block Bot – content script
 * Runs only on https://x.com/*
 * Handles: tweet scraping.
 */
(() => {
  'use strict';

  const DEFAULT_SCRAPE_SCROLL_WAIT_MS = 1200;
  const DEFAULT_SCRAPE_MAX_ROUNDS = 120;
  const DEFAULT_SCRAPE_STAGNANT_ROUNDS = 4;
  const DEFAULT_SCRAPE_MAX_TWEETS = 1000;

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function normalizeInt(raw, min, max, fallback) {
    const v = Number(raw);
    if (!Number.isFinite(v)) return fallback;
    const n = Math.round(v);
    if (n < min) return min;
    if (n > max) return max;
    return n;
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
    // 改善1: 过滤广告推文（Promoted Tweets），避免误判广告主账号
    if (article.querySelector('[data-testid="placementTracking"]')) return null;

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
      // #4 fix: 使用 innerText 正确提取含 emoji 图片子节点的显示名
      const t = (s.innerText || s.textContent).trim();
      if (t && !t.startsWith('@')) {
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

  // 禁用用户交互，防止采集过程中的手动操作干扰虚拟滚动
  // 但允许页面内容异步加载（无限滚动继续工作）
  function disableScraping() {
    // 添加半透明 overlay + 禁用 pointer-events，阻止用户点击但允许内容加载
    let overlay = document.getElementById('block-bot-scraping-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'block-bot-scraping-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.3);
        z-index: 999999;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      const tip = document.createElement('div');
      tip.style.cssText = `
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 20px 30px;
        border-radius: 8px;
        font-size: 14px;
        text-align: center;
        pointer-events: none;
      `;
      tip.textContent = '正在采集推文，请勿操作…';
      overlay.appendChild(tip);
      document.body.appendChild(overlay);
    } else {
      overlay.style.display = 'flex';
    }
    
    // 阻止用户点击、键盘输入等交互，但允许滚动和内容加载
    const preventInteraction = (e) => {
      if (e.type !== 'scroll' && e.type !== 'wheel') {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    
    ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'input', 'change'].forEach(evt => {
      document.addEventListener(evt, preventInteraction, { capture: true });
    });
    
    // 返回恢复函数
    return () => {
      ['click', 'mousedown', 'mouseup', 'keydown', 'keyup', 'keypress', 'input', 'change'].forEach(evt => {
        document.removeEventListener(evt, preventInteraction, { capture: true });
      });
      const o = document.getElementById('block-bot-scraping-overlay');
      if (o) o.style.display = 'none';
    };
  }

  async function collectTweetsWithAutoScroll(threadAuthorHandle, scrapeConfig = {}) {
    const restore = disableScraping();
    try {
      const maxTweets = normalizeInt(scrapeConfig.maxTweets, 20, 5000, DEFAULT_SCRAPE_MAX_TWEETS);
      const configuredMaxRounds = normalizeInt(scrapeConfig.maxRounds, 6, 300, DEFAULT_SCRAPE_MAX_ROUNDS);
      const targetBasedRounds = Math.ceil(maxTweets / 6);
      const maxRounds = Math.min(300, Math.max(configuredMaxRounds, targetBasedRounds));
      const waitMs = normalizeInt(scrapeConfig.scrollWaitMs, 600, 2500, DEFAULT_SCRAPE_SCROLL_WAIT_MS);
      const stagnantLimit = normalizeInt(scrapeConfig.stagnantRounds, 2, 8, DEFAULT_SCRAPE_STAGNANT_ROUNDS);
      const confirmWaitMs = Math.min(2800, waitMs + 250);

      const merged = new Map();
      let stagnantRounds = 0;
      let lastSize = 0;
      let lastHeight = 0;

      for (let i = 0; i < maxRounds; i++) {
        const visible = collectVisibleTweets(threadAuthorHandle);
        mergeTweetsIntoMap(merged, visible);
        if (merged.size >= maxTweets) break;

        const currentSize = merged.size;
        const currentHeight = document.body.scrollHeight;
        // 只按内容数量判断停滞，不依赖页面高度：
        // X 的虚拟滚动会在底部添加新推文的同时删除顶部旧推文，
        // 导致 scrollHeight 几乎不变，用高度检测会过早停止。
        if (currentSize <= lastSize) {
          stagnantRounds += 1;
        } else {
          stagnantRounds = 0;
        }
        lastSize = currentSize;
        lastHeight = currentHeight;

        // 需要连续 4 轮无变化才停止，避免网络延迟导致误判停滞
        if (stagnantRounds >= stagnantLimit) {
          // 额外等待一次再确认，防止网络慢时漏采
          await sleep(confirmWaitMs);
          const afterWait = collectVisibleTweets(threadAuthorHandle);
          mergeTweetsIntoMap(merged, afterWait);
          if (merged.size >= maxTweets) break;
          if (merged.size <= lastSize && document.body.scrollHeight <= lastHeight + 10) {
            break;
          }
          // 有新推文，重置停滞计数继续滚动
          stagnantRounds = 0;
          lastSize = merged.size;
          lastHeight = document.body.scrollHeight;
        }

        window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 800), behavior: 'auto' });
        // 增量采集场景下可以稍快一些，停滞时会自动回到完整等待。
        const waitNextMs = stagnantRounds > 0 ? waitMs : Math.max(600, Math.round(waitMs * 0.82));
        await sleep(waitNextMs);
      }

      // 最终再滚动一次并等待，确保末尾推文不遗漏
      window.scrollBy({ top: Math.max(window.innerHeight * 1.2, 1000), behavior: 'auto' });
      await sleep(confirmWaitMs);
      mergeTweetsIntoMap(merged, collectVisibleTweets(threadAuthorHandle));
      return Array.from(merged.values()).slice(0, maxTweets).map(({ uniqueId, ...tweet }) => tweet);
    } finally {
      restore();
    }
  }

  // ── Tweet scraping ───────────────────────────────────────────────────────────
  async function scrapeTweets(scrapeConfig = {}) {
    const threadAuthorHandle = getThreadAuthorHandleFromUrl();
    // 所有页面都启用自动滚动采集，而不只是帖子详情页
    // 这样在主页、博主主页、搜索结果页都能一次采集完毕
    return collectTweetsWithAutoScroll(threadAuthorHandle, scrapeConfig);
  }

  // ── Message listener ─────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.action) {

      case 'scrapeTweets': {
        scrapeTweets(msg.scrapeConfig || {})
          .then(tweets => sendResponse({ ok: true, tweets }))
          .catch(e => sendResponse({ ok: false, error: e.message }));
        return true;
      }

      default:
        return false;
    }
  });
})();
