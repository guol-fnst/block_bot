/* Block Bot – background service worker
 * Handles: LLM analysis (multi-provider), tab-scoped analysis jobs,
 * and persisted analysis cache so popup can be reopened without losing results.
 */
'use strict';

const BATCH_SIZE = 15;
const CONFIDENCE_THRESHOLD = 0.8;
const ANALYSIS_KEY_PREFIX = 'analysisCache:';

const GEMINI_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-1.5-flash'
];

const runningTabs = new Set();

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

function geminiUrl(model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

function analysisKey(tabId) {
  return `${ANALYSIS_KEY_PREFIX}${tabId}`;
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

function storageGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function storageSet(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

function storageRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

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
      await tabsUpdate(blockQueue.workerTabId, { active: false });
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
          document.querySelector('button[aria-label*="更多"]');

        if (!moreBtn) {
          return { ok: false, error: `后台页未找到用户操作按钮 @${slug}` };
        }

        moreBtn.click();
        await sleep(260);

        const blockItem =
          (await waitFor('[data-testid="block"]', 4500)) ||
          document.querySelector('[role="menuitem"][aria-label*="Block"]') ||
          document.querySelector('[role="menuitem"][aria-label*="屏蔽"]');

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
  blockQueue.total = blockQueue.queue.length;
  blockQueue.done = blockQueue.queue.filter(i => i.status === 'done').length;
  blockQueue.failed = blockQueue.queue.filter(i => i.status === 'failed').length;
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
  const CONSECUTIVE_FAIL_LIMIT = 2;
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

        if (blockQueue.consecutiveFails >= CONSECUTIVE_FAIL_LIMIT) {
          blockQueue.paused = true;
          blockQueue.errorMsg = `连续 ${CONSECUTIVE_FAIL_LIMIT} 次失败，已自动暂停。`;
        }
      }

      recalcTotals();
      if (blockQueue.paused) break;

      const hasPending = blockQueue.queue.some(i => i.status === 'pending');
      if (hasPending) {
        // Faster randomized pace requested by user.
        await sleep(1000 + Math.random() * 2000);
      }
    }
  } finally {
    blockQueue.running = false;
    blockQueue.current = null;
    await cleanupWorkerTab();
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
  const tweetsJson = JSON.stringify(
    batch.map(t => ({
      handle: t.handle,
      displayName: t.displayName,
      text: t.text,
      hasUrl: /https?:\/\//.test(t.text),
      isReply: t.text.startsWith('@'),
      textLength: t.text.length,
      charDiversity: new Set(t.text).size // Rough indicator of vocab diversity
    })),
    null,
    2
  );

  const rules = String(customDetectionPrompt || '').trim() || defaultDetectionRules();

  return (
    '你是一个 Twitter/X 垃圾账号检测助手。请分析以下推文列表，判断每个账号是否疑似' +
    '垃圾账号、广告号或机器人号。\n\n' +
    '推文数据：\n' + tweetsJson + '\n\n' +
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

async function getProviderConfig() {
  const d = await storageGet([
    'llmProvider',
    'geminiApiKey',
    'geminiModel',
    'openaiApiKey',
    'openaiApiUrl',
    'openaiModel',
    'customDetectionPrompt'
  ]);

  const provider = d.llmProvider || 'gemini';
  return {
    provider,
    geminiApiKey: d.geminiApiKey || '',
    geminiModel: d.geminiModel || 'auto',
    openaiApiKey: d.openaiApiKey || '',
    openaiApiUrl: d.openaiApiUrl || '',
    openaiModel: d.openaiModel || '',
    customDetectionPrompt: d.customDetectionPrompt || ''
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
      const resp = await fetch(`${geminiUrl(model)}?key=${encodeURIComponent(cfg.geminiApiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

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

  const resp = await fetch(cfg.openaiApiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${cfg.openaiApiKey}`
    },
    body: JSON.stringify(body)
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`OpenAI 兼容 API 错误 (HTTP ${resp.status}): ${errText.slice(0, 200)}`);
  }

  const data = await resp.json();
  const rawText = data?.choices?.[0]?.message?.content || '[]';
  return parseArrayFromModelText(rawText);
}

async function analyzeBatch(batch, cfg) {
  if (cfg.provider === 'gemini') {
    return analyzeBatchWithGemini(batch, cfg);
  }
  if (cfg.provider === 'deepseek' || cfg.provider === 'qwen' || cfg.provider === 'openai_compat') {
    return analyzeBatchWithOpenAICompatible(batch, cfg);
  }
  return analyzeBatchWithOpenAICompatible(batch, cfg);
}

function shouldFallbackToChunk(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('context') || msg.includes('token') || msg.includes('too large') || msg.includes('413');
}

async function analyzeTweetsOptimized(tweets, cfg, onProgress) {
  if (!tweets || tweets.length === 0) return [];

  // Prefer one-shot full analysis to reduce per-request overhead/token boilerplate.
  try {
    const all = await analyzeBatch(tweets, cfg);
    if (onProgress) {
      await onProgress(tweets.length, tweets.length);
    }
    return all;
  } catch (e) {
    if (!shouldFallbackToChunk(e)) {
      throw e;
    }
  }

  // Fallback only when context/token size is too large.
  const results = [];
  for (let i = 0; i < tweets.length; i += BATCH_SIZE) {
    const batch = tweets.slice(i, i + BATCH_SIZE);
    const batchResults = await analyzeBatch(batch, cfg);
    results.push(...batchResults);

    if (onProgress) {
      const done = Math.min(i + BATCH_SIZE, tweets.length);
      await onProgress(done, tweets.length);
    }

    if (i + BATCH_SIZE < tweets.length) {
      await sleep(700);
    }
  }
  return results;
}

// Simple Levenshtein-like similarity score for detecting near-duplicate messages
function calcTextSimilarity(text1, text2) {
  if (!text1 || !text2) return 0;
  const s1 = String(text1).trim().toLowerCase();
  const s2 = String(text2).trim().toLowerCase();
  if (s1 === s2) return 1;
  
  // Extract "significant words" - ignore single chars and common words
  const words1 = s1.match(/\w{3,}/g) || [];
  const words2 = s2.match(/\w{3,}/g) || [];
  if (words1.length === 0 || words2.length === 0) return 0;
  
  const common = new Set(words1).size === 0 ? 0 :
    words1.filter(w => words2.includes(w)).length;
  const totalWords = Math.max(words1.length, words2.length);
  return common / totalWords;
}

// Detect copy-paste/auto-reply patterns: accounts with near-identical messages
function detectAutoReplyBots(batch, results) {
  if (!batch || !results || batch.length < 2) return;
  
  // Group results by tweet similarity
  const tweetsWithResults = batch
    .map((tweet, i) => ({
      tweet: tweet.text || '',
      handle: tweet.handle,
      result: results[i]
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

function normalizeCandidates(results) {
  const filtered = results.filter(r => r.isSpamOrBot && r.confidence >= CONFIDENCE_THRESHOLD);
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
        selected: true
      };
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
    await setAnalysisState(tabId, {
      status: 'running',
      scannedTweetCount: 0,
      candidates: [],
      error: '',
      progressText: '正在采集推文…'
    });

    const scrapeResp = await withTimeout(
      sendToTabSafe(tabId, { action: 'scrapeTweets' }),
      15000,
      '采集超时，请刷新页面后重试'
    );
    if (!scrapeResp?.ok) {
      throw new Error(scrapeResp?.error || '采集失败');
    }

    const tweets = scrapeResp.tweets || [];
    if (tweets.length === 0) {
      await setAnalysisState(tabId, {
        status: 'empty',
        scannedTweetCount: 0,
        candidates: [],
        error: '',
        progressText: ''
      });
      return;
    }

    await setAnalysisState(tabId, {
      status: 'running',
      scannedTweetCount: tweets.length,
      candidates: [],
      error: '',
      progressText: `正在分析 ${tweets.length} 条推文…`
    });

    const cfg = await getProviderConfig();
    const results = await analyzeTweetsOptimized(tweets, cfg, async (done, total) => {
      await setAnalysisState(tabId, {
        status: 'running',
        scannedTweetCount: total,
        candidates: [],
        error: '',
        progressText: `正在分析：${done}/${total}`
      });
    });

    // Detect coordinated copy-paste/auto-reply bots (multiple similar tweets)
    detectAutoReplyBots(tweets, results);

    const candidates = normalizeCandidates(results);
    await setAnalysisState(tabId, {
      status: candidates.length > 0 ? 'done' : 'empty',
      scannedTweetCount: tweets.length,
      candidates,
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

  if (msg.action === 'pauseGlobalBlocking') {
    blockQueue.paused = true;
    blockQueue.running = false;
    blockQueue.current = null;
    sendResponse({ ok: true, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'resumeGlobalBlocking') {
    blockQueue.paused = false;
    blockQueue.errorMsg = '';
    runGlobalBlockQueue();
    sendResponse({ ok: true, status: getBlockStatusSnapshot() });
    return false;
  }

  if (msg.action === 'startAnalysisForTab') {
    startAnalysisForTab(msg.tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (msg.action === 'getAnalysisForTab') {
    getAnalysisState(msg.tabId)
      .then(state => sendResponse({ ok: true, state }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }

  if (msg.action === 'clearAnalysisForTab') {
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
        const all = await analyzeTweetsOptimized(tweets, cfg);
        return normalizeCandidates(all);
      })
      .then(results => sendResponse({ ok: true, results }))
      .catch(e => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
