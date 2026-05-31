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
let aiOnlyDetections = [];
let scannedTweetCount = 0;
let analysisPollTimer = null;
let queuePollTimer = null;
let analysisRunning = false;
let autoBlockEnabled = false;
let lastFullLog = [];
let lastAllSessions = [];
let currentTabUrl = '';
let currentScanSource = '';
let providerConfigured = true;
let aiAnalysisEnabled = false;
let reviewPromptState = null;
let canOpenStoreReview = false;

const REVIEW_PROMPT_KEY = 'reviewPromptState';
const REVIEW_MIN_SUCCESSFUL_BLOCKS = 12;
const REVIEW_MIN_COMPLETED_SESSIONS = 3;
const REVIEW_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const UI_LANG_KEY = 'uiLanguage';
const MODERATION_ACTION_KEY = 'moderationAction';

let uiLanguage = 'zh';
let moderationAction = 'block';

const I18N = {
  zh: {
    justNow: '刚刚',
    minutesAgo: '{n} 分钟前',
    hoursAgo: '{n} 小时前',
    daysAgo: '{n} 天前',
    unknownPage: '未知页面',
    deepScanPage: '深度扫描 {target}',
    homePage: 'X 首页',
    searchPage: '搜索：{q}',
    userReplies: '@{user} 的回复',
    userMedia: '@{user} 的媒体',
    userLikes: '@{user} 的喜欢',
    switchToX: '请先切到 X 页面',
    analyzing: '分析中…',
    startAiLocal: '开始 AI + 本地分析',
    startLocal: '开始本地规则扫描',
    queuePaused: '已暂停',
    queueRunning: '运行中',
    queueIdle: '空闲',
    queueTaskLine: '任务队列：{status}（待处理 {pending}）',
    queueDetailCurrent: '当前：{current} ｜ 成功 {done} ｜ 失败 {failed}',
    queueDetailSummary: '成功 {done} ｜ 失败 {failed} ｜ 总计 {total}',
    queueNoTasks: '暂无任务记录',
    queueSessionStats: '扫描 <strong>{scanned}</strong> 条 · 入队 <strong>{enqueued}</strong> 个',
    aiToggleTitleConfigured: '开启后会在本地规则之后调用已配置的 AI 模型',
    aiToggleTitleNotConfigured: '开启后仍需在设置页配置模型；未配置时会自动使用本地规则',
    errNotXTab: '当前标签页不是 X 站点页面，请切到 x.com / twitter.com 页面后重试。',
    scanningStartAi: '正在启动 AI + 本地分析…',
    scanningStartLocal: '正在启动本地规则扫描…',
    scanningCollecting: '正在采集推文…',
    scanningAnalyzing: '正在分析…',
    errStartAnalysis: '⚠️ 启动分析失败：{msg}',
    errAnalysisFailed: '⚠️ 分析失败：{msg}',
    unknownError: '未知错误',
    emptyWithCount: '扫描了 {n} 条推文，未发现疑似垃圾账号。',
    emptyNoTweets: '当前页面未找到推文，请确认页面已加载内容后重试。',
    autoQueuedSummary: '采集了 {n} 条回复，检测出 {c} 个账号',
    resultSummary: '发现 <strong>{total}</strong> 个疑似账号，已勾选 {selected} 个高置信项',
    tweetsScanned: '（扫描了 {n} 条推文）',
    aiOnlyCount: '（{n} 条）',
    confirmAddBlock: '加入屏蔽任务列表',
    confirmAddBlockCount: '加入屏蔽任务列表（{n}）',
    confirmAddHide: '加入隐藏任务列表',
    confirmAddHideCount: '加入隐藏任务列表（{n}）',
    noNewQueueItems: '没有新增屏蔽任务：这些账号可能已经在待处理队列中。',
    errQueueAddFailed: '⚠️ 加入队列失败：{msg}',
    deepHandleRequired: '请输入博主 Handle（如 @xxx）',
    errDeepScanFailed: '⚠️ 深度扫描失败：{msg}',
    errDeepScanStartFailed: '⚠️ 启动深度扫描失败：{msg}',
    deepCollecting: '正在采集…',
    deepCompletedEmpty: '深度扫描完成，未找到疑似账号。',
    blockSummary: '共 {pages} 个页面：成功屏蔽 {done} 个，失败 {failed} 个',
    noRecords: '暂无任务记录',
    noItems: '暂无记录',
    blockStats: '扫 {scanned} 条 · 屏蔽 {enqueued}',
    titleOptions: '设置',
    textNotX: '当前不是 x.com/twitter.com 页面。你仍可在下方查看屏蔽进度并追加屏蔽账号。',
    textIdleHint: '点击下方按钮扫描当前页面已显示的推文。本地规则无需 API；开启 AI 分析后，会在本地规则之外调用你配置的模型辅助判断。',
    btnOpenOptions: '打开设置页',
    btnRetry: '重新分析',
    btnSelectAll: '全选',
    btnSelectHigh: '只选 90%+',
    btnDeselectAll: '全不选',
    aiOnlySummaryHtml: '🤖 AI 发现但本地规则未识别 <span id="ai-only-count"></span>（可用于丰富本地规则）',
    btnCancel: '取消',
    btnDeepScan: '深度扫描某博主',
    textAutoBlock: '自动执行模式（无需确认，完成后自动关闭）',
    textAiAnalysis: 'AI 分析（可选；关闭时只使用本地规则，不需要配置 API）',
    btnReviewCloseTitle: '关闭',
    reviewTitle: '觉得顺手的话，给个好评吧',
    reviewCopy: '如果它确实帮你省下了清理垃圾账号的时间，一个评分会很有帮助。',
    btnReviewRate: '去评价',
    btnReviewLater: '稍后再说',
    queueIdleText: '任务队列：空闲',
    btnQueuePause: '暂停',
    btnQueueResume: '继续',
    btnQueueRetry: '重试失败',
    btnQueueDetails: '任务详情',
    labelActionMode: '执行动作',
    actionBlock: '屏蔽',
    actionHide: '隐藏',
    deepTitle: '🔍 深度扫描某博主的回复',
    deepLabelHandle: '博主 Handle（例：@xxx）',
    deepLabelPosts: '最多采集帖子数',
    deepLabelReplies: '每条帖子最多回复数',
    deepLabelTotal: '总回复数上限',
    deepDesc: '深度扫描会逐条打开帖子采集回复，速度较慢。建议先用默认配置试试。',
    btnStartScan: '开始扫描',
    deepStatsPosts: '已采集帖子：',
    deepStatsReplies: '已采集回复：',
    deepStatsCandidates: '找到疑似账号：',
    blockInProgress: '正在执行…',
    doneMessage: '任务完成。',
    doneOk: '完成',
    blockDetailsTitle: '📋 任务记录详情',
    filterAll: '全部',
    filterDone: '✓ 成功',
    filterFailed: '✗ 失败'
  },
  en: {
    justNow: 'just now',
    minutesAgo: '{n}m ago',
    hoursAgo: '{n}h ago',
    daysAgo: '{n}d ago',
    unknownPage: 'Unknown page',
    deepScanPage: 'Deep scan {target}',
    homePage: 'X Home',
    searchPage: 'Search: {q}',
    userReplies: '@{user} replies',
    userMedia: '@{user} media',
    userLikes: '@{user} likes',
    switchToX: 'Switch to an X tab first',
    analyzing: 'Analyzing...',
    startAiLocal: 'Start AI + local scan',
    startLocal: 'Start local-rule scan',
    queuePaused: 'Paused',
    queueRunning: 'Running',
    queueIdle: 'Idle',
    queueTaskLine: 'Task queue: {status} (pending {pending})',
    queueDetailCurrent: 'Current: {current} | Success {done} | Failed {failed}',
    queueDetailSummary: 'Success {done} | Failed {failed} | Total {total}',
    queueNoTasks: 'No task history yet',
    queueSessionStats: 'Scanned <strong>{scanned}</strong> posts · Enqueued <strong>{enqueued}</strong> accounts',
    aiToggleTitleConfigured: 'When enabled, it calls your configured AI model after local rules',
    aiToggleTitleNotConfigured: 'Enable it after configuring a model in options; otherwise local rules are used',
    errNotXTab: 'Current tab is not an X page. Switch to x.com / twitter.com and try again.',
    scanningStartAi: 'Starting AI + local scan...',
    scanningStartLocal: 'Starting local-rule scan...',
    scanningCollecting: 'Collecting posts...',
    scanningAnalyzing: 'Analyzing...',
    errStartAnalysis: '⚠️ Failed to start analysis: {msg}',
    errAnalysisFailed: '⚠️ Analysis failed: {msg}',
    unknownError: 'Unknown error',
    emptyWithCount: 'Scanned {n} posts and found no suspicious accounts.',
    emptyNoTweets: 'No posts found on this page. Please wait for content to load and try again.',
    autoQueuedSummary: 'Collected {n} replies and detected {c} accounts',
    resultSummary: 'Found <strong>{total}</strong> suspicious accounts, {selected} high-confidence selected',
    tweetsScanned: '(Scanned {n} posts)',
    aiOnlyCount: '({n} items)',
    confirmAddBlock: 'Add to block queue',
    confirmAddBlockCount: 'Add to block queue ({n})',
    confirmAddHide: 'Add to hide queue',
    confirmAddHideCount: 'Add to hide queue ({n})',
    noNewQueueItems: 'No new block tasks were added: these accounts may already be queued.',
    errQueueAddFailed: '⚠️ Failed to add queue items: {msg}',
    deepHandleRequired: 'Please enter a handle (for example: @xxx)',
    errDeepScanFailed: '⚠️ Deep scan failed: {msg}',
    errDeepScanStartFailed: '⚠️ Failed to start deep scan: {msg}',
    deepCollecting: 'Collecting...',
    deepCompletedEmpty: 'Deep scan completed with no suspicious accounts.',
    blockSummary: '{pages} pages total: blocked {done} success, {failed} failed',
    noRecords: 'No task history yet',
    noItems: 'No entries',
    blockStats: 'Scanned {scanned} · Queued {enqueued}',
    titleOptions: 'Settings',
    textNotX: 'This is not an x.com/twitter.com page. You can still view queue progress and continue blocking below.',
    textIdleHint: 'Click the button below to scan visible posts on this page. Local rules do not require any API; with AI enabled, your configured model is used in addition to local rules.',
    btnOpenOptions: 'Open Settings',
    btnRetry: 'Analyze Again',
    btnSelectAll: 'Select all',
    btnSelectHigh: 'Select 90%+',
    btnDeselectAll: 'Deselect all',
    aiOnlySummaryHtml: '🤖 AI-only detections not matched by local rules <span id="ai-only-count"></span>',
    btnCancel: 'Cancel',
    btnDeepScan: 'Deep Scan a Creator',
    textAutoBlock: 'Auto run mode (no confirmation, auto-off after completion)',
    textAiAnalysis: 'AI analysis (optional; when off, only local rules are used and no API setup is needed)',
    btnReviewCloseTitle: 'Close',
    reviewTitle: 'If this helps, leave a review',
    reviewCopy: 'If Block Bot saved you cleanup time, a quick rating would really help.',
    btnReviewRate: 'Rate now',
    btnReviewLater: 'Maybe later',
    queueIdleText: 'Task queue: Idle',
    btnQueuePause: 'Pause',
    btnQueueResume: 'Resume',
    btnQueueRetry: 'Retry failed',
    btnQueueDetails: 'Task details',
    labelActionMode: 'Action Mode',
    actionBlock: 'Block',
    actionHide: 'Hide',
    deepTitle: '🔍 Deep Scan Replies for a Creator',
    deepLabelHandle: 'Creator handle (example: @xxx)',
    deepLabelPosts: 'Max posts to scan',
    deepLabelReplies: 'Max replies per post',
    deepLabelTotal: 'Total reply cap',
    deepDesc: 'Deep scan opens posts one by one to collect replies, so it can be slower. Start with defaults first.',
    btnStartScan: 'Start scan',
    deepStatsPosts: 'Posts collected:',
    deepStatsReplies: 'Replies collected:',
    deepStatsCandidates: 'Suspicious accounts found:',
    blockInProgress: 'Running task...',
    doneMessage: 'Task completed.',
    doneOk: 'Done',
    blockDetailsTitle: '📋 Task Details',
    filterAll: 'All',
    filterDone: '✓ Success',
    filterFailed: '✗ Failed'
  }
};

