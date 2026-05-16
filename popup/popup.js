'use strict';

const views = {
  notX:               document.getElementById('view-not-x'),
  idle:               document.getElementById('view-idle'),
  scanning:           document.getElementById('view-scanning'),
  noResults:          document.getElementById('view-no-results'),
  results:            document.getElementById('view-results'),
  deepScanProgress:   document.getElementById('view-deep-scan-progress')
};

let currentTabId = null;
let isXTab = false;
let candidates = [];
let scannedTweetCount = 0;
let analysisPollTimer = null;
let queuePollTimer = null;

function isSupportedXUrl(url) {
  try {
    const u = new URL(url || '');
    const h = (u.hostname || '').toLowerCase();
    return h === 'x.com' || h === 'www.x.com' || h === 'twitter.com' || h === 'www.twitter.com';
  } catch (_) {
    return false;
  }
}

function showView(name) {
  Object.values(views).forEach(v => {
    if (v) v.classList.add('hidden');
  });
  if (views[name]) {
    views[name].classList.remove('hidden');
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function confidenceClass(c) {
  if (c >= 0.9) return 'high';
  if (c >= 0.8) return 'medium';
  return 'low';
}

function stopAnalysisPolling() {
  if (analysisPollTimer) { clearInterval(analysisPollTimer); analysisPollTimer = null; }
}

function stopQueuePolling() {
  if (queuePollTimer) { clearInterval(queuePollTimer); queuePollTimer = null; }
}

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

async function getAnalysisState() {
  const resp = await chrome.runtime.sendMessage({ action: 'getAnalysisForTab', tabId: currentTabId });
  if (!resp?.ok) throw new Error(resp?.error || '读取分析状态失败');
  return resp.state || null;
}

async function clearAnalysisState() {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'clearAnalysisForTab', tabId: currentTabId });
    return Boolean(resp?.ok);
  } catch (_) {}
  return false;
}

async function getGlobalQueueStatus() {
  const resp = await chrome.runtime.sendMessage({ action: 'getGlobalBlockStatus' });
  if (!resp?.ok) throw new Error(resp?.error || '读取屏蔽队列失败');
  return resp.status;
}

async function getProviderConfigStatus() {
  const resp = await chrome.runtime.sendMessage({ action: 'getProviderConfigStatus' });
  if (!resp?.ok) throw new Error(resp?.error || '读取模型配置失败');
  return resp;
}

function renderQueueStatus(s) {
  const msgEl = document.getElementById('queue-msg');
  const detailEl = document.getElementById('queue-detail');
  const bar = document.getElementById('queue-progress-bar');
  const logEl = document.getElementById('queue-log');
  const pauseBtn = document.getElementById('btn-queue-pause');
  const resumeBtn = document.getElementById('btn-queue-resume');
  const retryFailedBtn = document.getElementById('btn-queue-retry-failed');
  const clearDoneBtn = document.getElementById('btn-queue-clear-done');

  const pending = (s.queue || []).filter(i => i.status === 'pending').length;
  const failed = Number(s.failed || 0);
  const done = Number(s.done || 0);
  const runningText = s.paused ? '已暂停' : (s.running ? '运行中' : '空闲');
  msgEl.textContent = `屏蔽任务：${runningText}（待处理 ${pending}）`;
  const baseDetail = s.current
    ? `当前：${s.current} ｜ 成功 ${s.done} ｜ 失败 ${s.failed}`
    : `成功 ${s.done} ｜ 失败 ${s.failed} ｜ 总计 ${s.total}`;
  detailEl.textContent = s.errorMsg ? `${baseDetail} ｜ ${s.errorMsg}` : baseDetail;

  const pct = s.total > 0 ? ((s.done + s.failed) / s.total) * 100 : 0;
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;

  logEl.innerHTML = '';
  (s.log || []).slice(-8).reverse().forEach(entry => {
    const li = document.createElement('li');
    li.className = `log-item log-${entry.status}`;
    li.textContent = entry.status === 'done'
      ? `✓ ${entry.handle}`
      : `✗ ${entry.handle}：${entry.error || '失败'}`;
    logEl.appendChild(li);
  });

  pauseBtn.disabled = !s.running || s.paused;
  resumeBtn.disabled = !s.paused || pending === 0;
  retryFailedBtn.disabled = s.running || failed === 0;
  clearDoneBtn.disabled = s.running || done === 0;
}

