/* Block Bot – background service worker
 * Handles: LLM analysis (multi-provider), tab-scoped analysis jobs,
 * and persisted analysis cache so popup can be reopened without losing results.
 */
'use strict';

const DEFAULT_ANALYSIS_BATCH_SIZE = 25;
const DEFAULT_ANALYSIS_PARALLELISM = 0; // 0 = provider-based auto
const DEFAULT_SCRAPE_SCROLL_WAIT_MS = 1200;
const DEFAULT_SCRAPE_MAX_ROUNDS = 120;
const DEFAULT_SCRAPE_MAX_TWEETS = 1000;
const DEFAULT_SCRAPE_STAGNANT_ROUNDS = 4;
const CONFIDENCE_THRESHOLD = 0.8;
const MAX_TWEET_TEXT_LENGTH = 50;
const ANALYSIS_KEY_PREFIX = 'analysisCache:';
const API_RETRY_MAX_ATTEMPTS = 4;
const API_RETRY_BASE_DELAY_MS = 800;
const API_RETRY_MAX_DELAY_MS = 8000;
const API_FETCH_TIMEOUT_MS = 30000;

const PERSIST_BLOCK_QUEUE_KEY = 'blockQueueState';
const PERSIST_DEEP_SCAN_KEY  = 'deepScanPersist';
const CIRCUIT_BREAKER_THRESHOLD = 5;

const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash'
];

const runningTabs = new Set();

// 当前页面分析缓存：tabId => { scannedUserHandles: Set, currentUrl: string }
// 用于避免重复分析同一用户
const pageAnalysisCache = {};

const blockQueue = {
  queue: [],
  running: false,
  paused: false,
  total: 0,
  done: 0,
  failed: 0,
  consecutiveFails: 0,
  current: null,
  log: [],
  errorMsg: '',
  workerTabId: null
};

// Deep Scan State
const deepScanState = {
  running: false,
  paused: false,
  cancelled: false,
  handle: '',
  config: {},
  postsCount: 0,
  repliesCount: 0,
  repliesCollected: [],
  candidates: [],
  candidatesCount: 0,
  completed: false,
  currentStep: '待启动',
  scannedPostUrls: new Set(),
  workerTabId: null,
  error: ''
};

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function analysisKey(tabId) {
  return `${ANALYSIS_KEY_PREFIX}${tabId}`;
}

// ─── 页面分析缓存管理 ────────────────────────────────────────────────────────

/**
 * 初始化或更新 tab 缓存
 * 如果 URL 变化，清空该 tab 的缓存
 */
function initPageAnalysisCache(tabId, url) {
  if (!pageAnalysisCache[tabId]) {
    pageAnalysisCache[tabId] = {
      scannedUserHandles: new Set(),
      currentUrl: url
    };
  } else if (pageAnalysisCache[tabId].currentUrl !== url) {
    // URL 变化，清空缓存
    console.log(`[Cache] Tab ${tabId} URL 变化，清空缓存: ${pageAnalysisCache[tabId].currentUrl} → ${url}`);
    pageAnalysisCache[tabId] = {
      scannedUserHandles: new Set(),
      currentUrl: url
    };
  }
}

/**
 * 添加已扫描的用户 handle
 */
function addScannedUserHandles(tabId, handles) {
  if (!pageAnalysisCache[tabId]) return;
  const before = pageAnalysisCache[tabId].scannedUserHandles.size;
  (handles || []).forEach(handle => {
    const key = String(handle || '').replace('@', '').toLowerCase();
    pageAnalysisCache[tabId].scannedUserHandles.add(key);
  });
  const after = pageAnalysisCache[tabId].scannedUserHandles.size;
  if (after > before) {
    console.log(`[Cache] Tab ${tabId} 已扫描用户数: ${before} → ${after}`);
  }
}

/**
 * 过滤出新用户（未扫描过的）
 * 返回需要分析的新用户
 */
function filterNewUsers(tabId, users) {
  if (!pageAnalysisCache[tabId]) {
    return users;
  }
  const cached = pageAnalysisCache[tabId].scannedUserHandles;
  const newUsers = (users || []).filter(u => {
    const key = String(u.handle || '').replace('@', '').toLowerCase();
    return !cached.has(key);
  });
  
  const skipped = (users || []).length - newUsers.length;
  if (skipped > 0) {
    console.log(`[Cache] Tab ${tabId} 跳过 ${skipped} 个已扫描用户，分析 ${newUsers.length} 个新用户`);
  }
  return newUsers;
}

/**
 * 清空指定 tab 的缓存
 */
function clearPageAnalysisCache(tabId) {
  if (pageAnalysisCache[tabId]) {
    console.log(`[Cache] 清空 Tab ${tabId} 的缓存`);
    delete pageAnalysisCache[tabId];
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function withTimeout(promise, timeoutMs, timeoutMsg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMsg)), timeoutMs);
    promise
      .then(v => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(e => {
        clearTimeout(timer);
        reject(e);
      });
  });
}

function isRetryableHttpStatus(status) {
  return status === 408 || status === 429 || (status >= 500 && status <= 599);
}

function shouldTryNextGeminiModel(error) {
  const status = Number(error?.httpStatus || 0);
  return status === 429 || (status >= 500 && status <= 599);
}

function parseRetryAfterMs(value) {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const dateMs = Date.parse(value);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function retryDelayMs(attemptIndex, retryAfterValue) {
  const retryAfterMs = parseRetryAfterMs(retryAfterValue);
  if (retryAfterMs !== null) {
    return Math.min(retryAfterMs, API_RETRY_MAX_DELAY_MS);
  }

  const exponential = API_RETRY_BASE_DELAY_MS * (2 ** Math.max(0, attemptIndex - 1));
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(exponential + jitter, API_RETRY_MAX_DELAY_MS);
}

async function fetchWithRetry(url, options, label) {
  let lastError = null;

  for (let attempt = 1; attempt <= API_RETRY_MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_FETCH_TIMEOUT_MS);

    try {
      const resp = await fetch(url, {
        ...options,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (resp.ok || !isRetryableHttpStatus(resp.status)) {
        return resp;
      }

      const errText = await resp.text().catch(() => '');
      const err = new Error(`${label} 错误 (HTTP ${resp.status}): ${errText.slice(0, 200)}`);
      err.httpStatus = resp.status;
      lastError = err;

      if (attempt < API_RETRY_MAX_ATTEMPTS) {
        await sleep(retryDelayMs(attempt, resp.headers?.get('retry-after')));
        continue;
      }

      throw err;
    } catch (e) {
      clearTimeout(timer);
      lastError = e;
      if (e.httpStatus || attempt >= API_RETRY_MAX_ATTEMPTS) {
        throw e;
      }
      await sleep(retryDelayMs(attempt));
    }
  }

  throw lastError || new Error(`${label} 请求失败`);
}

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

function storageRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

// ─── 状态持久化（防止 Service Worker 重启丢数据）─────────────────────────────

/**
 * 将屏蔽队列关键字段写入 storage。
 * 在 recalcTotals / pause / resume 等关键节点触发（fire-and-forget）。
 */
function saveBlockQueueState() {
  // Trim log to last 50 entries before persisting.
  if (blockQueue.log.length > 50) {
    blockQueue.log.splice(0, blockQueue.log.length - 50);
  }
  storageSet({
    [PERSIST_BLOCK_QUEUE_KEY]: {
      queue:    blockQueue.queue.map(i => ({ ...i })),
      log:      blockQueue.log.slice(),
      paused:   blockQueue.paused,
      errorMsg: blockQueue.errorMsg
    }
  }).catch(e => console.warn('[Persist] saveBlockQueueState failed:', e));
}

/**
 * 将 Deep Scan 关键字段写入 storage。
 * 在扫描完成、出错、步骤里程碑时触发（fire-and-forget）。
 */
function saveDeepScanState() {
  storageSet({
    [PERSIST_DEEP_SCAN_KEY]: {
      running:         deepScanState.running,
      handle:          deepScanState.handle,
      config:          deepScanState.config,
      postsCount:      deepScanState.postsCount,
      repliesCount:    deepScanState.repliesCount,
      candidatesCount: deepScanState.candidatesCount,
      completed:       deepScanState.completed,
      currentStep:     deepScanState.currentStep,
      error:           deepScanState.error,
      // Only persist candidates when the scan has finished; avoid bloat mid-run.
      candidates:      deepScanState.completed ? deepScanState.candidates : []
    }
  }).catch(e => console.warn('[Persist] saveDeepScanState failed:', e));
}

/**
 * Service Worker 启动时从 storage 恢复上次状态。
 * blockQueue 中处于 'running' 的条目（上次被中断）回退为 'pending'。
 * deepScanState 如果上次正在运行则标记为中断错误；若已完成则保留结果。
 */
async function restorePersistedState() {
  const data = await storageGet([PERSIST_BLOCK_QUEUE_KEY, PERSIST_DEEP_SCAN_KEY]);

  const bq = data[PERSIST_BLOCK_QUEUE_KEY];
  if (bq) {
    blockQueue.queue = (bq.queue || []).map(i => ({
      ...i,
      // Items that were mid-block when the SW died must be retried.
      status: i.status === 'running' ? 'pending' : i.status
    }));
    blockQueue.log     = bq.log     || [];
    blockQueue.paused  = bq.paused  || false;
    blockQueue.errorMsg= bq.errorMsg|| '';
    recalcTotals();
    console.log(`[Persist] Restored blockQueue: ${blockQueue.queue.length} items`);
  }

  const ds = data[PERSIST_DEEP_SCAN_KEY];
  if (ds) {
    deepScanState.handle          = ds.handle          || '';
    deepScanState.config          = ds.config          || {};
    deepScanState.postsCount      = ds.postsCount      || 0;
    deepScanState.repliesCount    = ds.repliesCount    || 0;
    deepScanState.candidatesCount = ds.candidatesCount || 0;
    deepScanState.completed       = ds.completed       || false;
    deepScanState.candidates      = ds.candidates      || [];

    if (ds.running && !ds.completed) {
      // SW was killed while scan was in progress – cannot resume, show error.
      deepScanState.running     = false;
      deepScanState.error       = 'Service Worker 已重启，扫描中断。请重新发起深度扫描。';
      deepScanState.currentStep = '扫描已中断（后台进程重启）';
    } else {
      deepScanState.error       = ds.error       || '';
      deepScanState.currentStep = ds.currentStep || '';
    }
    console.log(`[Persist] Restored deepScanState: handle=${deepScanState.handle} completed=${deepScanState.completed} error=${deepScanState.error}`);
  }
}

// Restore persisted state as soon as the service worker starts.
// By the time the first message arrives (requires a popup round-trip),
// this IIFE will have already completed.
(async () => {
  try { await restorePersistedState(); } catch (e) { console.error('[Persist] Restore failed:', e); }
})();

function tabsCreate(url, active = false) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create({ url, active }, tab => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function tabsRemove(tabId) {
  return new Promise(resolve => chrome.tabs.remove(tabId, () => resolve()));
}

function tabsUpdate(tabId, updateProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.update(tabId, updateProperties, tab => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tab);
      }
    });
  });
}