function detectUiLanguage() {
  return /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
}

function t(key, vars = {}) {
  const table = I18N[uiLanguage] || I18N.zh;
  const fallback = I18N.zh;
  const raw = table[key] || fallback[key] || key;
  return raw.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function normalizeModerationAction(action) {
  return action === 'hide' ? 'hide' : 'block';
}

function applyStaticTranslations() {
  document.documentElement.lang = uiLanguage === 'zh' ? 'zh-CN' : 'en';
  setText('text-not-x-msg', t('textNotX'));
  setText('text-idle-hint', t('textIdleHint'));
  setText('btn-open-options-from-notice', t('btnOpenOptions'));
  setText('btn-retry', t('btnRetry'));
  setText('btn-select-all', t('btnSelectAll'));
  setText('btn-select-high', t('btnSelectHigh'));
  setText('btn-deselect-all', t('btnDeselectAll'));
  setText('btn-cancel-results', t('btnCancel'));
  setText('btn-deep-scan', t('btnDeepScan'));
  setText('text-auto-block', t('textAutoBlock'));
  setText('text-ai-analysis', t('textAiAnalysis'));
  setText('text-review-title', t('reviewTitle'));
  setText('text-review-copy', t('reviewCopy'));
  setText('btn-review-rate', t('btnReviewRate'));
  setText('btn-review-later', t('btnReviewLater'));
  setText('queue-msg', t('queueIdleText'));
  setText('btn-queue-pause', t('btnQueuePause'));
  setText('btn-queue-resume', t('btnQueueResume'));
  setText('btn-queue-retry-failed', t('btnQueueRetry'));
  setText('btn-queue-details', t('btnQueueDetails'));
  setText('label-action-mode', t('labelActionMode'));
  setText('option-action-block', t('actionBlock'));
  setText('option-action-hide', t('actionHide'));
  setText('text-deep-scan-title', t('deepTitle'));
  setText('label-deep-scan-handle', t('deepLabelHandle'));
  setText('label-deep-scan-posts', t('deepLabelPosts'));
  setText('label-deep-scan-replies', t('deepLabelReplies'));
  setText('label-deep-scan-total', t('deepLabelTotal'));
  setText('text-deep-scan-desc', t('deepDesc'));
  setText('btn-modal-cancel', t('btnCancel'));
  setText('btn-modal-start-deep-scan', t('btnStartScan'));
  setText('text-deep-scan-posts', t('deepStatsPosts'));
  setText('text-deep-scan-replies', t('deepStatsReplies'));
  setText('text-deep-scan-candidates', t('deepStatsCandidates'));
  setText('btn-deep-scan-pause', t('btnQueuePause'));
  setText('btn-deep-scan-cancel', t('btnCancel'));
  setText('block-msg', t('blockInProgress'));
  setText('done-msg', t('doneMessage'));
  setText('btn-done-ok', t('doneOk'));
  setText('text-block-details-title', t('blockDetailsTitle'));
  setText('filter-all', t('filterAll'));
  setText('filter-done', t('filterDone'));
  setText('filter-failed', t('filterFailed'));
  const aiOnlySummary = document.getElementById('ai-only-summary');
  if (aiOnlySummary) aiOnlySummary.innerHTML = t('aiOnlySummaryHtml');

  const optionsBtn = document.getElementById('btn-options');
  if (optionsBtn) optionsBtn.title = t('titleOptions');
  const reviewCloseBtn = document.getElementById('btn-review-dismiss');
  if (reviewCloseBtn) reviewCloseBtn.title = t('btnReviewCloseTitle');

  const actionSelect = document.getElementById('select-action-mode');
  if (actionSelect) actionSelect.value = moderationAction;

  updateAnalyzeButtonState();
  updateConfirmBtn();
  if (lastAllSessions.length) renderBlockDetails();
}

async function loadUiLanguage() {
  try {
    const data = await chrome.storage.local.get([UI_LANG_KEY]);
    const stored = data?.[UI_LANG_KEY];
    uiLanguage = stored === 'zh' || stored === 'en' ? stored : detectUiLanguage();
  } catch (_) {
    uiLanguage = detectUiLanguage();
  }
}

async function setupLanguageSelector() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.value = uiLanguage;
  sel.addEventListener('change', async () => {
    const next = sel.value === 'en' ? 'en' : 'zh';
    uiLanguage = next;
    try {
      await chrome.storage.local.set({ [UI_LANG_KEY]: next });
    } catch (_) {}
    applyStaticTranslations();
    await refreshQueueStatus();
  });
}

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