async function refreshQueueStatus() {
  try {
    const s = await getGlobalQueueStatus();
    renderQueueStatus(s);
  } catch (_) {}
}

function startQueuePolling() {
  stopQueuePolling();
  refreshQueueStatus();
  queuePollTimer = setInterval(refreshQueueStatus, 900);
}

async function init() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  currentTabId = tab?.id || null;
  isXTab = Boolean(tab && isSupportedXUrl(tab.url));

  startQueuePolling();

  // ── Deep Scan recovery ────────────────────────────────────────────────────
  // Deep Scan runs in the background service worker and is independent of
  // whichever tab the user is currently viewing.  Check its state FIRST,
  // before any isXTab guard, so switching to a non-X tab does not lose
  // the progress view.
  try {
    const ds = await getDeepScanStatus();
    if (ds.running || ds.completed || ds.error) {
      // Update the inline analyze button state even if we are about to
      // show the deep scan view (keeps the button consistent on return).
      const inlineAnalyzeBtn = document.getElementById('btn-analyze-inline');
      if (inlineAnalyzeBtn) {
        inlineAnalyzeBtn.disabled = !isXTab;
        inlineAnalyzeBtn.textContent = isXTab ? '开始分析当前页面' : '请先切到 X 页面';
      }
      showView('deepScanProgress');
      renderDeepScanStatus(ds);
      if (ds.running) {
        startDeepScanPolling();
      }
      return;
    }
  } catch (_) {}
  // ── End Deep Scan recovery ────────────────────────────────────────────────

  // Keep analysis entry visible by default unless explicitly set otherwise.
  showView(isXTab ? 'idle' : 'notX');

  const inlineAnalyzeBtn = document.getElementById('btn-analyze-inline');
  if (inlineAnalyzeBtn) {
    inlineAnalyzeBtn.disabled = !isXTab;
    inlineAnalyzeBtn.textContent = isXTab ? '开始分析当前页面' : '请先切到 X 页面';
  }

  if (!isXTab) {
    showView('notX');
    return;
  }

  await renderConfigHintIfNeeded();

  try {
    const state = await getAnalysisState();
    if (state) {
      applyAnalysisState(state);
      if (state.status === 'running') {
        startAnalysisPolling();
      }
      return;
    }
  } catch (_) {}

  showView('idle');
}

async function renderConfigHintIfNeeded() {
  try {
    const status = await getProviderConfigStatus();
    const btn = document.getElementById('btn-analyze-inline');
    if (!status.configured && btn) {
      btn.textContent = '先配置模型服务';
    }
  } catch (_) {}
}

async function startAnalysis() {
  if (!isXTab || !currentTabId) {
    showNotice('当前标签页不是 X 站点页面，请切到 x.com / twitter.com 页面后重试。', true);
    return;
  }

  stopAnalysisPolling();
  showView('scanning');
  setScanMsg('正在启动分析任务…');

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'startAnalysisForTab', tabId: currentTabId });
    if (!resp?.ok) {
      if (resp?.needsConfig) {
        showNotice(resp.error || '请先配置模型服务。', true, true);
        return;
      }
      throw new Error(resp?.error || '启动分析失败');
    }
    if (resp.alreadyRunning && resp.state) {
      applyAnalysisState(resp.state);
      startAnalysisPolling();
      return;
    }

    // Pull one immediate state update so UI doesn't appear stuck on startup text.
    const state = await getAnalysisState();
    if (state) {
      applyAnalysisState(state);
    } else {
      setScanMsg('正在采集推文…');
    }
  } catch (e) {
    showNotice('⚠️ 启动分析失败：' + e.message, true);
    return;
  }

  startAnalysisPolling();
}