function waitForTabLoaded(tabId, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('后台屏蔽页面加载超时'));
    }, timeoutMs);

    function onUpdated(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

async function ensureWorkerTab() {
  if (blockQueue.workerTabId) {
    try {
      // #11 fix: confirm tab is fully loaded before reuse to avoid navigation race
      const existingTab = await chrome.tabs.get(blockQueue.workerTabId);
      if (existingTab.status !== 'complete') {
        await waitForTabLoaded(blockQueue.workerTabId, 10000).catch(() => {});
      }
      return blockQueue.workerTabId;
    } catch (_) {
      blockQueue.workerTabId = null;
    }
  }

  const tab = await tabsCreate('https://x.com/home', false);
  blockQueue.workerTabId = tab.id;
  try {
    await waitForTabLoaded(tab.id, 18000);
  } catch (_) {
    // Continue even if timeout; next navigation may still work.
  }
  return tab.id;
}

async function cleanupWorkerTab() {
  if (!blockQueue.workerTabId) return;
  try {
    await tabsRemove(blockQueue.workerTabId);
  } catch (_) {}
  blockQueue.workerTabId = null;
}

function executeInTab(tabId, fn, args) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: fn,
        args
      },
      results => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(results?.[0]?.result);
      }
    );
  });
}

async function blockViaHiddenTab(handle) {
  const handleSlug = String(handle || '').replace('@', '').trim();
  if (!handleSlug) {
    throw new Error('无效 handle，无法后台屏蔽');
  }

  const tabId = await ensureWorkerTab();
  const profileUrl = `https://x.com/${handleSlug}`;
  await tabsUpdate(tabId, { url: profileUrl, active: false });
  await waitForTabLoaded(tabId, 15000);

  const result = await executeInTab(
      tabId,
      async slug => {
        const sleep = ms => new Promise(r => setTimeout(r, ms));
        const waitFor = async (selector, timeout = 7000) => {
          const s = Date.now();
          while (Date.now() - s < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(140);
          }
          return null;
        };

        const moreBtn =
          (await waitFor('button[data-testid="userActions"]', 8000)) ||
          document.querySelector('button[aria-label*="More"]') ||
          document.querySelector('button[aria-label*="更多"]') ||
          // #12 fix: multilingual fallback via aria-haspopup
          document.querySelector('[data-testid="User-Name"]')
            ?.closest('[data-testid="UserCell"], article, [data-testid="primaryColumn"]')
            ?.querySelector('button[aria-haspopup="menu"]');

        if (!moreBtn) {
          return { ok: false, error: `后台页未找到用户操作按钮 @${slug}` };
        }

        moreBtn.click();
        await sleep(260);

        const blockItem =
          (await waitFor('[data-testid="block"]', 4500)) ||
          document.querySelector('[role="menuitem"][aria-label*="Block"]') ||
          document.querySelector('[role="menuitem"][aria-label*="屏蔽"]') ||
          // #12 fix: text-based fallback for other UI languages
          // Use word-boundary so "Unblock" / "Entblockieren" etc. are NOT matched.
          Array.from(document.querySelectorAll('[role="menuitem"]')).find(el => /\bblock\b/i.test(el.textContent || ''));

        if (!blockItem) {
          const maybeUnblock = document.querySelector('[data-testid="unblock"]');
          if (maybeUnblock) {
            return { ok: true, alreadyBlocked: true };
          }
          return { ok: false, error: `后台页未找到屏蔽菜单项 @${slug}` };
        }

        blockItem.click();

        const confirmBtn = await waitFor('[data-testid="confirmationSheetConfirm"]', 7000);
        if (!confirmBtn) {
          return { ok: false, error: `后台页未找到屏蔽确认按钮 @${slug}` };
        }

        confirmBtn.click();
        await sleep(800);
        return { ok: true };
      },
      [handleSlug]
    );

  if (!result?.ok) {
    throw new Error(result?.error || `后台屏蔽失败：${handle}`);
  }
  return { ok: true };
}

function getBlockStatusSnapshot() {
  return {
    queue: blockQueue.queue.map(q => ({ ...q })),
    running: blockQueue.running,
    paused: blockQueue.paused,
    total: blockQueue.total,
    done: blockQueue.done,
    failed: blockQueue.failed,
    consecutiveFails: blockQueue.consecutiveFails,
    current: blockQueue.current,
    log: blockQueue.log.slice(),
    errorMsg: blockQueue.errorMsg
  };
}

function recalcTotals() {
  blockQueue.total  = blockQueue.queue.length;
  blockQueue.done   = blockQueue.queue.filter(i => i.status === 'done').length;
  blockQueue.failed = blockQueue.queue.filter(i => i.status === 'failed').length;
  // Persist after every status change so SW restarts lose at most one item.
  saveBlockQueueState();
}

function retryFailedBlockItems() {
  let count = 0;
  blockQueue.queue.forEach(item => {
    if (item.status === 'failed') {
      item.status = 'pending';
      item.lastError = '';
      count++;
    }
  });
  blockQueue.consecutiveFails = 0;
  blockQueue.errorMsg = '';
  recalcTotals();
  return count;
}

function clearCompletedBlockItems() {
  const before = blockQueue.queue.length;
  blockQueue.queue = blockQueue.queue.filter(i => i.status !== 'done');
  blockQueue.log = blockQueue.log.filter(i => i.status !== 'done');
  recalcTotals();
  return before - blockQueue.queue.length;
}

function enqueueBlockAccounts(accounts) {
  const seen = new Set(blockQueue.queue.map(i => i.handle.toLowerCase()));
  let added = 0;

  (accounts || []).forEach(a => {
    const rawHandle = (a && a.handle ? a.handle : '').trim();
    if (!rawHandle) return;
    const handle = rawHandle.startsWith('@') ? rawHandle : `@${rawHandle}`;
    const key = handle.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    blockQueue.queue.push({
      handle,
      status: 'pending',
      attempts: 0,
      lastError: ''
    });
    added++;
  });

  recalcTotals();
  return added;
}

async function runGlobalBlockQueue() {
  if (blockQueue.running) return;

  blockQueue.running = true;
  blockQueue.paused = false;
  blockQueue.errorMsg = '';

  try {
    while (true) {
      if (!blockQueue.running || blockQueue.paused) break;

      const item = blockQueue.queue.find(i => i.status === 'pending');
      if (!item) break;

      item.status = 'running';
      item.attempts += 1;
      blockQueue.current = item.handle;

      try {
        await blockViaHiddenTab(item.handle);
        item.status = 'done';
        blockQueue.consecutiveFails = 0;
        blockQueue.log.push({
          handle: item.handle,
          status: 'done',
          mode: 'background-ui',
          time: Date.now()
        });
      } catch (e) {
        item.status = 'failed';
        item.lastError = e.message || '失败';
        blockQueue.consecutiveFails += 1;
        blockQueue.log.push({
          handle: item.handle,
          status: 'failed',
          mode: 'background-ui',
          error: item.lastError,
          time: Date.now()
        });

        // Issue #10: close dirty tab on failure so next attempt gets fresh tab.
        await cleanupWorkerTab();

        // Circuit breaker: auto-pause after N consecutive failures so a dead
        // X session doesn’t silently spin through the entire queue.
        if (blockQueue.consecutiveFails >= CIRCUIT_BREAKER_THRESHOLD) {
          blockQueue.paused   = true;
          blockQueue.errorMsg = `连续失败 ${blockQueue.consecutiveFails} 次，已自动暂停。请检查 X 登录状态后点击「继续」重试。`;
          recalcTotals();
          break;
        }
      }

      recalcTotals();

      const hasPending = blockQueue.queue.some(i => i.status === 'pending');
      if (hasPending) {
        // Faster randomized pace requested by user.
        await sleep(1000 + Math.random() * 2000);
      }
    }
  } finally {
    blockQueue.running = false;
    blockQueue.current = null;
    if (!blockQueue.paused) {
      await cleanupWorkerTab();
    }
  }
}