function formatRelativeTime(ts) {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return t('justNow');
  const m = Math.floor(s / 60);
  if (m < 60) return t('minutesAgo', { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t('hoursAgo', { n: h });
  const d = Math.floor(h / 24);
  return t('daysAgo', { n: d });
}

function formatPageLabel(url) {
  if (!url) return t('unknownPage');
  if (url.startsWith('deep:')) {
    return t('deepScanPage', { target: url.slice(5) });
  }
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    if (!path || path === '/home') return t('homePage');
    if (path === '/search') {
      const q = u.searchParams.get('q') || '';
      return t('searchPage', { q: q.slice(0, 25) });
    }
    const m = path.match(/^\/([^\/]+)(\/(.+))?$/);
    if (m) {
      const user = m[1];
      const sub = m[3];
      if (sub === 'with_replies') return t('userReplies', { user });
      if (sub === 'media') return t('userMedia', { user });
      if (sub === 'likes') return t('userLikes', { user });
      if (!sub) return `@${user}`;
      return `@${user}/${sub}`;
    }
    return path;
  } catch (_) {
    return url.slice(0, 40);
  }
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

function updateAnalyzeButtonState() {
  const inlineAnalyzeBtn = document.getElementById('btn-analyze-inline');
  if (!inlineAnalyzeBtn) return;

  inlineAnalyzeBtn.disabled = !isXTab || analysisRunning;
  if (!isXTab) {
    inlineAnalyzeBtn.textContent = t('switchToX');
    return;
  }
  inlineAnalyzeBtn.textContent = analysisRunning
    ? t('analyzing')
    : (aiAnalysisEnabled && providerConfigured ? t('startAiLocal') : t('startLocal'));
}

function bindClick(id, handler) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', handler);
}

function getDefaultReviewPromptState() {
  return {
    reviewed: false,
    dismissed: false,
    snoozeUntil: 0
  };
}

function isChromeWebStoreBuild() {
  const updateUrl = String(chrome.runtime.getManifest()?.update_url || '');
  return updateUrl.includes('clients2.google.com/service/update2/crx');
}

async function loadReviewPromptState() {
  try {
    const data = await chrome.storage.local.get(REVIEW_PROMPT_KEY);
    reviewPromptState = {
      ...getDefaultReviewPromptState(),
      ...(data?.[REVIEW_PROMPT_KEY] || {})
    };
  } catch (_) {
    reviewPromptState = getDefaultReviewPromptState();
  }
}

async function saveReviewPromptState(patch) {
  reviewPromptState = {
    ...(reviewPromptState || getDefaultReviewPromptState()),
    ...patch
  };
  try {
    await chrome.storage.local.set({ [REVIEW_PROMPT_KEY]: reviewPromptState });
  } catch (_) {}
}

function getReviewUrl() {
  if (!canOpenStoreReview) return '';
  return `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;
}

function shouldShowReviewPrompt(status) {
  if (!canOpenStoreReview) return false;
  if (!reviewPromptState) return false;
  if (reviewPromptState.reviewed || reviewPromptState.dismissed) return false;
  if (Number(reviewPromptState.snoozeUntil || 0) > Date.now()) return false;

  const sessions = Array.isArray(status?.allSessions) ? status.allSessions : [];
  const totalDone = sessions.reduce((sum, sess) => sum + Number(sess?.done || 0), 0);
  const completedSessions = sessions.filter(sess => Number(sess?.done || 0) > 0).length;
  return totalDone >= REVIEW_MIN_SUCCESSFUL_BLOCKS || completedSessions >= REVIEW_MIN_COMPLETED_SESSIONS;
}

function renderReviewPrompt(status) {
  const card = document.getElementById('review-prompt');
  if (!card) return;
  card.classList.toggle('hidden', !shouldShowReviewPrompt(status));
}

async function openReviewPage() {
  const url = getReviewUrl();
  if (!url) return;
  await saveReviewPromptState({ reviewed: true });
  renderReviewPrompt(null);
  chrome.tabs.create({ url });
}

async function snoozeReviewPrompt() {
  await saveReviewPromptState({ snoozeUntil: Date.now() + REVIEW_SNOOZE_MS });
  renderReviewPrompt(null);
}

async function dismissReviewPrompt() {
  await saveReviewPromptState({ dismissed: true });
  renderReviewPrompt(null);
}

async function getAnalysisState() {
  const resp = await chrome.runtime.sendMessage({ action: 'getAnalysisForTab', tabId: currentTabId });
  if (!resp?.ok) throw new Error(resp?.error || '读取分析状态失败');
  const state = resp.state || null;
  if (!state) return null;
  // State is tab-scoped in storage; guard against stale state from a different URL.
  if (state.sourceUrl && currentTabUrl && state.sourceUrl !== currentTabUrl) {
    return null;
  }
  return state;
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

  const pending = (s.queue || []).filter(i => i.status === 'pending').length;
  const failed = Number(s.failed || 0);
  const done = Number(s.done || 0);
  const runningText = s.paused ? t('queuePaused') : (s.running ? t('queueRunning') : t('queueIdle'));
  msgEl.textContent = t('queueTaskLine', { status: runningText, pending });
  const baseDetail = s.current
    ? t('queueDetailCurrent', { current: s.current, done: s.done, failed: s.failed })
    : t('queueDetailSummary', { done: s.done, failed: s.failed, total: s.total });
  detailEl.textContent = s.errorMsg ? `${baseDetail} ｜ ${s.errorMsg}` : baseDetail;

  const pct = s.total > 0 ? ((s.done + s.failed) / s.total) * 100 : 0;
  bar.style.width = `${Math.max(0, Math.min(100, pct))}%`;

  logEl.innerHTML = '';
  lastFullLog = s.log || [];
  lastAllSessions = s.allSessions || [];

  // Group all sessions by sourceUrl, show last 3 unique pages
  const pageMap = new Map();
  (s.allSessions || []).forEach(sess => {
    const key = sess.sourceUrl || 'unknown';
    if (!pageMap.has(key)) {
      pageMap.set(key, { sourceUrl: key, timestamp: 0, scannedCount: 0, enqueuedCount: 0, done: 0, failed: 0 });
    }
    const page = pageMap.get(key);
    page.scannedCount += sess.scannedCount;
    page.enqueuedCount += sess.enqueuedCount;
    page.done += sess.done;
    page.failed += sess.failed;
    if (sess.timestamp > page.timestamp) page.timestamp = sess.timestamp;
  });
  const pages = Array.from(pageMap.values())
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 3);

  if (pages.length === 0) {
    const li = document.createElement('li');
    li.className = 'task-session-empty';
    li.textContent = t('queueNoTasks');
    logEl.appendChild(li);
  } else {
    pages.forEach(page => {
      const pending = page.enqueuedCount - page.done - page.failed;
      const li = document.createElement('li');
      li.className = 'task-session-item';
      li.innerHTML =
        `<div class="task-session-row">`+
        `<span class="task-session-page">${escapeHtml(formatPageLabel(page.sourceUrl))}</span>`+
        `<span class="task-session-time">${escapeHtml(formatRelativeTime(page.timestamp))}</span>`+
        `</div>`+
        `<div class="task-session-row">`+
        `<span class="task-session-nums">${t('queueSessionStats', { scanned: page.scannedCount, enqueued: page.enqueuedCount })}</span>`+
        `<span class="ts-done">✓${page.done}</span>`+
        `<span class="ts-failed">✗${page.failed}</span>`+
        (pending > 0 ? `<span class="ts-pending">⏳${pending}</span>` : '') +
        `</div>`;
      logEl.appendChild(li);
    });
  }

  pauseBtn.disabled = !s.running || s.paused;
  resumeBtn.disabled = !s.paused || pending === 0;
  retryFailedBtn.disabled = s.running || failed === 0;
  renderReviewPrompt(s);
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
  await loadUiLanguage();
  await setupLanguageSelector();
  applyStaticTranslations();

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];

  currentTabId = tab?.id || null;
  isXTab = Boolean(tab && isSupportedXUrl(tab.url));
  currentTabUrl = tab?.url || '';
  currentScanSource = currentTabUrl;
  canOpenStoreReview = isChromeWebStoreBuild();

  await loadReviewPromptState();

  // ── Load auto-block setting ────────────────────────────────────────────────
  try {
    const stored = await chrome.storage.local.get(['autoBlock', 'aiAnalysisEnabled', MODERATION_ACTION_KEY]);
    autoBlockEnabled = Boolean(stored.autoBlock);
    aiAnalysisEnabled = Boolean(stored.aiAnalysisEnabled);
    moderationAction = normalizeModerationAction(stored[MODERATION_ACTION_KEY]);
  } catch (_) {}
  const toggleEl = document.getElementById('toggle-auto-block');
  if (toggleEl) {
    toggleEl.checked = autoBlockEnabled;
    toggleEl.addEventListener('change', async () => {
      autoBlockEnabled = toggleEl.checked;
      try {
        await chrome.storage.local.set({ autoBlock: autoBlockEnabled });
      } catch (_) {}
    });
  }
  const aiToggleEl = document.getElementById('toggle-ai-analysis');
  if (aiToggleEl) {
    aiToggleEl.checked = aiAnalysisEnabled;
    aiToggleEl.addEventListener('change', async () => {
      aiAnalysisEnabled = aiToggleEl.checked;
      updateAnalyzeButtonState();
      try {
        await chrome.storage.local.set({ aiAnalysisEnabled });
      } catch (_) {}
    });
  }

  startQueuePolling();


  const actionModeEl = document.getElementById('select-action-mode');
  if (actionModeEl) {
    actionModeEl.value = moderationAction;
    actionModeEl.addEventListener('change', async () => {
      moderationAction = normalizeModerationAction(actionModeEl.value);
      updateConfirmBtn();
      try {
        await chrome.storage.local.set({ [MODERATION_ACTION_KEY]: moderationAction });
      } catch (_) {}
    });
  }
  // ── Deep Scan recovery ────────────────────────────────────────────────────
  // Deep Scan runs in the background service worker and is independent of
  // whichever tab the user is currently viewing.  Check its state FIRST,
  // before any isXTab guard, so switching to a non-X tab does not lose
  // the progress view.
  try {
    const ds = await getDeepScanStatus();
    if (ds.running || ds.completed || ds.error) {
      // Update inline analyze entry even when deep-scan view is shown.
      updateAnalyzeButtonState();
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

  updateAnalyzeButtonState();

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
    providerConfigured = Boolean(status.configured);
    aiAnalysisEnabled = Boolean(status.aiAnalysisEnabled);
    const aiToggleEl = document.getElementById('toggle-ai-analysis');
    if (aiToggleEl) {
      aiToggleEl.checked = aiAnalysisEnabled;
      aiToggleEl.title = providerConfigured
        ? t('aiToggleTitleConfigured')
        : t('aiToggleTitleNotConfigured');
    }
    updateAnalyzeButtonState();
  } catch (_) {}
}

async function startAnalysis() {
  if (!isXTab || !currentTabId) {
    showNotice(t('errNotXTab'), true);
    return;
  }

  currentScanSource = currentTabUrl;

  stopAnalysisPolling();
  analysisRunning = true;
  updateAnalyzeButtonState();
  showView('scanning');
  setScanMsg(aiAnalysisEnabled && providerConfigured ? t('scanningStartAi') : t('scanningStartLocal'));

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'startAnalysisForTab',
      tabId: currentTabId,
      aiAnalysisEnabled
    });
    if (!resp?.ok) {
      analysisRunning = false;
      updateAnalyzeButtonState();
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
      setScanMsg(t('scanningCollecting'));
    }
  } catch (e) {
    analysisRunning = false;
    updateAnalyzeButtonState();
    showNotice(t('errStartAnalysis', { msg: e.message }), true);
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

async function applyAnalysisState(state) {
  if (!state) {
    analysisRunning = false;
    updateAnalyzeButtonState();
    showView(isXTab ? 'idle' : 'notX');
    return;
  }

  analysisRunning = state.status === 'running';
  updateAnalyzeButtonState();

  if (state.status === 'running') {
    showView('scanning');
    setScanMsg(state.progressText || t('scanningAnalyzing'));
    return;
  }

  if (state.status === 'error') {
    const interrupted = state.error && (
      state.error.includes('已中断') || state.error.includes('已中止') ||
      state.error.includes('扩展重启') || state.error.includes('已跳转')
    );
    if (interrupted) {
      analysisRunning = false;
      updateAnalyzeButtonState();
      showView(isXTab ? 'idle' : 'notX');
    } else {
      showNotice(t('errAnalysisFailed', { msg: state.error || t('unknownError') }), true);
    }
    return;
  }

  if (state.status === 'empty') {
    const n = Number(state.scannedTweetCount || 0);
    showNotice(
      n > 0
        ? t('emptyWithCount', { n })
        : t('emptyNoTweets'),
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
    aiOnlyDetections = Array.isArray(state.aiOnlyDetections) ? state.aiOnlyDetections : [];
    if (candidates.length === 0) {
      showNotice(t('emptyWithCount', { n: scannedTweetCount }), false);
      return;
    }
    currentScanSource = state.sourceUrl || currentTabUrl;
    if (autoBlockEnabled) {
      if (state.autoQueued) {
        const n = Number(state.scannedTweetCount || 0);
        const c = Array.isArray(state.candidates) ? state.candidates.length : 0;
        setScanMsg(t('autoQueuedSummary', { n, c }));
        showView('scanning');
        await new Promise(r => setTimeout(r, 2000));
        await clearAnalysisState();
        window.close();
        return;
      }
      candidates.forEach(c => { c.selected = true; });
      await addSelectedToQueue();
      window.close();
      return;
    }
    renderResults();
    return;
  }

  analysisRunning = false;
  updateAnalyzeButtonState();
  showView(isXTab ? 'idle' : 'notX');
}

function startAnalysisPolling() {
  stopAnalysisPolling();
  analysisPollTimer = setInterval(async () => {
    try {
      const state = await getAnalysisState();
      if (!state) {
        stopAnalysisPolling();
        analysisRunning = false;
        updateAnalyzeButtonState();
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
    t('resultSummary', { total: candidates.length, selected: selectedCount });
  document.getElementById('tweet-count').textContent =
    t('tweetsScanned', { n: scannedTweetCount });

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

  // Render AI-only detections panel (AI caught but local rules missed)
  const aiOnlySection = document.getElementById('ai-only-section');
  const aiOnlyList = document.getElementById('ai-only-list');
  const aiOnlyCountEl = document.getElementById('ai-only-count');
  if (aiOnlySection && aiOnlyList) {
    if (Array.isArray(aiOnlyDetections) && aiOnlyDetections.length > 0) {
      aiOnlySection.classList.remove('hidden');
      if (aiOnlyCountEl) aiOnlyCountEl.textContent = t('aiOnlyCount', { n: aiOnlyDetections.length });
      aiOnlyList.innerHTML = '';
      aiOnlyDetections.forEach(item => {
        const li = document.createElement('li');
        li.className = 'ai-only-item';
        li.innerHTML =
          `<div>` +
          `<span class="ai-only-handle">${escapeHtml(item.handle)}</span>` +
          `<span class="ai-only-name">${escapeHtml(item.displayName || '')}</span>` +
          `<span class="ai-only-conf">${Math.round((item.confidence || 0) * 100)}%</span>` +
          `</div>` +
          ((item.evidenceTweet || '').trim()
            ? `<div class="ai-only-evidence">"${escapeHtml(item.evidenceTweet.trim())}"</div>`
            : '') +
          ((item.reason || '').trim()
            ? `<div class="ai-only-reason">${escapeHtml(item.reason.trim())}</div>`
            : '');
        aiOnlyList.appendChild(li);
      });
    } else {
      aiOnlySection.classList.add('hidden');
    }
  }

  updateConfirmBtn();
  showView('results');
}

function updateConfirmBtn() {
  const n = candidates.filter(c => c.selected).length;
  const btn = document.getElementById('btn-confirm-block');
  const isHide = moderationAction === 'hide';
  if (n > 0) {
    btn.textContent = isHide ? t('confirmAddHideCount', { n }) : t('confirmAddBlockCount', { n });
  } else {
    btn.textContent = isHide ? t('confirmAddHide') : t('confirmAddBlock');
  }
  btn.disabled = n === 0;
}

async function addSelectedToQueue() {
  const selected = candidates
    .filter(c => c.selected)
    .map(c => ({ ...c, actionType: moderationAction }));
  if (selected.length === 0) return;

  try {
    const resp = await chrome.runtime.sendMessage({
      action: 'enqueueGlobalBlockAccounts',
      accounts: selected,
      meta: {
        scannedCount: scannedTweetCount,
        candidateCount: candidates.length,
        sourceUrl: currentScanSource,
        actionType: moderationAction
      }
    });
    if (!resp?.ok) throw new Error(resp?.error || '加入队列失败');
    if (Number(resp.added || 0) === 0) {
      await refreshQueueStatus();
      showNotice(t('noNewQueueItems'), true);
      return;
    }
    await refreshQueueStatus();

    // Close analysis result view after enqueueing; blocking continues in background queue.
    await clearAnalysisState();
    stopAnalysisPolling();
    analysisRunning = false;
    updateAnalyzeButtonState();
    candidates = [];
    showView(isXTab ? 'idle' : 'notX');
  } catch (e) {
    showNotice(t('errQueueAddFailed', { msg: e.message }), true);
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
    alert(t('deepHandleRequired'));
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
        maxTotalReplies,
        aiAnalysisEnabled
      }
    });

    if (!resp?.ok) {
      showNotice(t('errDeepScanFailed', { msg: resp?.error || t('unknownError') }), true);
      return;
    }

    startDeepScanPolling();
  } catch (e) {
    showNotice(t('errDeepScanStartFailed', { msg: e.message }), true);
  }
}

async function getDeepScanStatus() {
  const resp = await chrome.runtime.sendMessage({ action: 'getDeepScanStatus' });
  if (!resp?.ok) throw new Error(resp?.error || '读取扫描状态失败');
  return resp.status;
}

async function renderDeepScanStatus(status) {
  const msgEl = document.getElementById('deep-scan-msg');
  const postsEl = document.getElementById('deep-scan-posts-count');
  const repliesEl = document.getElementById('deep-scan-replies-count');
  const candidatesEl = document.getElementById('deep-scan-candidates-count');
  const pauseBtn = document.getElementById('btn-deep-scan-pause');
  const cancelBtn = document.getElementById('btn-deep-scan-cancel');

  msgEl.textContent = status.currentStep || '正在采集…';
  if (!status.currentStep) {
    msgEl.textContent = t('deepCollecting');
  }
  postsEl.textContent = status.postsCount || 0;
  repliesEl.textContent = status.repliesCount || 0;
  candidatesEl.textContent = status.candidatesCount || 0;

  pauseBtn.disabled = !status.running || status.paused;
  cancelBtn.disabled = !status.running;

  if (!status.running && status.error) {
    stopDeepScanPolling();
    showNotice(t('errDeepScanFailed', { msg: status.error }), true);
    chrome.runtime.sendMessage({ action: 'clearDeepScanCompleted' }).catch(() => {});
    showView(isXTab ? 'idle' : 'notX');
    return;
  }

  if (status.completed) {
    stopDeepScanPolling();
    if (status.candidates && status.candidates.length > 0) {
      scannedTweetCount = status.repliesCount;
      candidates = (status.candidates || []).map(c => ({ ...c, selected: true }));
      currentScanSource = `deep:@${(status.handle || '').replace(/^@/, '')}`;
      if (autoBlockEnabled) {
        await addSelectedToQueue();
        chrome.runtime.sendMessage({ action: 'clearDeepScanCompleted' }).catch(() => {});
        window.close();
        return;
      }
      renderResults();
    } else {
      showNotice(t('deepCompletedEmpty'), false);
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

let blockDetailsFilter = 'all';

function openBlockDetails() {
  blockDetailsFilter = 'all';
  renderBlockDetails();
  document.getElementById('modal-block-details').classList.remove('hidden');
}

function closeBlockDetails() {
  document.getElementById('modal-block-details').classList.add('hidden');
}

function renderBlockDetails() {
  // Build per-page aggregates from all sessions
  const pageMap = new Map();
  lastAllSessions.forEach(sess => {
    const key = sess.sourceUrl || 'unknown';
    if (!pageMap.has(key)) {
      pageMap.set(key, { sourceUrl: key, timestamp: 0, scannedCount: 0, enqueuedCount: 0, done: 0, failed: 0 });
    }
    const page = pageMap.get(key);
    page.scannedCount += sess.scannedCount;
    page.enqueuedCount += sess.enqueuedCount;
    page.done += sess.done;
    page.failed += sess.failed;
    if (sess.timestamp > page.timestamp) page.timestamp = sess.timestamp;
  });
  const allPages = Array.from(pageMap.values()).sort((a, b) => b.timestamp - a.timestamp);

  const totalDone = allPages.reduce((a, p) => a + p.done, 0);
  const totalFailed = allPages.reduce((a, p) => a + p.failed, 0);

  document.getElementById('block-details-summary').textContent =
    allPages.length > 0
      ? t('blockSummary', { pages: allPages.length, done: totalDone, failed: totalFailed })
      : t('noRecords');

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.classList.toggle('filter-btn-active', btn.dataset.filter === blockDetailsFilter);
  });

  const list = document.getElementById('block-details-list');
  list.innerHTML = '';

  const filtered = allPages.filter(page => {
    if (blockDetailsFilter === 'done') return page.done > 0;
    if (blockDetailsFilter === 'failed') return page.failed > 0;
    return true;
  });

  if (filtered.length === 0) {
    const li = document.createElement('li');
    li.className = 'block-details-empty';
    li.textContent = t('noItems');
    list.appendChild(li);
    return;
  }

  filtered.forEach(page => {
    const pending = page.enqueuedCount - page.done - page.failed;
    const li = document.createElement('li');
    li.className = 'block-details-session-header';
    li.innerHTML =
      `<span class="bds-page">${escapeHtml(formatPageLabel(page.sourceUrl))}</span>` +
      `<span class="bds-time">${escapeHtml(formatRelativeTime(page.timestamp))}</span>` +
      `<span class="bds-scan">${t('blockStats', { scanned: page.scannedCount, enqueued: page.enqueuedCount })}</span>` +
      `<span class="bds-stats">` +
        `<span class="ts-done">✓${page.done}</span> ` +
        `<span class="ts-failed">✗${page.failed}</span>` +
        (pending > 0 ? ` <span class="ts-pending">⏳${pending}</span>` : '') +
      `</span>`;
    list.appendChild(li);
  });
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
  analysisRunning = false;
  updateAnalyzeButtonState();
  candidates = [];
  showView('idle');
});

bindClick('btn-queue-pause', pauseQueue);
bindClick('btn-queue-resume', resumeQueue);
bindClick('btn-queue-retry-failed', retryFailedQueue);
bindClick('btn-queue-details', openBlockDetails);
bindClick('btn-review-rate', openReviewPage);
bindClick('btn-review-later', snoozeReviewPrompt);
bindClick('btn-review-dismiss', dismissReviewPrompt);

// Block details modal
bindClick('modal-close-block-details', closeBlockDetails);
document.getElementById('modal-block-details').addEventListener('click', e => {
  if (e.target.id === 'modal-block-details') closeBlockDetails();
});
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    blockDetailsFilter = btn.dataset.filter;
    renderBlockDetails();
  });
});

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
  analysisRunning = false;
  updateAnalyzeButtonState();
  showView('idle');
});