async function retryAnalysis() {
  stopAnalysisPolling();
  candidates = [];

  const state = await getAnalysisState().catch(() => null);
  if (state?.status === 'running') {
    applyAnalysisState(state);
    startAnalysisPolling();
    return;
  }

  await clearAnalysisState();
  await startAnalysis();
}

function setScanMsg(msg) {
  document.getElementById('scanning-msg').textContent = msg;
}

function showNotice(msg, isError, showOptionsButton = false) {
  document.getElementById('no-results-icon').textContent = isError ? '⚠️' : '✅';
  document.getElementById('no-results-msg').textContent = msg;
  document.getElementById('btn-open-options-from-notice').classList.toggle('hidden', !showOptionsButton);
  document.getElementById('btn-retry').classList.toggle('hidden', Boolean(showOptionsButton));
  showView('noResults');
}

function applyAnalysisState(state) {
  if (!state) {
    showView(isXTab ? 'idle' : 'notX');
    return;
  }

  if (state.status === 'running') {
    showView('scanning');
    setScanMsg(state.progressText || '正在分析…');
    return;
  }

  if (state.status === 'error') {
    showNotice('⚠️ 分析失败：' + (state.error || '未知错误'), true);
    return;
  }

  if (state.status === 'empty') {
    const n = Number(state.scannedTweetCount || 0);
    showNotice(
      n > 0
        ? `扫描了 ${n} 条推文，未发现疑似垃圾账号。`
        : '当前页面未找到推文，请确认页面已加载内容后重试。',
      false
    );
    return;
  }

  if (state.status === 'done') {
    scannedTweetCount = Number(state.scannedTweetCount || 0);
    candidates = Array.isArray(state.candidates)
      ? state.candidates.map(c => ({
          ...c,
          selected: typeof c.selected === 'boolean'
            ? c.selected
            : Number(c.confidence || 0) >= 0.9
        }))
      : [];
    if (candidates.length === 0) {
      showNotice(`扫描了 ${scannedTweetCount} 条推文，未发现疑似垃圾账号。`, false);
      return;
    }
    renderResults();
    return;
  }

  showView(isXTab ? 'idle' : 'notX');
}

function startAnalysisPolling() {
  stopAnalysisPolling();
  analysisPollTimer = setInterval(async () => {
    try {
      const state = await getAnalysisState();
      if (!state) {
        stopAnalysisPolling();
        showView('idle');
        return;
      }

      applyAnalysisState(state);
      if (state.status !== 'running') {
        stopAnalysisPolling();
      }
    } catch (_) {}
  }, 900);
}

function renderResults() {
  const selectedCount = candidates.filter(c => c.selected).length;
  document.getElementById('result-count').innerHTML =
    `发现 <strong>${candidates.length}</strong> 个疑似账号，已勾选 ${selectedCount} 个高置信项`;
  document.getElementById('tweet-count').textContent =
    `（扫描了 ${scannedTweetCount} 条推文）`;

  const list = document.getElementById('candidate-list');
  list.innerHTML = '';

  candidates.forEach((c, i) => {
    const li = document.createElement('li');
    li.className = 'candidate-item';
    li.innerHTML = `
      <label class="candidate-label">
        <input type="checkbox" class="candidate-check" data-idx="${i}" ${c.selected ? 'checked' : ''} />
        <div class="candidate-info">
          <div class="candidate-header">
            <span class="candidate-handle">${escapeHtml(c.handle)}</span>
            <span class="candidate-name">${escapeHtml(c.displayName || '')}</span>
            <span class="confidence confidence-${confidenceClass(c.confidence)}">${Math.round(c.confidence * 100)}%</span>
          </div>
          ${(c.evidenceTweet || '').trim() ? `<div class="candidate-evidence">“${escapeHtml(c.evidenceTweet.trim())}”</div>` : ''}
        </div>
      </label>`;
    list.appendChild(li);
  });

  list.querySelectorAll('.candidate-check').forEach(cb => {
    cb.addEventListener('change', e => {
      candidates[parseInt(e.target.dataset.idx, 10)].selected = e.target.checked;
      updateConfirmBtn();
    });
  });

  updateConfirmBtn();
  showView('results');
}