function parseHandlesFromText(text) {
  const parts = String(text || '')
    .split(/[\s,，;；\n\t]+/)
    .map(s => s.trim())
    .filter(Boolean);

  const handles = [];
  for (const p of parts) {
    const m = p.match(/^@?[A-Za-z0-9_]{1,30}$/);
    if (!m) continue;
    handles.push({ handle: p.startsWith('@') ? p : `@${p}` });
  }
  return handles;
}

function defaultDetectionRules() {
  return (
    '【高置信度特征】：\n' +
    '1. 营销/广告/引流话术、重复模板语言、可疑短链接\n' +
    '2. 无实质内容的博眼球文字、机器人常见套路（抽奖转发等）\n' +
    '3. 短时间内多条语义高度重复内容\n' +
    '4. ⭐【自动回复机器人】：推文结构高度模板化，包含大量重复短语、固定话术块、\n' +
    '   相同的账号/话题提及（如 @xxx、#xxx 出现频次异常高），\n' +
    '   仅在特定位置有变化（如开头感叹词：卧槽、牛逼、炸裂 等，\n' +
    '   但中间核心内容完全相同），这是自动回复/复制粘贴机器人的典型表现。\n' +
    '   请提高这类推文的可疑程度。\n' +
    '5. 推文中如果存在重复出现的长短语或整段复制的结构，高度怀疑是模板自动发送。'
  );
}

function buildPrompt(batch, customDetectionPrompt = '') {
  // #7 fix: group tweets by handle so the LLM sees all messages per user
  // and can detect copy-paste / template-bot patterns more reliably.
  const grouped = new Map();
  (batch || []).forEach(t => {
    const key = String(t.handle || '').toLowerCase();
    if (!grouped.has(key)) {
      grouped.set(key, { handle: t.handle, displayName: t.displayName, texts: [] });
    }
    const entry = grouped.get(key);
    if (t.text) {
      const full = String(t.text);
      entry.texts.push(full.length > MAX_TWEET_TEXT_LENGTH ? full.slice(0, MAX_TWEET_TEXT_LENGTH) + '…' : full);
    }
  });

  const tweetsJson = JSON.stringify(
    Array.from(grouped.values()).map(t => ({
      handle: t.handle,
      displayName: t.displayName,
      texts: t.texts,
      textCount: t.texts.length,
      hasUrl: t.texts.some(text => /https?:\/\//.test(text)),
      isReply: t.texts.some(text => text.startsWith('@')),
      charDiversity: new Set(t.texts.join('')).size
    })),
    null,
    2
  );

  const rules = String(customDetectionPrompt || '').trim() || defaultDetectionRules();

  return (
    '你是一个 Twitter/X 垃圾账号检测助手。请分析以下账号列表（每个账号可能含多条推文），判断是否疑似' +
    '垃圾账号、广告号或机器人号。\n\n' +
    '账号数据：\n' + tweetsJson + '\n\n' +
    '请对每个 handle 返回一个 JSON 数组，格式如下（只返回 JSON，不要加其他文字）：\n' +
    '[\n' +
    '  {\n' +
    '    "handle": "@xxx",\n' +
    '    "displayName": "...",\n' +
    '    "isSpamOrBot": true,\n' +
    '    "confidence": 0.91,\n' +
    '    "reason": "具体原因（中文）",\n' +
    '    "evidenceTweet": "命中的推文摘要"\n' +
    '  }\n' +
    ']\n\n' +
    '判断必须以推文内容与行为模式为主，不要仅因为账号名里有随机数字就判定为垃圾号。\n\n' +
    rules + '\n\n' +
    '对于看起来正常的账号，isSpamOrBot 请返回 false，confidence 不要虚高。'
  );
}

function parseArrayFromModelText(rawText) {
  try {
    const parsed = JSON.parse(rawText);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    const fenced = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) {
      try {
        const parsed = JSON.parse(fenced[1]);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {}
    }
    const arrMatch = rawText.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      try {
        const parsed = JSON.parse(arrMatch[0]);
        return Array.isArray(parsed) ? parsed : [];
      } catch (_) {}
    }
    return [];
  }
}

function normalizeThreshold(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return CONFIDENCE_THRESHOLD;
  if (v < 0.5) return 0.5;
  if (v > 1) return 1;
  return v;
}

function normalizeInt(raw, min, max, fallback) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return fallback;
  const n = Math.round(v);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function normalizeAnalysisBatchSize(raw) {
  return normalizeInt(raw, 5, 40, DEFAULT_ANALYSIS_BATCH_SIZE);
}

function normalizeAnalysisParallelism(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return DEFAULT_ANALYSIS_PARALLELISM;
  if (v <= 0) return 0;
  return normalizeInt(v, 1, 6, 0);
}

function normalizeScrapeScrollWaitMs(raw) {
  return normalizeInt(raw, 600, 2500, DEFAULT_SCRAPE_SCROLL_WAIT_MS);
}

function normalizeScrapeMaxRounds(raw) {
  return normalizeInt(raw, 6, 300, DEFAULT_SCRAPE_MAX_ROUNDS);
}

function normalizeScrapeMaxTweets(raw) {
  return normalizeInt(raw, 20, 5000, DEFAULT_SCRAPE_MAX_TWEETS);
}

function normalizeScrapeStagnantRounds(raw) {
  return normalizeInt(raw, 2, 8, DEFAULT_SCRAPE_STAGNANT_ROUNDS);
}

function normalizeOpenAICompatibleApiUrl(rawUrl) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, '');
    if (path === '' || path === '/v1') {
      url.pathname = `${path || '/v1'}/chat/completions`;
      return url.toString();
    }
  } catch (_) {
    return trimmed;
  }

  return trimmed;
}

async function getProviderConfig() {
  const d = await storageGet([
    'llmProvider',
    'geminiApiKey',
    'geminiModel',
    'openaiApiKey',
    'openaiApiUrl',
    'openaiModel',
    'openaiApiType',
    'spamConfidenceThreshold',
    'obviousBotKeywords',
    'customDetectionPrompt',
    'analysisBatchSize',
    'analysisParallelism',
    'scrapeScrollWaitMs',
    'scrapeMaxRounds',
    'scrapeMaxTweets',
    'scrapeStagnantRounds'
  ]);

  const provider = d.llmProvider || 'gemini';
  return {
    provider,
    geminiApiKey: d.geminiApiKey || '',
    geminiModel: d.geminiModel || 'auto',
    openaiApiKey: d.openaiApiKey || '',
    openaiApiUrl: normalizeOpenAICompatibleApiUrl(d.openaiApiUrl),
    openaiModel: d.openaiModel || '',
    openaiApiType: d.openaiApiType || (provider === 'anthropic' ? 'anthropic' : 'openai_compat'),
    spamConfidenceThreshold: normalizeThreshold(d.spamConfidenceThreshold),
    obviousBotKeywords: normalizeKeywordList(d.obviousBotKeywords),
    customDetectionPrompt: d.customDetectionPrompt || '',
    analysisBatchSize: normalizeAnalysisBatchSize(d.analysisBatchSize),
    analysisParallelism: normalizeAnalysisParallelism(d.analysisParallelism),
    scrapeScrollWaitMs: normalizeScrapeScrollWaitMs(d.scrapeScrollWaitMs),
    scrapeMaxRounds: normalizeScrapeMaxRounds(d.scrapeMaxRounds),
    scrapeMaxTweets: normalizeScrapeMaxTweets(d.scrapeMaxTweets),
    scrapeStagnantRounds: normalizeScrapeStagnantRounds(d.scrapeStagnantRounds)
  };
}

function getProviderConfigIssue(cfg) {
  if (cfg.provider === 'gemini') {
    return cfg.geminiApiKey ? '' : 'Gemini API Key 未设置。请先打开设置页配置模型服务。';
  }

  if (!cfg.openaiApiUrl) return 'API URL 未设置。请先打开设置页配置模型服务。';
  if (!cfg.openaiModel) return '模型名未设置。请先打开设置页配置模型服务。';
  if (!cfg.openaiApiKey) return 'API Key 未设置。请先打开设置页配置模型服务。';
  return '';
}

async function testProviderConfig() {
  const cfg = await getProviderConfig();
  const issue = getProviderConfigIssue(cfg);
  if (issue) throw new Error(issue);

  const sample = [{
    handle: '@block_bot_test',
    displayName: 'Block Bot Test',
    text: 'This is a normal configuration test message.',
    tweetUrl: '',
    profileUrl: 'https://x.com/block_bot_test'
  }];

  await analyzeBatch(sample, cfg);
  return {
    provider: cfg.provider,
    model: cfg.provider === 'gemini' ? cfg.geminiModel : cfg.openaiModel
  };
}

