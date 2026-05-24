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

  function getThreadContextFromUrl() {
    const m = window.location.pathname.match(/^\/([^/]+)\/status\/(\d+)/i);
    if (!m || !m[1] || !m[2]) return null;
    return {
      authorHandle: `@${decodeURIComponent(m[1]).toLowerCase()}`,
      statusId: m[2]
    };
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

  function extractStatusPathFromArticle(article) {
    const timeEl = article.querySelector('time');
    const statusA = timeEl ? timeEl.closest('a') : null;
    const directPath = statusA ? statusA.getAttribute('href') || '' : '';
    if (/\/status\/\d+/i.test(directPath)) {
      return directPath;
    }

    const anyStatusAnchor = article.querySelector('a[href*="/status/"]');
    const fallbackPath = anyStatusAnchor ? anyStatusAnchor.getAttribute('href') || '' : '';
    return /\/status\/\d+/i.test(fallbackPath) ? fallbackPath : '';
  }

  function isDefaultProfileImageSrc(src) {
    return /default_profile|default_profile_images|profile_images\/default/i.test(String(src || ''));
  }

  function parseTweetFromArticle(article, threadContext) {
    // 改善1: 过滤广告推文（Promoted Tweets），避免误判广告主账号
    if (article.querySelector('[data-testid="placementTracking"]')) return null;

    const userNameBlock = article.querySelector('[data-testid="User-Name"]');
    const statusPath = extractStatusPathFromArticle(article);

    const profileAnchors = userNameBlock
      ? userNameBlock.querySelectorAll('a[href^="/"]')
      : [];
    let handleSlug = '';
    for (const a of profileAnchors) {
      const rawPath = a.getAttribute('href') || '';
      const slug = rawPath.replace(/^\//, '').split('/')[0].split('?')[0];
      if (isLikelyHandleSlug(slug)) {
        handleSlug = slug;
        break;
      }
    }

    // Handle X DOM changes where the handle anchor is temporarily absent.
    if (!handleSlug && statusPath) {
      const m = statusPath.match(/^\/([^/]+)\/status\/\d+/i);
      const slug = m && m[1] ? decodeURIComponent(m[1]) : '';
      if (isLikelyHandleSlug(slug)) {
        handleSlug = slug;
      }
    }

    if (!handleSlug) return null;

    const handle = `@${handleSlug}`;

    let displayName = '';
    if (userNameBlock) {
      const spans = userNameBlock.querySelectorAll('span');
      for (const s of spans) {
        // #4 fix: 使用 innerText 正确提取含 emoji 图片子节点的显示名
        const t = (s.innerText || s.textContent).trim();
        if (t && !t.startsWith('@')) {
          displayName = t;
          break;
        }
      }
    }

    const textEl = article.querySelector('[data-testid="tweetText"]');
    const text = textEl ? textEl.innerText.trim() : '';

    const tweetUrl = statusPath ? `https://x.com${statusPath}` : '';
    const tweetIdMatch = statusPath.match(/\/status\/(\d+)/);
    const tweetId = tweetIdMatch ? tweetIdMatch[1] : '';
    if (
      threadContext &&
      tweetId &&
      handle.toLowerCase() === threadContext.authorHandle &&
      tweetId === threadContext.statusId
    ) {
      return null;
    }
    const avatarImg = article.querySelector('[data-testid="Tweet-User-Avatar"] img, [data-testid*="UserAvatar"] img');
    const avatarSrc = avatarImg ? avatarImg.getAttribute('src') || '' : '';

    const fallbackId = `${handle.toLowerCase()}|${text.slice(0, 180).toLowerCase()}`;
    const uniqueId = tweetId || fallbackId;

    return {
      uniqueId,
      tweetId,
      tweetUrl,
      displayName,
      handle,
      text,
      defaultProfileImage: isDefaultProfileImageSrc(avatarSrc),
      profileUrl: `https://x.com/${handleSlug}`
    };
  }

  function collectVisibleTweets(threadContext) {
    const articles = document.querySelectorAll('article[data-testid="tweet"]');
    const map = new Map();

    articles.forEach(article => {
      try {
        const parsed = parseTweetFromArticle(article, threadContext);
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

  function isScrollableElement(el) {
    if (!el || el === document.body) return false;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    const overflowY = style.overflowY || '';
    const canScroll = overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
    return canScroll && (el.scrollHeight - el.clientHeight) > 80;
  }

  function getPreferredScrollRoot() {
    const tweetArticle = document.querySelector('article[data-testid="tweet"]');
    let node = tweetArticle;
    while (node && node !== document.body) {
      if (isScrollableElement(node)) return node;
      node = node.parentElement;
    }

    const primaryColumn = document.querySelector('[data-testid="primaryColumn"]');
    node = primaryColumn;
    while (node && node !== document.body) {
      if (isScrollableElement(node)) return node;
      node = node.parentElement;
    }

    return document.scrollingElement || document.documentElement || document.body;
  }

  function getScrollTop(root) {
    if (!root || root === document.documentElement || root === document.body || root === document.scrollingElement) {
      return Math.max(
        window.scrollY || 0,
        document.documentElement?.scrollTop || 0,
        document.body?.scrollTop || 0
      );
    }
    return root.scrollTop || 0;
  }

  function getScrollMetrics(root) {
    if (!root || root === document.documentElement || root === document.body || root === document.scrollingElement) {
      const top = Math.max(
        window.scrollY || 0,
        document.documentElement?.scrollTop || 0,
        document.body?.scrollTop || 0
      );
      const clientHeight = window.innerHeight || document.documentElement?.clientHeight || document.body?.clientHeight || 0;
      const scrollHeight = Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0
      );
      return {
        top,
        clientHeight,
        scrollHeight,
        maxTop: Math.max(0, scrollHeight - clientHeight)
      };
    }

    const top = root.scrollTop || 0;
    const clientHeight = root.clientHeight || 0;
    const scrollHeight = root.scrollHeight || 0;
    return {
      top,
      clientHeight,
      scrollHeight,
      maxTop: Math.max(0, scrollHeight - clientHeight)
    };
  }

  function scrollRootTo(root, top) {
    if (!root || root === document.documentElement || root === document.body || root === document.scrollingElement) {
      window.scrollTo({ top, behavior: 'auto' });
      return;
    }
    root.scrollTo({ top, behavior: 'auto' });
  }

  function scrollRootBy(root, top) {
    if (!root || root === document.documentElement || root === document.body || root === document.scrollingElement) {
      window.scrollBy({ top, behavior: 'auto' });
      return;
    }
    root.scrollBy({ top, behavior: 'auto' });
  }

  async function scrollToPageTop(waitMs) {
    const settleMs = Math.max(250, Math.min(1200, Math.round(waitMs * 0.75)));
    let stableRounds = 0;
    let lastY = -1;

    for (let i = 0; i < 8; i++) {
      const root = getPreferredScrollRoot();
      scrollRootTo(root, 0);
      await sleep(settleMs);

      const currentY = getScrollTop(root);
      if (currentY <= 2) {
        stableRounds += 1;
        if (stableRounds >= 2) break;
      } else if (currentY === lastY) {
        break;
      }
      lastY = currentY;
    }
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

  async function waitForInitialTweetNodes(timeoutMs = 9000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const count = document.querySelectorAll('article[data-testid="tweet"]').length;
      if (count > 0) return true;
      await sleep(220);
    }
    return false;
  }

  async function collectTweetsWithAutoScroll(threadContext, scrapeConfig = {}) {
    const restore = disableScraping();
    try {
      const maxTweets = normalizeInt(scrapeConfig.maxTweets, 20, 5000, DEFAULT_SCRAPE_MAX_TWEETS);
      const configuredMaxRounds = normalizeInt(scrapeConfig.maxRounds, 6, 300, DEFAULT_SCRAPE_MAX_ROUNDS);
      const targetBasedRounds = Math.ceil(maxTweets / 6);
      const maxRounds = Math.min(300, Math.max(configuredMaxRounds, targetBasedRounds));
      const waitMs = normalizeInt(scrapeConfig.scrollWaitMs, 600, 2500, DEFAULT_SCRAPE_SCROLL_WAIT_MS);
      const stagnantLimit = normalizeInt(scrapeConfig.stagnantRounds, 2, 8, DEFAULT_SCRAPE_STAGNANT_ROUNDS);
      const confirmWaitMs = Math.min(2800, waitMs + 250);

      await scrollToPageTop(waitMs);

      const merged = new Map();
      let stagnantRounds = 0;
      let lastSize = 0;
      let lastScrollTop = -1;

      for (let i = 0; i < maxRounds; i++) {
        const visible = collectVisibleTweets(threadContext);
        mergeTweetsIntoMap(merged, visible);
        if (merged.size >= maxTweets) break;

        const currentSize = merged.size;
        const root = getPreferredScrollRoot();
        const metrics = getScrollMetrics(root);
        const movedSinceLastRound = lastScrollTop < 0 ? true : (metrics.top - lastScrollTop) > 24;
        const nearBottom = metrics.top >= (metrics.maxTop - Math.max(80, Math.round(metrics.clientHeight * 0.12)));
        // 只按内容数量判断停滞，不依赖页面高度：
        // X 的虚拟滚动会在底部添加新推文的同时删除顶部旧推文，
        // 导致 scrollHeight 几乎不变，用高度检测会过早停止。
        if (currentSize <= lastSize && (!movedSinceLastRound || nearBottom)) {
          stagnantRounds += 1;
        } else {
          stagnantRounds = 0;
        }
        lastSize = currentSize;
        lastScrollTop = metrics.top;

        // 需要连续 4 轮无变化才停止，避免网络延迟导致误判停滞
        if (stagnantRounds >= stagnantLimit) {
          // 额外等待一次再确认，防止网络慢时漏采
          await sleep(confirmWaitMs);
          const afterWait = collectVisibleTweets(threadContext);
          mergeTweetsIntoMap(merged, afterWait);
          if (merged.size >= maxTweets) break;
          const confirmMetrics = getScrollMetrics(getPreferredScrollRoot());
          const stillNearBottom = confirmMetrics.top >= (confirmMetrics.maxTop - Math.max(80, Math.round(confirmMetrics.clientHeight * 0.12)));
          const hardlyMoved = Math.abs(confirmMetrics.top - lastScrollTop) <= 24;
          if (merged.size <= lastSize && (stillNearBottom || hardlyMoved)) {
            break;
          }
          // 有新推文，重置停滞计数继续滚动
          stagnantRounds = 0;
          lastSize = merged.size;
          lastScrollTop = confirmMetrics.top;
        }

        scrollRootBy(root, Math.max(window.innerHeight * 0.9, 800));
        // 增量采集场景下可以稍快一些，停滞时会自动回到完整等待。
        const waitNextMs = stagnantRounds > 0 ? waitMs : Math.max(600, Math.round(waitMs * 0.82));
        await sleep(waitNextMs);
      }

      // 最终再滚动一次并等待，确保末尾推文不遗漏
      scrollRootBy(getPreferredScrollRoot(), Math.max(window.innerHeight * 1.2, 1000));
      await sleep(confirmWaitMs);
      mergeTweetsIntoMap(merged, collectVisibleTweets(threadContext));
      return Array.from(merged.values()).slice(0, maxTweets).map(({ uniqueId, ...tweet }) => tweet);
    } finally {
      restore();
    }
  }

  // ── Tweet scraping ───────────────────────────────────────────────────────────
  async function scrapeTweets(scrapeConfig = {}) {
    const threadContext = getThreadContextFromUrl();
    const initialWaitMs = normalizeInt(scrapeConfig.initialWaitMs, 1500, 15000, 9000);
    await waitForInitialTweetNodes(initialWaitMs);
    // 所有页面都启用自动滚动采集，而不只是帖子详情页
    // 这样在主页、博主主页、搜索结果页都能一次采集完毕
    return collectTweetsWithAutoScroll(threadContext, scrapeConfig);
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