function updateConfirmBtn() {
  const n = candidates.filter(c => c.selected).length;
  const btn = document.getElementById('btn-confirm-block');
  btn.textContent = n > 0 ? `加入屏蔽任务列表（${n}）` : '加入屏蔽任务列表';
  btn.disabled = n === 0;
}

async function addSelectedToQueue() {
  const selected = candidates.filter(c => c.selected);
  if (selected.length === 0) return;

  try {
    const resp = await chrome.runtime.sendMessage({ action: 'enqueueGlobalBlockAccounts', accounts: selected });
    if (!resp?.ok) throw new Error(resp?.error || '加入队列失败');
    await refreshQueueStatus();

    // Close analysis result view after enqueueing; blocking continues in background queue.
    await clearAnalysisState();
    stopAnalysisPolling();
    candidates = [];
    showView(isXTab ? 'idle' : 'notX');
  } catch (e) {
    showNotice('⚠️ 加入队列失败：' + e.message, true);
  }
}

// ── Deep Scan ──────────────────────────────────────────────────────────────

let deepScanState = null;
let deepScanPollTimer = null;

function stopDeepScanPolling() {
  if (deepScanPollTimer) { clearInterval(deepScanPollTimer); deepScanPollTimer = null; }
}

function openDeepScanModal() {
  document.getElementById('modal-deep-scan').classList.remove('hidden');
}

function closeDeepScanModal() {
  document.getElementById('modal-deep-scan').classList.add('hidden');
}

async function startDeepScan() {
  const handle = (document.getElementById('deep-scan-handle').value || '').trim();
  const maxPosts = parseInt(document.getElementById('deep-scan-posts').value, 10) || 20;
  const maxRepliesPerPost = parseInt(document.getElementById('deep-scan-replies').value, 10) || 100;
  const maxTotalReplies = parseInt(document.getElementById('deep-scan-total').value, 10) || 1000;

  if (!handle) {
    alert('请输入博主 Handle（如 @xxx）');
    return;
  }

  closeDeepScanModal();
  showView('deepScanProgress');
  deepScanState = { postsCount: 0, repliesCount: 0, candidatesCount: 0 };

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'startDeepScan',
      config: {
        handle,
        maxPosts,
        maxRepliesPerPost,
        maxTotalReplies
      }
    });

    if (!resp?.ok) {
      showNotice('⚠️ 深度扫描失败：' + (resp?.error || '未知错误'), true);
      return;
    }

    startDeepScanPolling();
  } catch (e) {
    showNotice('⚠️ 启动深度扫描失败：' + e.message, true);
  }
}

async function getDeepScanStatus() {
  const resp = await chrome.runtime.sendMessage({ action: 'getDeepScanStatus' });
  if (!resp?.ok) throw new Error(resp?.error || '读取扫描状态失败');
  return resp.status;
}

function renderDeepScanStatus(status) {
  const msgEl = document.getElementById('deep-scan-msg');
  const postsEl = document.getElementById('deep-scan-posts-count');
  const repliesEl = document.getElementById('deep-scan-replies-count');
  const candidatesEl = document.getElementById('deep-scan-candidates-count');
  const pauseBtn = document.getElementById('btn-deep-scan-pause');
  const cancelBtn = document.getElementById('btn-deep-scan-cancel');

  msgEl.textContent = status.currentStep || '正在采集…';
  postsEl.textContent = status.postsCount || 0;
  repliesEl.textContent = status.repliesCount || 0;
  candidatesEl.textContent = status.candidatesCount || 0;

  pauseBtn.disabled = !status.running || status.paused;
  cancelBtn.disabled = !status.running;

  if (!status.running && status.error) {
    stopDeepScanPolling();
    showNotice('⚠️ 深度扫描失败：' + status.error, true);
    return;
  }

  if (status.completed) {
    stopDeepScanPolling();
    if (status.candidates && status.candidates.length > 0) {
      // Show results and add to queue
      scannedTweetCount = status.repliesCount;
      candidates = (status.candidates || []).map(c => ({ ...c, selected: true }));
      renderResults();
    } else {
      showNotice(`深度扫描完成，未找到疑似账号。`, false);
    }
    // Clear the completed flag in the background so re-opening the popup
    // does not replay the same results again.
    chrome.runtime.sendMessage({ action: 'clearDeepScanCompleted' }).catch(() => {});
  }
}