async function analyzeBatchWithGemini(batch, cfg) {
  if (!cfg.geminiApiKey) {
    throw new Error('Gemini API Key 未设置。请在扩展设置页中配置后重试。');
  }

  const prompt = buildPrompt(batch, cfg.customDetectionPrompt);
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json'
    }
  };

  const modelList = cfg.geminiModel && cfg.geminiModel !== 'auto'
    ? [cfg.geminiModel, ...GEMINI_MODELS.filter(m => m !== cfg.geminiModel)]
    : GEMINI_MODELS;

  let lastError = null;
  for (let i = 0; i < modelList.length; i++) {
    const model = modelList[i];
    try {
      const resp = await fetchWithRetry(
        `${geminiUrl(model)}?key=${encodeURIComponent(cfg.geminiApiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        },
        `Gemini API (${model})`
      );

      if (!resp.ok) {
        const errText = await resp.text().catch(() => '');
        const err = new Error(`Gemini API 错误 (HTTP ${resp.status}): ${errText.slice(0, 200)}`);
        err.httpStatus = resp.status;
        throw err;
      }

      const data = await resp.json();
      const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
      return parseArrayFromModelText(rawText);
    } catch (e) {
      lastError = e;
      if (e.httpStatus === 404 && i < modelList.length - 1) {
        continue;
      }
      if (shouldTryNextGeminiModel(e) && i < modelList.length - 1) {
        continue;
      }
      throw e;
    }
  }

  throw lastError || new Error('Gemini 分析失败：未找到可用模型');
}

async function analyzeBatchWithOpenAICompatible(batch, cfg) {
  if (!cfg.openaiApiUrl) {
    throw new Error('OpenAI 兼容 API URL 未设置。');
  }
  if (!cfg.openaiApiKey) {
    throw new Error('OpenAI 兼容 API Key 未设置。');
  }
  if (!cfg.openaiModel) {
    throw new Error('OpenAI 兼容模型名未设置。');
  }

  const prompt = buildPrompt(batch, cfg.customDetectionPrompt);
  const body = {
    model: cfg.openaiModel,
    messages: [
      { role: 'system', content: '你是一个严格输出 JSON 的分类助手。' },
      { role: 'user', content: prompt }
    ],
    temperature: 0.1
  };

  const resp = await fetchWithRetry(
    cfg.openaiApiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.openaiApiKey}`
      },
      body: JSON.stringify(body)
    },
    'OpenAI 兼容 API'
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenAI 兼容 API 错误 (HTTP ${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const rawText = data?.choices?.[0]?.message?.content || '[]';
  return parseArrayFromModelText(rawText);
}

async function analyzeBatchWithAnthropic(batch, cfg) {
  if (!cfg.openaiApiUrl) {
    throw new Error('Anthropic API URL 未设置。');
  }
  if (!cfg.openaiApiKey) {
    throw new Error('Anthropic API Key 未设置。');
  }
  if (!cfg.openaiModel) {
    throw new Error('Anthropic 模型名未设置。');
  }

  const prompt = buildPrompt(batch, cfg.customDetectionPrompt);
  const body = {
    model: cfg.openaiModel,
    max_tokens: 4096,
    temperature: 0.1,
    system: '你是一个严格输出 JSON 的分类助手。',
    messages: [
      { role: 'user', content: prompt }
    ]
  };

  const resp = await fetchWithRetry(
    cfg.openaiApiUrl,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.openaiApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    },
    'Anthropic API'
  );

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Anthropic API 错误 (HTTP ${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const textParts = Array.isArray(data?.content)
    ? data.content.filter(p => p?.type === 'text').map(p => p.text || '')
    : [];
  return parseArrayFromModelText(textParts.join('\n') || '[]');
}

async function analyzeBatch(batch, cfg) {
  if (cfg.provider === 'gemini') {
    return analyzeBatchWithGemini(batch, cfg);
  }
  if (cfg.provider === 'anthropic' || cfg.openaiApiType === 'anthropic') {
    return analyzeBatchWithAnthropic(batch, cfg);
  }
  return analyzeBatchWithOpenAICompatible(batch, cfg);
}

function shouldFallbackToChunk(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('context') || msg.includes('token') || msg.includes('too large') || msg.includes('413');
}

function getParallelBatchConcurrency(cfg) {
  const configured = Number(cfg?.analysisParallelism || 0);
  if (configured > 0) {
    return Math.min(6, Math.max(1, Math.round(configured)));
  }

  const provider = String(cfg?.provider || '').toLowerCase();
  const apiType = String(cfg?.openaiApiType || '').toLowerCase();

  // Keep concurrency conservative to reduce provider rate-limit spikes.
  if (provider === 'gemini') return 2;
  if (provider === 'anthropic' || apiType === 'anthropic') return 2;
  return 3;
}

function preClusterSimilarTweets(tweets) {
  if (!tweets || tweets.length <= 1) {
    return { representatives: tweets, clusterMap: {} };
  }

  const clusterMap = {}; // repHandle_lower → [memberTweets]
  const clustered = new Set();
  const representatives = [];

  for (let i = 0; i < tweets.length; i++) {
    const ti = tweets[i];
    const keyI = (ti.handle || '').toLowerCase();
    if (clustered.has(keyI)) continue;

    representatives.push(ti);
    clustered.add(keyI);
    const textI = ti.text || (ti.texts && ti.texts[0]) || '';

    for (let j = i + 1; j < tweets.length; j++) {
      const tj = tweets[j];
      const keyJ = (tj.handle || '').toLowerCase();
      if (clustered.has(keyJ)) continue;

      const textJ = tj.text || (tj.texts && tj.texts[0]) || '';
      if (calcTextSimilarity(textI, textJ) > 0.85) {
        if (!clusterMap[keyI]) clusterMap[keyI] = [];
        clusterMap[keyI].push(tj);
        clustered.add(keyJ);
      }
    }
  }

  const clusterCount = Object.values(clusterMap).reduce((s, a) => s + a.length, 0);
  if (clusterCount > 0) {
    console.log(`[PreCluster] 预聚类缩减: ${tweets.length} → ${representatives.length} (${clusterCount} 聚类成员)`);
  }
  return { representatives, clusterMap };
}

function expandClusterResults(aiResults, clusterMap) {
  if (!clusterMap || Object.keys(clusterMap).length === 0) return aiResults || [];

  const expanded = [...(aiResults || [])];
  (aiResults || []).forEach(r => {
    const key = (r.handle || '').toLowerCase();
    const members = clusterMap[key];
    if (members) {
      members.forEach(m => {
        expanded.push({
          ...r,
          handle: m.handle,
          displayName: m.displayName || r.displayName,
          reason: (r.reason || '') + ' | 复制粘贴聚类成员',
          evidenceTweet: m.text || r.evidenceTweet || ''
        });
      });
    }
  });

  console.log(`[PreCluster] 结果展开: ${(aiResults || []).length} → ${expanded.length}`);
  return expanded;
}

async function analyzeTweetsOptimized(tweets, cfg, onProgress) {
  if (!tweets || tweets.length === 0) return [];

  // 预聚类：相似度 >85% 的推文只发一条代表到 AI
  const { representatives, clusterMap } = preClusterSimilarTweets(tweets);

  const batchSize = normalizeAnalysisBatchSize(cfg?.analysisBatchSize);

  if (representatives.length <= batchSize) {
    const all = await analyzeBatch(representatives, cfg);
    if (onProgress) {
      await onProgress(representatives.length, representatives.length);
    }
    return expandClusterResults(all, clusterMap);
  }

  const batches = [];
  for (let i = 0; i < representatives.length; i += batchSize) {
    batches.push(representatives.slice(i, i + batchSize));
  }

  const total = representatives.length;
  const parallel = Math.max(1, Math.min(getParallelBatchConcurrency(cfg), batches.length));
  const resultsByBatch = new Array(batches.length);
  let nextBatchIndex = 0;
  let doneCount = 0;

  const worker = async workerId => {
    if (workerId > 0) {
      await sleep(workerId * 120);
    }

    while (true) {
      const batchIndex = nextBatchIndex;
      nextBatchIndex += 1;
      if (batchIndex >= batches.length) return;

      const batch = batches[batchIndex];
      const batchResults = await analyzeBatch(batch, cfg);
      resultsByBatch[batchIndex] = batchResults;
      doneCount += batch.length;

      if (onProgress) {
        await onProgress(Math.min(doneCount, total), total);
      }
    }
  };

  await Promise.all(Array.from({ length: parallel }, (_, i) => worker(i)));
  return expandClusterResults(resultsByBatch.flat(), clusterMap);
}

function compactText(text) {
  return String(text || '').replace(/\s+/g, '').trim();
}

function stripEmojiLikeChars(text) {
  return String(text || '')
    .replace(/[\p{Extended_Pictographic}\uFE0F]/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')
    .trim();
}

const BUILT_IN_OBVIOUS_BOT_KEYWORDS = [
  '同城',
  '附近',
  '约炮',
  '约萢',
  '速配',
  '线下',
  '无偿',
  '免费',
  '破处',
  '男大',
  '搭子',
  '弟弟',
  '哥哥',
  '嫂',
  'sao货',
  '能打',
  '固炮',
  '上门',
  '外围',
  '裸聊',
  '私房',
  '包夜',
  '空降',
  '兼职',
  '援交',
  '楼凤',
  'onlyfans',
  'escort',
  'hookup',
  'porn',
  'nude',
  'casino',
  '夸克网盘',
  '夸克盘',
  'pan.quark.cn',
  'quark网盘'
];

function hasCloudDrivePromoSignal(text, customKeywords = []) {
  const value = String(text || '').toLowerCase();
  if (!value) return false;

  const compact = value.replace(/\s+/g, '');
  if (
    compact.includes('pan.quark.cn') ||
    compact.includes('quark.cn/s/') ||
    compact.includes('夸克网盘') ||
    compact.includes('夸克盘') ||
    compact.includes('quark网盘')
  ) {
    return true;
  }

  return normalizeKeywordList(customKeywords).some(keyword => {
    const k = String(keyword || '').toLowerCase().trim();
    return k && value.includes(k);
  });
}

function normalizeKeywordList(keywords) {
  const raw = Array.isArray(keywords)
    ? keywords
    : String(keywords || '').split(/[\n,，、;；]+/);
  const seen = new Set();
  return raw
    .map(k => String(k || '').trim())
    .filter(Boolean)
    .filter(k => {
      const key = k.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
}

function hasObviousBotKeyword(text, customKeywords = []) {
  const value = String(text || '').toLowerCase();
  if (!value) return false;
  return BUILT_IN_OBVIOUS_BOT_KEYWORDS
    .concat(normalizeKeywordList(customKeywords))
    .some(keyword => value.includes(keyword.toLowerCase()));
}

function looksLikeRandomHandle(handle) {
  const slug = String(handle || '').replace(/^@/, '');
  return (
    /^[A-Z][a-z]+[A-Z][a-z]+\d{3,}$/.test(slug) ||
    /^[A-Za-z]{5,}\d{4,}$/.test(slug) ||
    /^[a-z0-9]{10,}$/.test(slug) && /\d{4,}/.test(slug) && /[a-z]/.test(slug)
  );
}

function isTinyTokenReply(text) {
  const s = compactText(text);
  if (!s) return true;
  return (
    /^[a-z]?\d{1,4}$/i.test(s) ||
    /^[a-z]\d{1,3}[a-z]?$/i.test(s) ||
    /^[\^~._-]?\d{1,4}$/.test(s)
  );
}

function isEmojiOnlyOrEmojiNumberReply(text) {
  const s = compactText(text);
  if (!s) return false;
  if (!/[\p{Extended_Pictographic}\uFE0F]/u.test(s)) return false;
  return stripEmojiLikeChars(s).replace(/\d+/g, '') === '';
}

function isLowInfoMixedEmojiReply(text) {
  const s = compactText(text);
  if (!s) return false;
  if (!/[\p{Extended_Pictographic}\uFE0F]/u.test(s)) return false;

  const core = stripEmojiLikeChars(s);
  if (!core || !/^[a-z0-9]+$/i.test(core)) return false;

  const digitCount = (core.match(/\d/g) || []).length;
  const alphaCount = (core.match(/[a-z]/gi) || []).length;

  // Typical bot fragments like: "43mB", "85nW", "2uT" after removing emojis.
  return core.length >= 2 && core.length <= 6 && digitCount >= 1 && alphaCount <= 2;
}

function detectObviousBotReply(tweet, customKeywords = []) {
  const text = String(tweet?.text || '').trim();
  const displayName = String(tweet?.displayName || '');
  const handle = String(tweet?.handle || '');
  const reasons = [];

  const adultName = hasObviousBotKeyword(displayName, customKeywords) || hasObviousBotKeyword(handle, customKeywords);
  const cloudDrivePromo = hasCloudDrivePromoSignal(text, customKeywords);
  const randomHandle = looksLikeRandomHandle(handle);
  const tinyToken = isTinyTokenReply(text);
  const emojiOnly = isEmojiOnlyOrEmojiNumberReply(text);
  const lowInfoMixed = isLowInfoMixedEmojiReply(text);

  if (adultName) reasons.push('display name or handle contains adult/spam lure keywords');
  if (cloudDrivePromo) reasons.push('reply text contains cloud-drive promo link keywords');
  if (randomHandle) reasons.push('handle looks randomly generated');
  if (tinyToken) reasons.push('reply text is only a tiny token/number');
  if (emojiOnly) reasons.push('reply text is only emoji or emoji plus numbers');
  if (lowInfoMixed) reasons.push('reply text is emoji mixed with very short alnum fragments');

  if (cloudDrivePromo) {
    return {
      handle,
      displayName,
      isSpamOrBot: true,
      confidence: 0.96,
      reason: `Local prefilter: ${reasons.join(', ')}`,
      evidenceTweet: text,
      source: 'local-prefilter',
      selected: true
    };
  }

  if ((adultName && (tinyToken || emojiOnly || randomHandle || lowInfoMixed)) || (randomHandle && (tinyToken || emojiOnly || lowInfoMixed))) {
    return {
      handle,
      displayName,
      isSpamOrBot: true,
      confidence: 0.98,
      reason: `Local prefilter: ${reasons.join(', ')}`,
      evidenceTweet: text,
      source: 'local-prefilter',
      selected: true
    };
  }

  if (emojiOnly) {
    return {
      handle,
      displayName,
      isSpamOrBot: true,
      confidence: 0.9,
      reason: `Local prefilter: ${reasons.join(', ')}`,
      evidenceTweet: text,
      source: 'local-prefilter',
      selected: true
    };
  }

  if (adultName && stripEmojiLikeChars(text).length <= 8) {
    return {
      handle,
      displayName,
      isSpamOrBot: true,
      confidence: 0.95,
      reason: `Local prefilter: ${reasons.join(', ')}`,
      evidenceTweet: text,
      source: 'local-prefilter',
      selected: true
    };
  }

  return null;
}

function splitObviousBotReplies(tweets, customKeywords = []) {
  const localResults = [];
  const modelTweets = [];
  const seen = new Set();

  (tweets || []).forEach(tweet => {
    const hit = detectObviousBotReply(tweet, customKeywords);
    if (hit?.handle) {
      const key = hit.handle.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        localResults.push(hit);
      }
      return;
    }
    modelTweets.push(tweet);
  });

  return { localResults, modelTweets };
}

// Simple Levenshtein-like similarity score for detecting near-duplicate messages
function calcTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const s1 = String(text1).trim().toLowerCase();
  const s2 = String(text2).trim().toLowerCase();
  if (s1 === s2) return 1;

  // 使用二元组（bigram）匹配：同时支持中文字符和拉丁单词
  // 中文：提取 CJK 字符序列的相邻字符对（bigram）
  // 拉丁：提取 3+ 字符的单词
  function tokenize(s) {
    const cjkChars = s.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || [];
    const bigrams = [];
    for (let i = 0; i < cjkChars.length - 1; i++) {
      bigrams.push(cjkChars[i] + cjkChars[i + 1]);
    }
    const latin = s.match(/\w{3,}/g) || [];
    return [...bigrams, ...latin];
  }

  const tokens1 = tokenize(s1);
  const tokens2 = tokenize(s2);
  if (tokens1.length === 0 || tokens2.length === 0) return 0;

  const set2 = new Set(tokens2);
  const common = tokens1.filter(t => set2.has(t)).length;
  return common / Math.max(tokens1.length, tokens2.length);
}

// Detect copy-paste/auto-reply patterns: accounts with near-identical messages
function detectAutoReplyBots(batch, results) {
  if (!batch || !results || batch.length < 2) return;

  // Build a handle→result map so we are not relying on array order.
  // The LLM response does not guarantee the same order as the input batch.
  const resultByHandle = new Map();
  results.forEach(r => {
    if (r?.handle) {
      resultByHandle.set(String(r.handle).toLowerCase(), r);
    }
  });

  // Group results by tweet similarity
  const tweetsWithResults = batch
    .map(tweet => ({
      tweet: tweet.text || '',
      handle: tweet.handle,
      result: resultByHandle.get(String(tweet.handle || '').toLowerCase())
    }))
    .filter(x => x.result);
  
  // Find clusters of similar tweets (90%+ similarity = likely copy-paste)
  for (let i = 0; i < tweetsWithResults.length; i++) {
    for (let j = i + 1; j < tweetsWithResults.length; j++) {
      const sim = calcTextSimilarity(tweetsWithResults[i].tweet, tweetsWithResults[j].tweet);
      if (sim > 0.85) {
        // High similarity detected! These are likely auto-reply bots
        // Boost confidence for both
        if (tweetsWithResults[i].result.confidence) {
          tweetsWithResults[i].result.confidence = Math.min(1, tweetsWithResults[i].result.confidence + 0.05);
        }
        if (tweetsWithResults[j].result.confidence) {
          tweetsWithResults[j].result.confidence = Math.min(1, tweetsWithResults[j].result.confidence + 0.05);
        }
        
        // Update reason to mention copy-paste detection
        const similarity = Math.round(sim * 100);
        if (tweetsWithResults[i].result.reason) {
          tweetsWithResults[i].result.reason += ` | 复制粘贴(${similarity}%相似度)`;
        }
        if (tweetsWithResults[j].result.reason) {
          tweetsWithResults[j].result.reason += ` | 复制粘贴(${similarity}%相似度)`;
        }
        tweetsWithResults[i].result.isSpamOrBot = true;
        tweetsWithResults[j].result.isSpamOrBot = true;
      }
    }
  }
}

function normalizeCandidates(results, threshold = CONFIDENCE_THRESHOLD) {
  const minConfidence = normalizeThreshold(threshold);
  console.log(`[Normalize] 收到结果总数: ${results.length}, 置信度门槛: ${minConfidence}`);
  
  // Log all results before filtering
  results.forEach((r, idx) => {
    const reason = r.isSpamOrBot ? '✓ 是机器人' : '✗ 不是机器人';
    const passThreshold = r.confidence >= minConfidence ? '✓' : '✗';
    console.log(`  [${idx}] ${r.handle} (${r.displayName}) 置信度: ${(r.confidence || 0).toFixed(2)} ${passThreshold} ${reason}`);
  });
  
  const filtered = results.filter(r => r.isSpamOrBot && r.confidence >= minConfidence);
  console.log(`[Normalize] 过滤后通过门槛的: ${filtered.length}`);
  
  const byHandle = {};

  filtered.forEach(r => {
    if (!r || !r.handle) return;
    const key = String(r.handle).toLowerCase();
    if (!byHandle[key] || Number(r.confidence || 0) > Number(byHandle[key].confidence || 0)) {
      byHandle[key] = {
        handle: r.handle,
        displayName: r.displayName || '',
        confidence: Number(r.confidence || 0),
        reason: r.reason || '',
        evidenceTweet: r.evidenceTweet || '',
        selected: Number(r.confidence || 0) >= 0.9
      };
    }
  });

  return Object.values(byHandle).sort((a, b) => b.confidence - a.confidence);
}

/**
 * 合并两批候选结果：对同一 handle 取置信度最高的那条，最终按置信度倒序排列。
 * 用于多次点击分析时累积所有发现的 bot，而不是每次覆盖。
 */
function mergeCandidateLists(existing, newOnes) {
  const byHandle = {};
  [...existing, ...newOnes].forEach(c => {
    if (!c || !c.handle) return;
    const key = String(c.handle).toLowerCase();
    if (!byHandle[key] || Number(c.confidence || 0) > Number(byHandle[key].confidence || 0)) {
      byHandle[key] = c;
    }
  });
  return Object.values(byHandle).sort((a, b) => b.confidence - a.confidence);
}

function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, resp => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(resp);
      }
    });
  });
}

