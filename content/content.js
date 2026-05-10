/* Block Bot – content script
 * Runs only on https://x.com/*
 * Handles: tweet scraping, block-queue execution (so setTimeout is reliable),
 * and direct X API calls (credentials are injected automatically because we
 * are in the page origin context).
 */
(() => {
  'use strict';

  // ── X web-app bearer token (public, used by x.com itself) ──────────────────
  const BEARER =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I4xnZWgE%3D' +
    'EUifiRBkKG5E2XSoUoDSfLmsL2ELi8NKlVOMiALTiQqHjl3GWo';

  // ── Block-queue state (lives in content-script scope = stable) ──────────────
  let bqState = emptyQueueState();

  function emptyQueueState() {
    return {
      queue: [],
      running: false,
      paused: false,
      total: 0,
      done: 0,
      failed: 0,
      consecutiveFails: 0,
      current: null,
      log: [],
      errorMsg: ''
    };
  }

  // ── Utilities ────────────────────────────────────────────────────────────────
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  async function waitForElement(selector, timeoutMs = 5000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(120);
    }
    return null;
  }

  async function fetchWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}秒）`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  function sendRuntimeMessage(msg) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(msg, resp => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    });
  }

  function getCt0() {
    const m = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function xHeaders(ct0) {
    return {
      Authorization: `Bearer ${BEARER}`,
      'x-csrf-token': ct0,
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'zh-cn'
    };
  }

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

  // ── X API: get user ID from handle ──────────────────────────────────────────
  async function fetchUserId(handle) {
    const ct0 = getCt0();
    if (!ct0) throw new Error('未找到 ct0 cookie，请确认已登录 X');

    const screenName = handle.replace('@', '');
    const url =
      `https://x.com/i/api/1.1/users/show.json` +
      `?screen_name=${encodeURIComponent(screenName)}`;

    const resp = await fetchWithTimeout(
      url,
      {
        credentials: 'include',
        headers: xHeaders(ct0)
      },
      15000
    );

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      const err = new Error(`获取用户 ID 失败 (HTTP ${resp.status}): ${body.slice(0, 120)}`);
      if (resp.status === 401 && /"code"\s*:\s*89/.test(body)) {
        err.code = 'TOKEN_INVALID';
      }
      throw err;
    }

    const data = await resp.json();
    if (!data.id_str) throw new Error('API 未返回用户 ID');
    return data.id_str;
  }

  async function blockUserViaUi(handle) {
    const handleSlug = handle.replace('@', '').trim();
    if (!handleSlug) throw new Error('无效 handle，无法执行页面屏蔽');

    const userLink = document.querySelector(`article[data-testid="tweet"] a[href^="/${handleSlug}"]`);
    const article = userLink ? userLink.closest('article[data-testid="tweet"]') : null;
    if (!article) {
      const bgResp = await sendRuntimeMessage({ action: 'backgroundUiBlock', handle });
      if (bgResp?.ok) {
        return { success: true, handle, mode: 'ui-background' };
      }
      throw new Error(bgResp?.error || '当前页面未找到该账号推文，且后台屏蔽失败');
    }

    const moreBtn =
      article.querySelector('button[data-testid="caret"]') ||
      article.querySelector('button[aria-label="More"]') ||
      article.querySelector('button[aria-label="更多"]');

    if (!moreBtn) {
      throw new Error('未找到推文更多菜单按钮');
    }

    moreBtn.click();
    await sleep(250);

    const blockItem =
      (await waitForElement('[data-testid="block"]', 3500)) ||
      document.querySelector('[data-testid="placementTracking"] [role="menuitem"][aria-label*="Block"]') ||
      document.querySelector('[data-testid="placementTracking"] [role="menuitem"][aria-label*="屏蔽"]');

    if (!blockItem) {
      const maybeUnblock = document.querySelector('[data-testid="unblock"]');
      if (maybeUnblock) {
        // Already blocked – treat as success and close menu.
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return { success: true, handle, alreadyBlocked: true, mode: 'ui' };
      }
      throw new Error('未找到屏蔽菜单项，可能是页面结构变化');
    }

    blockItem.click();

    const confirmBtn = await waitForElement('[data-testid="confirmationSheetConfirm"]', 5000);
    if (!confirmBtn) {
      const bgResp = await sendRuntimeMessage({ action: 'backgroundUiBlock', handle });
      if (bgResp?.ok) {
        return { success: true, handle, mode: 'ui-background' };
      }
      throw new Error(bgResp?.error || '未找到屏蔽确认按钮，且后台屏蔽失败');
    }

    confirmBtn.click();
    await sleep(600);
    return { success: true, handle, mode: 'ui' };
  }

  // ── X API: block user ────────────────────────────────────────────────────────
  async function blockUser(handle) {
    try {
      const ct0 = getCt0();
      if (!ct0) throw new Error('未找到 ct0 cookie，请确认已登录 X');

      const userId = await fetchUserId(handle);

      const resp = await fetchWithTimeout(
        'https://x.com/i/api/1.1/blocks/create.json',
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            ...xHeaders(ct0),
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `user_id=${encodeURIComponent(userId)}`
        },
        15000
      );

      if (!resp.ok) {
        const body = await resp.text().catch(() => '');
        const err = new Error(`屏蔽请求失败 (HTTP ${resp.status}): ${body.slice(0, 120)}`);
        if (resp.status === 401 && /"code"\s*:\s*89/.test(body)) {
          err.code = 'TOKEN_INVALID';
        }
        throw err;
      }

      return { success: true, userId, handle, mode: 'api' };
    } catch (err) {
      if (err && err.code === 'TOKEN_INVALID') {
        // Fallback: local page automation, no API token dependency.
        return blockUserViaUi(handle);
      }
      throw err;
    }
  }

  // ── Block-queue runner (content script scope → reliable setTimeout) ─────────
  function broadcastStatus() {
    chrome.runtime.sendMessage({
      action: 'blockProgress',
      status: { ...bqState, queue: bqState.queue.map(q => ({ ...q })) }
    }).catch(() => {}); // popup may be closed – ignore
  }

  async function runBlockQueue() {
    const CONSECUTIVE_FAIL_LIMIT = 2;

    bqState.running = true;

    for (let i = 0; i < bqState.queue.length; i++) {
      if (!bqState.running) break;

      // Spin while paused
      while (bqState.paused) {
        await sleep(400);
        if (!bqState.running) return;
      }

      const item = bqState.queue[i];
      if (item.status !== 'pending') continue;

      item.status = 'running';
      item.attempts += 1;
      bqState.current = item.handle;
      broadcastStatus();

      try {
        await blockUser(item.handle);
        item.status = 'done';
        bqState.done++;
        bqState.consecutiveFails = 0;
        bqState.log.push({ handle: item.handle, status: 'done', time: Date.now() });
      } catch (err) {
        item.status = 'failed';
        item.lastError = err.message;
        bqState.failed++;
        bqState.consecutiveFails++;
        bqState.log.push({
          handle: item.handle,
          status: 'failed',
          error: err.message,
          time: Date.now()
        });

        if (bqState.consecutiveFails >= CONSECUTIVE_FAIL_LIMIT) {
          bqState.running = false;
          bqState.paused = true;
          bqState.current = null;
          bqState.errorMsg = `连续 ${CONSECUTIVE_FAIL_LIMIT} 次失败，已自动暂停。`;
          broadcastStatus();
          return;
        }
      }

      broadcastStatus();

      // Rate-limit: check whether there is a next pending item
      const hasMore = bqState.queue.slice(i + 1).some(q => q.status === 'pending');
      if (hasMore) {
        // Fast randomized pacing: 1-3s between users, avoids fixed interval pattern.
        await sleep(1000 + Math.random() * 2000);
      }
    }

    bqState.running = false;
    bqState.current = null;
    broadcastStatus();
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

      case 'startBlockQueue': {
        const MAX = 20;
        const accounts = (msg.accounts || []).slice(0, MAX);
        bqState = emptyQueueState();
        bqState.queue = accounts.map(a => ({
          handle: a.handle,
          status: 'pending',
          attempts: 0,
          lastError: ''
        }));
        bqState.total = bqState.queue.length;
        runBlockQueue(); // fire-and-forget
        sendResponse({ ok: true });
        return false;
      }

      case 'pauseBlocking': {
        bqState.paused = true;
        bqState.running = false;
        sendResponse({ ok: true });
        return false;
      }

      case 'getBlockStatus': {
        sendResponse({
          ok: true,
          status: { ...bqState, queue: bqState.queue.map(q => ({ ...q })) }
        });
        return false;
      }

      default:
        return false;
    }
  });
})();