function startDeepScanPolling() {
  stopDeepScanPolling();
  deepScanPollTimer = setInterval(async () => {
    try {
      const status = await getDeepScanStatus();
      renderDeepScanStatus(status);
    } catch (_) {}
  }, 800);
}

async function pauseDeepScan() {
  try {
    await chrome.runtime.sendMessage({ action: 'pauseDeepScan' });
  } catch (_) {}
}

async function resumeDeepScan() {
  try {
    await chrome.runtime.sendMessage({ action: 'resumeDeepScan' });
  } catch (_) {}
}

async function cancelDeepScan() {
  try {
    await chrome.runtime.sendMessage({ action: 'cancelDeepScan' });
    stopDeepScanPolling();
    showView(isXTab ? 'idle' : 'notX');
  } catch (_) {}
}

async function pauseQueue() {
  await chrome.runtime.sendMessage({ action: 'pauseGlobalBlocking' });
  refreshQueueStatus();
}

async function resumeQueue() {
  await chrome.runtime.sendMessage({ action: 'resumeGlobalBlocking' });
  refreshQueueStatus();
}

async function retryFailedQueue() {
  await chrome.runtime.sendMessage({ action: 'retryFailedGlobalBlocking' });
  refreshQueueStatus();
}

async function clearDoneQueue() {
  await chrome.runtime.sendMessage({ action: 'clearDoneGlobalBlocking' });
  refreshQueueStatus();
}

bindClick('btn-options', () => {
  chrome.runtime.openOptionsPage();
});
bindClick('btn-open-options-from-notice', () => {
  chrome.runtime.openOptionsPage();
});

bindClick('btn-analyze', startAnalysis);
bindClick('btn-analyze-inline', startAnalysis);

bindClick('btn-retry', retryAnalysis);

bindClick('btn-select-all', () => {
  candidates.forEach(c => { c.selected = true; });
  renderResults();
});

bindClick('btn-select-high', () => {
  candidates.forEach(c => { c.selected = Number(c.confidence || 0) >= 0.9; });
  renderResults();
});

bindClick('btn-deselect-all', () => {
  candidates.forEach(c => { c.selected = false; });
  renderResults();
});

bindClick('btn-confirm-block', addSelectedToQueue);

bindClick('btn-cancel-results', () => {
  clearAnalysisState();
  stopAnalysisPolling();
  candidates = [];
  showView('idle');
});

bindClick('btn-queue-pause', pauseQueue);
bindClick('btn-queue-resume', resumeQueue);
bindClick('btn-queue-retry-failed', retryFailedQueue);
bindClick('btn-queue-clear-done', clearDoneQueue);

// Deep Scan bindings
bindClick('btn-deep-scan', openDeepScanModal);
bindClick('modal-close-deep-scan', closeDeepScanModal);
bindClick('btn-modal-cancel', closeDeepScanModal);
bindClick('btn-modal-start-deep-scan', startDeepScan);
bindClick('btn-deep-scan-pause', pauseDeepScan);
bindClick('btn-deep-scan-cancel', cancelDeepScan);

// Modal close on backdrop click
document.getElementById('modal-deep-scan').addEventListener('click', e => {
  if (e.target.id === 'modal-deep-scan') closeDeepScanModal();
});

init().catch(() => {
  // Last-resort fallback: do not block manual analysis entry.
  showView('idle');
});