function ensureContentScript(tabId) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(
      { target: { tabId }, files: ['content/content.js'] },
      () => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve();
        }
      }
    );
  });
}

async function sendToTabSafe(tabId, msg) {
  try {
    return await sendToTab(tabId, msg);
  } catch (e) {
    const missingReceiver = String(e.message || '').includes('Receiving end does not exist');
    if (!missingReceiver) throw e;
    await ensureContentScript(tabId);
    return sendToTab(tabId, msg);
  }
}

async function setAnalysisState(tabId, state) {
  const key = analysisKey(tabId);
  await storageSet({
    [key]: {
      ...state,
      tabId,
      updatedAt: Date.now()
    }
  });
}

async function getAnalysisState(tabId) {
  const key = analysisKey(tabId);
  const data = await storageGet([key]);
  return data[key] || null;
}

async function startAnalysisForTab(tabId) {
  if (runningTabs.has(tabId)) return;
  runningTabs.add(tabId);

  try {
    // 获取 tab URL，初始化缓存
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.url) {
      initPageAnalysisCache(tabId, tab.url);
    }

    await setAnalysisState(tabId, {
      status: 'running',
      scannedTweetCount: 0,
      candidates: [],
      error: '',
      progressText: '正在采集推文…'
    });

    const cfg = await getProviderConfig();
    const targetRounds = Math.ceil(cfg.scrapeMaxTweets / 6);
    const effectiveScrapeRounds = Math.min(300, Math.max(cfg.scrapeMaxRounds, targetRounds));
    const scrapeTimeoutMs = Math.min(
      600000,
      Math.max(15000, cfg.scrapeScrollWaitMs * effectiveScrapeRounds + 15000)
    );

    const scrapeResp = await withTimeout(
      sendToTabSafe(tabId, {
        action: 'scrapeTweets',
        scrapeConfig: {
          scrollWaitMs: cfg.scrapeScrollWaitMs,
          maxRounds: effectiveScrapeRounds,
          maxTweets: cfg.scrapeMaxTweets,
          stagnantRounds: cfg.scrapeStagnantRounds
        }
      }),
      scrapeTimeoutMs,
      '采集超时，请刷新页面后重试'
    );
    if (!scrapeResp?.ok) {
      throw new Error(scrapeResp?.error || '采集失败');
    }

    const allTweets = scrapeResp.tweets || [];
    if (allTweets.length === 0) {
      await setAnalysisState(tabId, {
        status: 'empty',
        scannedTweetCount: 0,
        candidates: [],
        error: '',
        progressText: ''
      });
      return;
    }

    // 过滤出新用户（未扫描过的）
    const tweets = filterNewUsers(tabId, allTweets);
    const skippedCount = allTweets.length - tweets.length;
    
    if (tweets.length === 0) {
      // 全部都是已扫描用户
      await setAnalysisState(tabId, {
        status: 'empty',
        scannedTweetCount: allTweets.length,
        candidates: [],
        error: '',
        progressText: skippedCount > 0 ? `已采集 ${allTweets.length} 条，全部为已分析用户（跳过 ${skippedCount} 个）` : ''
      });
      return;
    }

    await setAnalysisState(tabId, {
      status: 'running',
      scannedTweetCount: allTweets.length,
      candidates: [],
      error: '',
      progressText: `已采集 ${allTweets.length} 条，正在分析 ${tweets.length} 个新用户${skippedCount > 0 ? `（跳过 ${skippedCount} 个已分析用户）` : ''}…`
    });

    const prefilter = splitObviousBotReplies(tweets, cfg.obviousBotKeywords);
    const results = prefilter.localResults.slice();

    if (prefilter.modelTweets.length > 0) {
      const modelResults = await analyzeTweetsOptimized(prefilter.modelTweets, cfg, async (done, total) => {
        await setAnalysisState(tabId, {
          status: 'running',
          scannedTweetCount: allTweets.length,
          candidates: [],
          error: '',
          progressText: `已采集 ${allTweets.length} 条；AI 分析 ${done}/${total}；本地预过滤 ${prefilter.localResults.length} 个`
        });
      });
      results.push(...modelResults);

      // Detect coordinated copy-paste/auto-reply bots among tweets that still need model analysis.
      detectAutoReplyBots(prefilter.modelTweets, modelResults);
    }

    const newCandidates = normalizeCandidates(results, cfg.spamConfidenceThreshold);

    // 将已分析的用户加到缓存（包括本地预过滤和 LLM 分析的）
    const analyzedHandles = tweets.map(t => t.handle);
    addScannedUserHandles(tabId, analyzedHandles);

    // 与上次分析结果合并，避免多次点击只保留最新一批结果
    const prevState = await getAnalysisState(tabId);
    const prevCandidates = Array.isArray(prevState?.candidates) ? prevState.candidates : [];
    const merged = mergeCandidateLists(prevCandidates, newCandidates);

    await setAnalysisState(tabId, {
      status: merged.length > 0 ? 'done' : 'empty',
      scannedTweetCount: allTweets.length,
      candidates: merged,
      error: '',
      progressText: ''
    });
  } catch (e) {
    const prev = (await getAnalysisState(tabId)) || { scannedTweetCount: 0 };
    await setAnalysisState(tabId, {
      status: 'error',
      scannedTweetCount: prev.scannedTweetCount || 0,
      candidates: [],
      error: e.message || '分析失败',
      progressText: ''
    });
  } finally {
    runningTabs.delete(tabId);
  }
}

