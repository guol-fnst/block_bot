'use strict';

const views = {
  notX:       document.getElementById('view-not-x'),
  idle:       document.getElementById('view-idle'),
  scanning:   document.getElementById('view-scanning'),
  noResults:  document.getElementById('view-no-results'),
  results:    document.getElementById('view-results')
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
    await chrome.runtime.sendMessage({ action: 'clearAnalysisForTab', tabId: currentTabId });
  } catch (_) {}
}

async function getGlobalQueueStatus() {
  const resp = await chrome.runtime.sendMessage({ action: 'getGlobalBlockStatus' });
  if (!resp?.ok) throw new Error(resp?.error || '读取屏蔽队列失败');
  return resp.status;
}

function renderQueueStatus(s) {
  const msgEl = document.getElementById('queue-msg');
  const detailEl = document.getElementById('queue-detail');
  const bar = document.getElementById('queue-progress-bar');
  const logEl = document.getElementById('queue-log');
  const pauseBtn = document.getElementById('btn-queue-pause');
  const resumeBtn = document.getElementById('btn-queue-resume');

  const pending = (s.queue || []).filter(i => i.status === 'pending').length;
  const runningText = s.running ? '运行中' : (s.paused ? '已暂停' : '空闲');
  msgEl.textContent = `屏蔽任务：${runningText}（待处理 ${pending}）`;
  detailEl.textContent = s.current
    ? `当前：${s.current} ｜ 成功 ${s.done} ｜ 失败 ${s.failed}`
    : `成功 ${s.done} ｜ 失败 ${s.failed} ｜ 总计 ${s.total}`;

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

  pauseBtn.disabled = !s.running;
  resumeBtn.disabled = s.running || pending === 0;
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
    if (!resp?.ok) throw new Error(resp?.error || '启动分析失败');

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

function setScanMsg(msg) {
  document.getElementById('scanning-msg').textContent = msg;
}

function showNotice(msg, isError) {
  document.getElementById('no-results-icon').textContent = isError ? '⚠️' : '✅';
  document.getElementById('no-results-msg').textContent = msg;
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
    candidates = Array.isArray(state.candidates) ? state.candidates.map(c => ({ ...c })) : [];
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
  document.getElementById('result-count').innerHTML =
    `发现 <strong>${candidates.length}</strong> 个疑似账号`;
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
          <div class="candidate-reason">${escapeHtml(c.reason || '')}</div>
          ${c.evidenceTweet ? `<div class="candidate-evidence">"${escapeHtml(c.evidenceTweet)}"</div>` : ''}
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
    showNotice('⚠️ 加入屏蔽任务失败：' + e.message, true);
  }
}

async function pauseQueue() {
  await chrome.runtime.sendMessage({ action: 'pauseGlobalBlocking' });
  refreshQueueStatus();
}

async function resumeQueue() {
  await chrome.runtime.sendMessage({ action: 'resumeGlobalBlocking' });
  refreshQueueStatus();
}

bindClick('btn-options', () => {
  chrome.runtime.openOptionsPage();
});

bindClick('btn-analyze', startAnalysis);
bindClick('btn-analyze-inline', startAnalysis);

bindClick('btn-retry', () => {
  clearAnalysisState();
  stopAnalysisPolling();
  candidates = [];
  showView('idle');
});

bindClick('btn-select-all', () => {
  candidates.forEach(c => { c.selected = true; });
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

init().catch(() => {
  // Last-resort fallback: do not block manual analysis entry.
  showView('idle');
});