// ── Message handler ───────────────────────────────────────────────────────────

function getDeepScanStatusSnapshot() {
  return {
    running: deepScanState.running,
    paused: deepScanState.paused,
    handle: deepScanState.handle,
    postsCount: deepScanState.postsCount,
    repliesCount: deepScanState.repliesCount,
    candidatesCount: deepScanState.candidatesCount,
    currentStep: deepScanState.currentStep,
    completed: deepScanState.completed,
    candidates: deepScanState.candidates,
    error: deepScanState.error
  };
}

async function startDeepScan(config) {
  deepScanState.running = true;
  deepScanState.paused = false;
  deepScanState.cancelled = false;
  deepScanState.handle = config.handle || '';
  deepScanState.config = config;
  deepScanState.postsCount = 0;
  deepScanState.repliesCount = 0;
  deepScanState.repliesCollected = [];
  deepScanState.candidates = [];
  deepScanState.candidatesCount = 0;
  deepScanState.completed = false;
  deepScanState.currentStep = '正在初始化…';
  deepScanState.scannedPostUrls = new Set();
  deepScanState.error = '';

  try {
    const cfg = await getProviderConfig();
    await performDeepScan(cfg);
  } catch (e) {
    deepScanState.error = e.message;
    deepScanState.running = false;
  }
}

async function performDeepScan(cfg) {
  const handle = deepScanState.handle.replace('@', '');
  const maxPosts = deepScanState.config.maxPosts || 20;
  const maxRepliesPerPost = deepScanState.config.maxRepliesPerPost || 100;
  const maxTotalReplies = deepScanState.config.maxTotalReplies || 1000;

  console.log(`[DeepScan] 开始扫描 @${handle}, 配置: maxPosts=${maxPosts}, maxRepliesPerPost=${maxRepliesPerPost}, maxTotalReplies=${maxTotalReplies}`);

  try {
    deepScanState.currentStep = `正在打开 @${handle} 的主页…`;
    const profileUrl = `https://x.com/${handle}`;
    let workerTab = deepScanState.workerTabId ? await chrome.tabs.get(deepScanState.workerTabId).catch(() => null) : null;

    if (!workerTab) {
      workerTab = await tabsCreate(profileUrl, false);
      deepScanState.workerTabId = workerTab.id;
    } else {
      await tabsUpdate(workerTab.id, { url: profileUrl });
    }

    try {
      await waitForTabLoaded(workerTab.id, 15000);
    } catch (_) {}

    deepScanState.currentStep = '正在采集最近的帖子链接…';
    const postUrls = await collectUserPostLinks(workerTab.id, maxPosts, handle, cfg);
    console.log(`[DeepScan] 采集到 ${postUrls.length} 条帖子链接`);

    if (deepScanState.cancelled) {
      deepScanState.running = false;
      return;
    }

    deepScanState.postsCount = postUrls.length;
    deepScanState.currentStep = `已采集 ${postUrls.length} 条帖子，正在采集回复…`;

    // Process each post
    for (let i = 0; i < postUrls.length; i++) {
      if (deepScanState.cancelled) {
        deepScanState.running = false;
        return;
      }

      while (deepScanState.paused) {
        await sleep(500);
        if (deepScanState.cancelled) {
          deepScanState.running = false;
          return;
        }
      }

      const postUrl = postUrls[i];
      if (deepScanState.scannedPostUrls.has(postUrl)) continue;
      deepScanState.scannedPostUrls.add(postUrl);

      deepScanState.currentStep = `采集第 ${i + 1}/${postUrls.length} 条帖子的回复…`;
      await tabsUpdate(workerTab.id, { url: postUrl });

      try {
        await waitForTabLoaded(workerTab.id, 12000);
      } catch (_) {}

      const replies = await collectPostReplies(workerTab.id, maxRepliesPerPost, cfg);
      console.log(`[DeepScan] 第 ${i + 1} 条帖子采集到 ${replies.length} 条回复`);
      deepScanState.repliesCollected.push(...replies);
      deepScanState.repliesCount = deepScanState.repliesCollected.length;
      console.log(`[DeepScan] 累计回复数: ${deepScanState.repliesCount}`);

      if (deepScanState.repliesCount >= maxTotalReplies) {
        deepScanState.repliesCollected = deepScanState.repliesCollected.slice(0, maxTotalReplies);
        deepScanState.repliesCount = maxTotalReplies;
        console.log(`[DeepScan] 已达到总回复限制 ${maxTotalReplies}`);
        break;
      }

      await sleep(1500);
    }

    if (deepScanState.repliesCollected.length === 0) {
      console.log(`[DeepScan] 未找到任何回复`);
      deepScanState.running = false;
      deepScanState.currentStep = '未找到任何回复';
      deepScanState.completed = true;
      return;
    }

    // Filter out the OP (original poster)
    const opHandle = handle.toLowerCase();
    const filteredReplies = deepScanState.repliesCollected.filter(
      r => (r.handle || '').replace('@', '').toLowerCase() !== opHandle
    );
    console.log(`[DeepScan] 原始回复数: ${deepScanState.repliesCollected.length}, 排除OP后: ${filteredReplies.length}`);

    deepScanState.currentStep = `正在分析 ${filteredReplies.length} 条回复…`;
    const prefilter = splitObviousBotReplies(filteredReplies, cfg.obviousBotKeywords);
    console.log(`[DeepScan] 本地预过滤 - 明显机器人: ${prefilter.localResults.length}, 需要模型分析: ${prefilter.modelTweets.length}`);
    
    let results = [...prefilter.localResults];

    if (prefilter.modelTweets.length > 0) {
      const modelResults = await analyzeTweetsOptimized(prefilter.modelTweets, cfg);
      console.log(`[DeepScan] 模型分析 - 返回结果数: ${modelResults.length}`);
      results.push(...modelResults);
      detectAutoReplyBots(prefilter.modelTweets, modelResults);
      console.log(`[DeepScan] 自动回复检测后 - 总结果数: ${results.length}`);
    }

    deepScanState.candidates = normalizeCandidates(results, cfg.spamConfidenceThreshold);
    deepScanState.candidatesCount = deepScanState.candidates.length;
    console.log(`[DeepScan] 标准化候选人 (门槛: ${cfg.spamConfidenceThreshold}) - 最终: ${deepScanState.candidatesCount}`);
    deepScanState.candidates.forEach(c => {
      console.log(`  - ${c.handle} (${c.displayName}) 置信度: ${c.confidence.toFixed(2)}`);
    });
    deepScanState.currentStep = `扫描完成，找到 ${deepScanState.candidatesCount} 个疑似账号`;
    deepScanState.completed = true;

    // Add to block queue
    if (deepScanState.candidatesCount > 0) {
      enqueueBlockAccounts(deepScanState.candidates);
      runGlobalBlockQueue();
    }

    deepScanState.running = false;
    saveDeepScanState();
  } catch (e) {
    deepScanState.error = e.message;
    deepScanState.running = false;
    saveDeepScanState();
  } finally {
    // Clean up worker tab
    if (deepScanState.workerTabId) {
      try {
        await tabsRemove(deepScanState.workerTabId);
      } catch (_) {}
      deepScanState.workerTabId = null;
    }
  }
}

function continueDeepScan() {
  // Resume deep scan if paused
  if (deepScanState.paused && deepScanState.running) {
    deepScanState.paused = false;
  }
}

async function collectUserPostLinks(tabId, maxLinks = 20, targetHandle = '', cfg = {}) {
  const links = [];
  const linkSet = new Set();
  const maxRounds = normalizeScrapeMaxRounds(cfg.scrapeMaxRounds);
  const waitMs = normalizeScrapeScrollWaitMs(cfg.scrapeScrollWaitMs);
  const stagnantLimit = normalizeScrapeStagnantRounds(cfg.scrapeStagnantRounds);
  let lastCount = 0;
  let stagnantRounds = 0;
  // Normalise handle for path matching: "@foo" or "foo" → "/foo/"
  const handleSlug = targetHandle.replace(/^@/, '').toLowerCase();

  for (let i = 0; i < maxRounds; i++) {
    const result = await executeInTab(tabId, (slug) => {
      const posts = [];
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      articles.forEach(article => {
        try {
          const timeEl = article.querySelector('time');
          const statusA = timeEl ? timeEl.closest('a') : null;
          const statusPath = statusA ? statusA.getAttribute('href') || '' : '';
          // Bug 3 fix: only collect posts that belong to the target blogger.
          // A post URL follows the pattern "/{handle}/status/{id}", so we
          // verify the path starts with the expected user segment.
          if (!statusPath) return;
          const pathLower = statusPath.toLowerCase();
          const expectedPrefix = `/${slug}/status/`;
          if (!pathLower.startsWith(expectedPrefix)) return;
          const url = `https://x.com${statusPath}`;
          if (!posts.includes(url)) posts.push(url);
        } catch (_) {}
      });
      return posts;
    }, [handleSlug]).catch(() => []);

    result.forEach(link => {
      if (!linkSet.has(link)) {
        linkSet.add(link);
        links.push(link);
      }
    });

    if (links.length >= maxLinks) break;

    if (links.length <= lastCount) {
      stagnantRounds++;
      if (stagnantRounds >= stagnantLimit) break;
    } else {
      stagnantRounds = 0;
    }

    lastCount = links.length;
    await executeInTab(tabId, () => {
      window.scrollBy({ top: Math.max(window.innerHeight * 0.9, 800), behavior: 'auto' });
      return true;
    }).catch(() => {});
    const waitNextMs = stagnantRounds > 0 ? waitMs : Math.max(600, Math.round(waitMs * 0.82));
    await sleep(waitNextMs);
  }

  return links.slice(0, maxLinks);
}

/**
 * Poll until at least `minCount` article[data-testid="tweet"] elements exist
 * in the tab's DOM, or until `timeoutMs` elapses.
 * Returns true if the target count was reached, false on timeout.
 */
async function waitForRepliesRendered(tabId, minCount = 2, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = await executeInTab(tabId, () =>
      document.querySelectorAll('article[data-testid="tweet"]').length
    ).catch(() => 0);
    if (count >= minCount) return true;
    await sleep(300);
  }
  return false;
}

async function collectPostReplies(tabId, maxReplies = 100, cfg = {}) {
  // Bug 4 fix: we no longer deduplicate by handle across the entire function.
  // Each scroll round deduplicates only within itself (via the in-page `seen`
  // Set), but the same user can appear in multiple rounds with different tweet
  // texts. This lets detectAutoReplyBots() compare multiple messages per user
  // and identify copy-paste / template bots.
  const replies = [];
  // Track unique (handle, tweetUrl) pairs so we do not add the exact same
  // tweet twice (e.g. when the same article is still visible after a scroll).
  const seenKeys = new Set();
  const maxRounds = normalizeScrapeMaxRounds(cfg.scrapeMaxRounds);
  const waitMs = normalizeScrapeScrollWaitMs(cfg.scrapeScrollWaitMs);
  const stagnantLimit = normalizeScrapeStagnantRounds(cfg.scrapeStagnantRounds);
  let lastCount = 0;
  let stagnantRounds = 0;

  // X.com is a SPA: tab status=complete fires before React has rendered reply
  // articles. Wait until at least 2 articles are present (index 0 = original
  // tweet, index 1+ = replies) before starting the scroll loop.
  const repliesAppearTimeout = Math.max(15000, Math.round(waitMs * 8));
  const repliesAppeared = await waitForRepliesRendered(tabId, 2, repliesAppearTimeout);
  if (!repliesAppeared) {
    console.log('[DeepScan] collectPostReplies: 等待回复节点超时，跳过此帖');
    return [];
  }

  for (let i = 0; i < maxRounds; i++) {
    const result = await executeInTab(tabId, () => {
      const tweets = [];
      const articles = document.querySelectorAll('article[data-testid="tweet"]');
      // Deduplicate within this single DOM snapshot only.
      const seen = new Set();

      articles.forEach(article => {
        try {
          const userNameBlock = article.querySelector('[data-testid="User-Name"]');
          if (!userNameBlock) return;

          const profileAnchors = userNameBlock.querySelectorAll('a[href^="/"]');
          let handle = '';
          for (const a of profileAnchors) {
            const rawPath = a.getAttribute('href') || '';
            const slug = rawPath.replace(/^\//, '').split('/')[0].split('?')[0];
            const reserved = new Set(['home', 'explore', 'notifications', 'messages', 'search', 'compose', 'settings', 'i', 'tos', 'privacy', 'hashtag']);
            if (slug && !reserved.has(slug.toLowerCase())) {
              handle = `@${slug}`;
              break;
            }
          }

          if (!handle) return;

          const timeEl = article.querySelector('time');
          const statusA = timeEl ? timeEl.closest('a') : null;
          const statusPath = statusA ? statusA.getAttribute('href') || '' : '';
          const tweetUrl = statusPath ? `https://x.com${statusPath}` : '';

          // Deduplicate within this snapshot by (handle, tweetUrl).
          const snapKey = `${handle.toLowerCase()}|${tweetUrl}`;
          if (seen.has(snapKey)) return;
          seen.add(snapKey);

          let displayName = '';
          const spans = userNameBlock.querySelectorAll('span');
          for (const s of spans) {
            const t = (s.innerText || s.textContent).trim();
            if (t && !t.startsWith('@')) {
              displayName = t;
              break;
            }
          }

          const textEl = article.querySelector('[data-testid="tweetText"]');
          const text = textEl ? textEl.innerText.trim() : '';

          // #5 fix: keep media-only tweets (no text) with a placeholder
          // so image-spam bots are not silently skipped.
          const effectiveText = text || '[媒体内容/无文字推文]';
          tweets.push({
            handle,
            displayName,
            text: effectiveText,
            tweetUrl,
            profileUrl: `https://x.com/${handle.replace('@', '')}`
          });
        } catch (_) {}
      });

      return tweets;
    }).catch(() => []);

    // Merge into replies, deduplicating only by exact (handle, tweetUrl) key
    // so different tweets from the same user are all preserved.
    result.forEach(r => {
      const key = `${r.handle.toLowerCase()}|${r.tweetUrl}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        replies.push(r);
      }
    });

    if (replies.length >= maxReplies) break;

    if (replies.length <= lastCount) {
      stagnantRounds++;
      if (stagnantRounds >= stagnantLimit) break;
    } else {
      stagnantRounds = 0;
    }

    lastCount = replies.length;
    await executeInTab(tabId, () => {
      window.scrollBy({ top: Math.max(window.innerHeight * 0.8, 600), behavior: 'auto' });
      return true;
    }).catch(() => {});
    const waitNextMs = stagnantRounds > 0 ? waitMs : Math.max(600, Math.round(waitMs * 0.82));
    await sleep(waitNextMs);
  }

  return replies.slice(0, maxReplies);
}

// ── Tab 事件监听：页面分析缓存管理 ────────────────────────────────────────────
/**
 * 监听 tab URL 变化，清空旧缓存
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && pageAnalysisCache[tabId]) {
    const oldUrl = pageAnalysisCache[tabId].currentUrl;
    if (oldUrl !== tab.url) {
      console.log(`[Cache] Tab ${tabId} URL 变化，清空旧缓存`);
      clearPageAnalysisCache(tabId);
      initPageAnalysisCache(tabId, tab.url);
    }
  }
});

/**
 * 监听 tab 关闭，清空缓存
 */
chrome.tabs.onRemoved.addListener(tabId => {
  clearPageAnalysisCache(tabId);
});

// ── Message handler ───────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === 'backgroundUiBlock') {
    blockViaHiddenTab(msg.handle)
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'enqueueGlobalBlockAccounts') {
    const added = enqueueBlockAccounts(msg.accounts || []);
    runGlobalBlockQueue();
    sendResponse({ ok: true, added, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'enqueueGlobalBlockText') {
    const accounts = parseHandlesFromText(msg.text || '');
    const added = enqueueBlockAccounts(accounts);
    runGlobalBlockQueue();
    sendResponse({ ok: true, added, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'getGlobalBlockStatus') {
    sendResponse({ ok: true, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'retryFailedGlobalBlocking') {
    const retried = retryFailedBlockItems(); // recalcTotals → saveBlockQueueState inside
    if (retried > 0) {
      runGlobalBlockQueue();
    }
    sendResponse({ ok: true, retried, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'clearDoneGlobalBlocking') {
    const cleared = clearCompletedBlockItems(); // recalcTotals → saveBlockQueueState inside
    sendResponse({ ok: true, cleared, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'clearDeepScanCompleted') {
    deepScanState.completed       = false;
    deepScanState.candidates      = [];
    deepScanState.candidatesCount = 0;
    deepScanState.error           = '';
    deepScanState.currentStep     = '';
    saveDeepScanState();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'pauseGlobalBlocking') {
    blockQueue.paused   = true;
    saveBlockQueueState();
    sendResponse({ ok: true, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'resumeGlobalBlocking') {
    blockQueue.paused   = false;
    blockQueue.errorMsg = '';
    blockQueue.consecutiveFails = 0;
    saveBlockQueueState();
    runGlobalBlockQueue();
    sendResponse({ ok: true, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'startAnalysisForTab') {
    if (runningTabs.has(msg.tabId)) {
      getAnalysisState(msg.tabId)
        .then(state => sendResponse({
          ok: true,
          alreadyRunning: true,
          state: state || {
            status: 'running',
            scannedTweetCount: 0,
            candidates: [],
            error: '',
            progressText: '分析任务仍在运行…'
          }
        }))
        .catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
    }

    getProviderConfig()
      .then(cfg => {
        const issue = getProviderConfigIssue(cfg);
        if (issue) {
          sendResponse({ ok: false, needsConfig: true, error: issue });
          return;
        }
        startAnalysisForTab(msg.tabId);
        sendResponse({ ok: true, started: true });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'getProviderConfigStatus') {
    getProviderConfig()
      .then(cfg => {
        const issue = getProviderConfigIssue(cfg);
        sendResponse({ ok: true, configured: !issue, issue });
      })
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'testProviderConfig') {
    testProviderConfig()
      .then(result => sendResponse({ ok: true, result }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'getAnalysisForTab') {
    getAnalysisState(msg.tabId)
      .then(state => sendResponse({ ok: true, state }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'clearAnalysisForTab') {
    if (runningTabs.has(msg.tabId)) {
      sendResponse({ ok: false, error: '分析任务仍在运行，暂不能清理状态。' });
      return false;
    }

    // 清空分析缓存和页面分析缓存
    clearPageAnalysisCache(msg.tabId);
    
    storageRemove([analysisKey(msg.tabId)])
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Backward compatibility with older popup flow.
  if (msg.action === 'analyzeTweets') {
    getProviderConfig()
      .then(async cfg => {
        const tweets = msg.tweets || [];
        const prefilter = splitObviousBotReplies(tweets, cfg.obviousBotKeywords);
        const modelResults = prefilter.modelTweets.length > 0
          ? await analyzeTweetsOptimized(prefilter.modelTweets, cfg)
          : [];
        if (modelResults.length > 0) {
          detectAutoReplyBots(prefilter.modelTweets, modelResults);
        }
        return normalizeCandidates(prefilter.localResults.concat(modelResults), cfg.spamConfidenceThreshold);
      })
      .then(results => sendResponse({ ok: true, results }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  // Deep Scan
  if (msg.action === 'startDeepScan') {
    if (deepScanState.running) {
      sendResponse({ ok: false, error: '深度扫描已在运行中' });
      return false;
    }
    startDeepScan(msg.config);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'getDeepScanStatus') {
    sendResponse({ ok: true, status: getDeepScanStatusSnapshot() });
    return false;
  }

  if (msg.action === 'pauseDeepScan') {
    deepScanState.paused = true;
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'resumeDeepScan') {
    deepScanState.paused = false;
    if (!deepScanState.running) {
      // Resume the deep scan task
      continueDeepScan();
    }
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'cancelDeepScan') {
    deepScanState.cancelled = true;
    deepScanState.running = false;
    sendResponse({ ok: true });
    return false;
  }
});
