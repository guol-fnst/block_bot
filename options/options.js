'use strict';

const providerSel = document.getElementById('provider');
const geminiFields = document.getElementById('gemini-fields');
const openaiFields = document.getElementById('openai-fields');
const openaiEndpointText = document.getElementById('openai-endpoint');
const customUrlWrap = document.getElementById('custom-url-wrap');

const geminiKeyInput = document.getElementById('gemini-key');
const geminiModelSel = document.getElementById('gemini-model');
const openaiUrlInput = document.getElementById('openai-url');
const openaiModelInput = document.getElementById('openai-model');
const openaiKeyInput = document.getElementById('openai-key');
const modelSuggestions = document.getElementById('model-suggestions');
const spamThresholdInput = document.getElementById('spam-threshold');
const obviousBotKeywordsInput = document.getElementById('obvious-bot-keywords');
const customPromptInput = document.getElementById('custom-prompt');
const analysisBatchSizeInput = document.getElementById('analysis-batch-size');
const analysisParallelismInput = document.getElementById('analysis-parallelism');
const scrapeScrollWaitMsInput = document.getElementById('scrape-scroll-wait-ms');
const scrapeMaxRoundsInput = document.getElementById('scrape-max-rounds');
const scrapeMaxTweetsInput = document.getElementById('scrape-max-tweets');
const scrapeStagnantRoundsInput = document.getElementById('scrape-stagnant-rounds');
const langSelect = document.getElementById('lang-select');
const learnedFeaturesList = document.getElementById('learned-features-list');
const learnedFeaturesEmpty = document.getElementById('learned-features-empty');
const learnedFeaturesStatus = document.getElementById('text-library-status');
const refreshLibraryBtn = document.getElementById('btn-refresh-library');
const clearLibraryBtn = document.getElementById('btn-clear-library');

const UI_LANG_KEY = 'uiLanguage';
let uiLanguage = 'zh';
let currentLearnedFeatures = [];

const I18N = {
  zh: {
    pageTitle: 'Block Bot 设置',
    sectionProviderTitle: '模型与 API 配置',
    sectionProviderDesc: '支持 Gemini、Anthropic，以及主流 OpenAI 兼容接口；也可以填写自定义兼容端点。',
    labelProvider: '提供商',
    btnSaveConfig: '保存配置',
    btnTestConfig: '测试配置',
    sectionStrategyTitle: '屏蔽策略',
    sectionStrategyDesc: '仅当模型判定概率达到该阈值时，账号才会出现在可屏蔽候选列表中。',
    labelThreshold: '垃圾/机器人判定阈值（%）',
    thresholdDesc: '例如设置为 90，则 89% 及以下不会进入屏蔽候选。',
    labelKeywords: '本地预过滤关键词',
    keywordsDesc: '这些关键词会匹配账号昵称和 handle。命中后还会结合极短回复、随机 ID 等信号，在调用 AI 前先进入候选。',
    btnSaveThreshold: '保存阈值',
    sectionPerformanceTitle: '性能调优',
    sectionPerformanceDesc: '可按 API 配额与网络情况调节分析速度。并发和批量越大越快，但更容易触发服务商限流。',
    btnSavePerformance: '保存性能参数',
    sectionPromptTitle: '检测提示词（可自定义）',
    sectionPromptDesc: '这里填写的是“高置信度特征”规则。留空则使用内置默认规则。保存后下次分析立即生效，无需重新打包插件。',
    labelCustomPrompt: '自定义规则',
    btnSavePrompt: '保存提示词',
    sectionAboutTitle: '关于',
    versionText: '版本 0.3.2',
    errGeminiKeyRequired: '请输入 Gemini API Key',
    errGeminiPrefix: 'Gemini Key 通常以 "AIza" 开头',
    okGeminiSaved: 'Gemini 配置已保存 ✓',
    errProviderUnsupported: '请选择受支持的模型提供商',
    errApiUrlInvalid: '请输入 http:// 或 https:// 开头的 API URL',
    errModelRequired: '请输入模型名',
    errApiKeyRequired: '请输入 API Key',
    errEndpointPermission: '未授予该 API 域名权限，无法保存自定义端点',
    okProviderSaved: '模型配置已保存 ✓',
    testingConfig: '正在测试模型配置…',
    okConfigUsable: '测试通过，模型配置可用 ✓',
    errConfigFailed: '测试失败：{msg}',
    errThresholdRange: '屏蔽阈值必须在 50 到 100 之间',
    okThresholdSaved: '屏蔽策略已保存 ✓',
    okPromptReset: '已恢复为默认提示词 ✓',
    okPromptSaved: '自定义提示词已保存 ✓',
    okPerformanceSaved: '性能参数已保存 ✓',
    unknownError: '未知错误'
  },
  en: {
    pageTitle: 'Block Bot Settings',
    sectionProviderTitle: 'Model & API Configuration',
    sectionProviderDesc: 'Supports Gemini, Anthropic, and mainstream OpenAI-compatible APIs; custom compatible endpoints are also supported.',
    labelProvider: 'Provider',
    btnSaveConfig: 'Save Configuration',
    btnTestConfig: 'Test Configuration',
    sectionStrategyTitle: 'Blocking Strategy',
    sectionStrategyDesc: 'Only accounts above this probability threshold are shown as block candidates.',
    labelThreshold: 'Spam/Bot Confidence Threshold (%)',
    thresholdDesc: 'For example, if set to 90, anything at 89% or below will not appear in candidates.',
    labelKeywords: 'Local Prefilter Keywords',
    keywordsDesc: 'Keywords match display names and handles. Hits are combined with short-reply/random-ID signals before AI calls.',
    btnSaveThreshold: 'Save Threshold',
    sectionPerformanceTitle: 'Performance Tuning',
    sectionPerformanceDesc: 'Tune speed based on API quota and network. Larger batch/concurrency is faster but may trigger rate limits sooner.',
    btnSavePerformance: 'Save Performance Settings',
    sectionPromptTitle: 'Detection Prompt (Customizable)',
    sectionPromptDesc: 'This defines high-confidence detection rules. Leave empty to use built-in defaults. Changes apply immediately on next analysis.',
    labelCustomPrompt: 'Custom Rules',
    btnSavePrompt: 'Save Prompt',
    sectionAboutTitle: 'About',
    versionText: 'Version 0.3.2',
    errGeminiKeyRequired: 'Please enter a Gemini API key',
    errGeminiPrefix: 'Gemini keys usually start with "AIza"',
    okGeminiSaved: 'Gemini configuration saved ✓',
    errProviderUnsupported: 'Please choose a supported provider',
    errApiUrlInvalid: 'Please enter an API URL starting with http:// or https://',
    errModelRequired: 'Please enter a model name',
    errApiKeyRequired: 'Please enter an API key',
    errEndpointPermission: 'Permission for this API domain was not granted, custom endpoint cannot be saved',
    okProviderSaved: 'Model configuration saved ✓',
    testingConfig: 'Testing model configuration...',
    okConfigUsable: 'Configuration test passed ✓',
    errConfigFailed: 'Test failed: {msg}',
    errThresholdRange: 'Threshold must be between 50 and 100',
    okThresholdSaved: 'Blocking strategy saved ✓',
    okPromptReset: 'Restored to default prompt ✓',
    okPromptSaved: 'Custom prompt saved ✓',
    okPerformanceSaved: 'Performance settings saved ✓',
    unknownError: 'Unknown error'
  }
};

Object.assign(I18N.zh, {
  keywordsNote: '这里是可手动编辑的本地关键词。自动学习的特征库会在下方单独管理，不会混到这个文本框里。',
  sectionLibraryTitle: '自动学习特征库',
  sectionLibraryDesc: 'AI 找到但本地规则未命中的样本，如果发现了可复用的稳定特征组合，就会累计到这里。你可以查看、删除单条或清空整个特征库。',
  btnRefreshLibrary: '刷新',
  btnClearLibrary: '清空特征库',
  libraryLoading: '正在加载特征库...',
  libraryEmpty: '暂时还没有自动学习的特征。',
  libraryStatusCount: '已收录 {n} 条自动学习特征',
  libraryStatusCountActive: '已收录 {n} 条自动学习特征，其中 {a} 条已达到本地规则生效门槛',
  librarySeenCount: '出现 {n} 次',
  libraryLastSeen: '最近学习 {time}',
  libraryCreatedAt: '首次学习 {time}',
  libraryDelete: '删除',
  libraryDeleteDone: '已删除自动学习特征',
  libraryClearDone: '已清空自动学习特征库',
  libraryLoadFailed: '加载特征库失败：{msg}',
  libraryUpdateFailed: '更新特征库失败：{msg}',
  libraryClearConfirm: '确定要清空所有自动学习特征吗？'
});

Object.assign(I18N.en, {
  keywordsNote: 'This text box is for manually maintained local keywords. Auto-learned feature signatures are managed separately below and are not mixed into this field.',
  sectionLibraryTitle: 'Auto-Learned Feature Library',
  sectionLibraryDesc: 'When AI catches accounts that local rules missed, reusable signal combinations are accumulated here after repeated matches. You can review them, delete individual entries, or clear the whole learned library.',
  btnRefreshLibrary: 'Refresh',
  btnClearLibrary: 'Clear Library',
  libraryLoading: 'Loading learned features...',
  libraryEmpty: 'No auto-learned features yet.',
  libraryStatusCount: '{n} learned signatures stored',
  libraryStatusCountActive: '{n} learned signatures stored, {a} already active in local rules',
  librarySeenCount: 'Seen {n} times',
  libraryLastSeen: 'Last learned {time}',
  libraryCreatedAt: 'First learned {time}',
  libraryDelete: 'Delete',
  libraryDeleteDone: 'Learned feature removed successfully',
  libraryClearDone: 'Learned feature library cleared',
  libraryLoadFailed: 'Failed to load learned features: {msg}',
  libraryUpdateFailed: 'Failed to update learned features: {msg}',
  libraryClearConfirm: 'Clear all auto-learned feature signatures?'
});

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

function detectUiLanguage() {
  return /^zh\b/i.test(navigator.language || '') ? 'zh' : 'en';
}

function ensureKeywordNote() {
  if (document.getElementById('text-keywords-note')) return;
  const desc = document.getElementById('text-keywords-desc');
  if (!desc || !desc.parentNode) return;
  const note = document.createElement('p');
  note.id = 'text-keywords-note';
  note.className = 'desc small';
  desc.insertAdjacentElement('afterend', note);
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

function applyStaticTranslations() {
  document.documentElement.lang = uiLanguage === 'zh' ? 'zh-CN' : 'en';
  document.title = t('pageTitle');
  setText('text-page-title', `⚙ ${t('pageTitle')}`);
  setText('text-provider-title', t('sectionProviderTitle'));
  setText('text-provider-desc', t('sectionProviderDesc'));
  setText('label-provider', t('labelProvider'));
  setText('btn-save', t('btnSaveConfig'));
  setText('btn-test-config', t('btnTestConfig'));
  setText('text-strategy-title', t('sectionStrategyTitle'));
  setText('text-strategy-desc', t('sectionStrategyDesc'));
  setText('label-threshold', t('labelThreshold'));
  setText('text-threshold-desc', t('thresholdDesc'));
  setText('label-keywords', t('labelKeywords'));
  setText('text-keywords-desc', t('keywordsDesc'));
  setText('text-keywords-note', t('keywordsNote'));
  setText('btn-save-threshold', t('btnSaveThreshold'));
  setText('text-library-title', t('sectionLibraryTitle'));
  setText('text-library-desc', t('sectionLibraryDesc'));
  setText('btn-refresh-library', t('btnRefreshLibrary'));
  setText('btn-clear-library', t('btnClearLibrary'));
  if (learnedFeaturesStatus?.dataset.state === 'loading') {
    learnedFeaturesStatus.textContent = t('libraryLoading');
  }
  if (learnedFeaturesEmpty && learnedFeaturesEmpty.classList.contains('hidden') === false) {
    learnedFeaturesEmpty.textContent = t('libraryEmpty');
  }
  setText('text-performance-title', t('sectionPerformanceTitle'));
  setText('text-performance-desc', t('sectionPerformanceDesc'));
  setText('btn-save-performance', t('btnSavePerformance'));
  setText('text-prompt-title', t('sectionPromptTitle'));
  setText('text-prompt-desc', t('sectionPromptDesc'));
  setText('label-custom-prompt', t('labelCustomPrompt'));
  setText('btn-save-prompt', t('btnSavePrompt'));
  setText('text-about-title', t('sectionAboutTitle'));
  setText('text-version', t('versionText'));
  if (currentLearnedFeatures.length > 0) {
    renderLearnedFeatureLibrary(currentLearnedFeatures);
  }
}

// Keep in sync with background.js defaultDetectionRules()
const DEFAULT_DETECTION_RULES = [
  '【高置信度特征】：',
  '1. 营销/广告/引流话术、重复模板语言、可疑短链接',
  '2. 无实质内容的博眼球文字、机器人常见套路（抽奖转发等）',
  '3. 短时间内多条语义高度重复内容',
  '4. ⭐【自动回复机器人】：推文结构高度模板化，包含大量重复短语、固定话术块、',
  '   相同的账号/话题提及（如 @xxx、#xxx 出现频次异常高），',
  '   仅在特定位置有变化（如开头感叹词：卧槽、牛逼、炸裂 等，',
  '   但中间核心内容完全相同），这是自动回复/复制粘贴机器人的典型表现。',
  '   请提高这类推文的可疑程度。',
  '5. 推文中如果存在重复出现的长短语或整段复制的结构，高度怀疑是模板自动发送。'
].join('\n');

const saveBtn  = document.getElementById('btn-save');
const testConfigBtn = document.getElementById('btn-test-config');
const saveMsg  = document.getElementById('save-msg');

const toggleGeminiBtn = document.getElementById('btn-toggle-gemini');
const toggleOpenaiBtn = document.getElementById('btn-toggle-openai');

const DEFAULT_SPAM_THRESHOLD = 0.8;
const DEFAULT_ANALYSIS_BATCH_SIZE = 25;
const DEFAULT_ANALYSIS_PARALLELISM = 0;
const DEFAULT_SCRAPE_SCROLL_WAIT_MS = 1200;
const DEFAULT_SCRAPE_MAX_ROUNDS = 120;
const DEFAULT_SCRAPE_MAX_TWEETS = 1000;
const DEFAULT_SCRAPE_STAGNANT_ROUNDS = 4;

function normalizeThreshold(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return DEFAULT_SPAM_THRESHOLD;
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
  return normalizeInt(v, 1, 6, DEFAULT_ANALYSIS_PARALLELISM);
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

function parseKeywordList(text) {
  const seen = new Set();
  return String(text || '')
    .split(/[\n,，、;；]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => {
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 100);
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

const PRESETS = {
  openai: {
    url: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    label: '固定端点：api.openai.com',
    apiType: 'openai_compat',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1']
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/messages',
    model: 'claude-sonnet-4-20250514',
    label: '固定端点：api.anthropic.com · 使用 Anthropic Messages API',
    apiType: 'anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-latest']
  },
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    label: '固定端点：api.deepseek.com',
    apiType: 'openai_compat',
    models: ['deepseek-chat', 'deepseek-reasoner']
  },
  qwen: {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    label: '固定端点：dashscope.aliyuncs.com',
    apiType: 'openai_compat',
    models: ['qwen-plus', 'qwen-max', 'qwen-turbo', 'qwen-long']
  },
  xai: {
    url: 'https://api.x.ai/v1/chat/completions',
    model: 'grok-4',
    label: '固定端点：api.x.ai',
    apiType: 'openai_compat',
    models: ['grok-4', 'grok-3', 'grok-3-mini']
  },
  openrouter: {
    url: 'https://openrouter.ai/api/v1/chat/completions',
    model: 'openai/gpt-4o-mini',
    label: '固定端点：openrouter.ai · 模型名使用 provider/model 格式',
    apiType: 'openai_compat',
    models: ['openai/gpt-4o-mini', 'anthropic/claude-sonnet-4.5', 'google/gemini-2.5-flash', 'deepseek/deepseek-chat']
  },
  groq: {
    url: 'https://api.groq.com/openai/v1/chat/completions',
    model: 'llama-3.3-70b-versatile',
    label: '固定端点：api.groq.com',
    apiType: 'openai_compat',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']
  },
  mistral: {
    url: 'https://api.mistral.ai/v1/chat/completions',
    model: 'mistral-large-latest',
    label: '固定端点：api.mistral.ai',
    apiType: 'openai_compat',
    models: ['mistral-large-latest', 'mistral-medium-latest', 'mistral-small-latest', 'ministral-8b-latest']
  },
  together: {
    url: 'https://api.together.xyz/v1/chat/completions',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    label: '固定端点：api.together.xyz',
    apiType: 'openai_compat',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'Qwen/Qwen3.5-9B', 'deepseek-ai/DeepSeek-V3']
  },
  siliconflow: {
    url: 'https://api.siliconflow.cn/v1/chat/completions',
    model: 'Qwen/Qwen2.5-72B-Instruct',
    label: '固定端点：api.siliconflow.cn',
    apiType: 'openai_compat',
    models: ['Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V3', 'THUDM/glm-4-9b-chat']
  },
  moonshot: {
    url: 'https://api.moonshot.cn/v1/chat/completions',
    model: 'moonshot-v1-8k',
    label: '固定端点：api.moonshot.cn',
    apiType: 'openai_compat',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
  },
  zhipu: {
    url: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    model: 'glm-4-flash',
    label: '固定端点：open.bigmodel.cn',
    apiType: 'openai_compat',
    models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air']
  },
  doubao: {
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    model: '',
    label: '固定端点：ark.cn-beijing.volces.com · 模型名填写火山方舟 Endpoint ID',
    apiType: 'openai_compat',
    models: ['请填写火山方舟 Endpoint ID']
  },
  custom_openai: {
    url: '',
    model: '',
    label: '填写 OpenAI 兼容 base URL 或完整 chat/completions URL',
    apiType: 'openai_compat',
    models: ['gpt-4o-mini', 'deepseek-chat', 'qwen-plus', 'llama-3.3-70b-versatile']
  }
};

function normalizeProvider(provider) {
  if (provider === 'openai_compat') return 'custom_openai';
  return provider === 'gemini' || PRESETS[provider]
    ? provider
    : 'gemini';
}

function applyPresetIfNeeded(provider, forceModelReset = false) {
  const p = PRESETS[provider];
  if (!p) return;

  openaiEndpointText.textContent = p.label;
  customUrlWrap.classList.toggle('hidden', provider !== 'custom_openai');
  if (provider !== 'custom_openai') {
    openaiUrlInput.value = p.url;
  }
  renderModelSuggestions(p.models || []);
  if (forceModelReset || !openaiModelInput.value.trim()) {
    openaiModelInput.value = p.model;
  }
}

function renderModelSuggestions(models) {
  modelSuggestions.innerHTML = '';
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model;
    modelSuggestions.appendChild(option);
  });
}

function loadSettings() {
  chrome.storage.local.get(
    [
      'llmProvider',
      'geminiApiKey',
      'geminiModel',
      'openaiApiKey',
      'openaiApiUrl',
      'openaiModel',
      'spamConfidenceThreshold',
      'obviousBotKeywords',
      'customDetectionPrompt',
      'analysisBatchSize',
      'analysisParallelism',
      'scrapeScrollWaitMs',
      'scrapeMaxRounds',
      'scrapeMaxTweets',
      'scrapeStagnantRounds'
    ],
    d => {
      providerSel.value = normalizeProvider(d.llmProvider || 'gemini');
      geminiKeyInput.value = d.geminiApiKey || '';
      geminiModelSel.value = d.geminiModel || 'auto';
      openaiKeyInput.value = d.openaiApiKey || '';
      openaiUrlInput.value = d.openaiApiUrl || '';
      openaiModelInput.value = d.openaiModel || '';
      spamThresholdInput.value = String(Math.round(normalizeThreshold(d.spamConfidenceThreshold) * 100));
      obviousBotKeywordsInput.value = Array.isArray(d.obviousBotKeywords)
        ? d.obviousBotKeywords.join('\n')
        : '';
      analysisBatchSizeInput.value = String(normalizeAnalysisBatchSize(d.analysisBatchSize));
      analysisParallelismInput.value = String(normalizeAnalysisParallelism(d.analysisParallelism));
      scrapeScrollWaitMsInput.value = String(normalizeScrapeScrollWaitMs(d.scrapeScrollWaitMs));
      scrapeMaxRoundsInput.value = String(normalizeScrapeMaxRounds(d.scrapeMaxRounds));
      scrapeMaxTweetsInput.value = String(normalizeScrapeMaxTweets(d.scrapeMaxTweets));
      scrapeStagnantRoundsInput.value = String(normalizeScrapeStagnantRounds(d.scrapeStagnantRounds));
      customPromptInput.value = (typeof d.customDetectionPrompt === 'string' && d.customDetectionPrompt.trim())
        ? d.customDetectionPrompt
        : DEFAULT_DETECTION_RULES;
      renderProviderFields(providerSel.value);
      applyPresetIfNeeded(providerSel.value);
      applyStaticTranslations();
    }
  );
}

async function initPage() {
  ensureKeywordNote();
  await loadUiLanguage();
  if (langSelect) {
    langSelect.value = uiLanguage;
    langSelect.addEventListener('change', async () => {
      uiLanguage = langSelect.value === 'en' ? 'en' : 'zh';
      try {
        await chrome.storage.local.set({ [UI_LANG_KEY]: uiLanguage });
      } catch (_) {}
      applyStaticTranslations();
      applyPresetIfNeeded(providerSel.value);
      renderLearnedFeatureLibrary(currentLearnedFeatures);
    });
  }
  applyStaticTranslations();
  loadSettings();
  refreshLearnedFeatureLibrary();
}

initPage().catch(() => {
  applyStaticTranslations();
  loadSettings();
});

providerSel.addEventListener('change', () => {
  const selected = providerSel.value;
  renderProviderFields(selected);
  applyPresetIfNeeded(selected, true);
});

toggleGeminiBtn.addEventListener('click', () => {
  geminiKeyInput.type = geminiKeyInput.type === 'password' ? 'text' : 'password';
});

toggleOpenaiBtn.addEventListener('click', () => {
  openaiKeyInput.type = openaiKeyInput.type === 'password' ? 'text' : 'password';
});

if (refreshLibraryBtn) {
  refreshLibraryBtn.addEventListener('click', () => {
    refreshLearnedFeatureLibrary();
  });
}

if (clearLibraryBtn) {
  clearLibraryBtn.addEventListener('click', () => {
    clearLearnedFeatureLibrary();
  });
}

function storageSetAsync(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

async function saveProviderConfig(showSuccess = true) {
  const selected = providerSel.value;

  if (selected === 'gemini') {
    const key = geminiKeyInput.value.trim();
    const model = geminiModelSel.value || 'auto';
    if (!key) {
      showMsg(t('errGeminiKeyRequired'), false);
      return false;
    }
    if (!key.startsWith('AIza')) {
      showMsg(t('errGeminiPrefix'), false);
      return false;
    }

    await storageSetAsync({
      llmProvider: 'gemini',
      geminiApiKey: key,
      geminiModel: model
    });
    if (showSuccess) showMsg(t('okGeminiSaved'), true);
    return true;
  }

  const preset = PRESETS[selected];
  if (!preset) {
    showMsg(t('errProviderUnsupported'), false);
    return false;
  }

  const apiKey = openaiKeyInput.value.trim();
  const apiUrl = selected === 'custom_openai'
    ? normalizeOpenAICompatibleApiUrl(openaiUrlInput.value)
    : preset.url;
  const model = openaiModelInput.value.trim() || preset.model;

  if (!apiUrl || !/^https?:\/\/.+/i.test(apiUrl)) {
    showMsg(t('errApiUrlInvalid'), false);
    return false;
  }
  if (!model) {
    showMsg(t('errModelRequired'), false);
    return false;
  }
  if (!apiKey) {
    showMsg(t('errApiKeyRequired'), false);
    return false;
  }

  if (selected === 'custom_openai') {
    const granted = await requestCustomEndpointPermission(apiUrl);
    if (!granted) {
      showMsg(t('errEndpointPermission'), false);
      return false;
    }
  }

  await storageSetAsync({
    llmProvider: selected,
    openaiApiUrl: apiUrl,
    openaiApiKey: apiKey,
    openaiModel: model,
    openaiApiType: preset.apiType
  });
  if (showSuccess) showMsg(t('okProviderSaved'), true);
  return true;
}

saveBtn.addEventListener('click', async () => {
  await saveProviderConfig(true);
});

testConfigBtn.addEventListener('click', async () => {
  const saved = await saveProviderConfig(false);
  if (!saved) return;

  testConfigBtn.disabled = true;
  saveBtn.disabled = true;
  showMsg(t('testingConfig'), true);
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'testProviderConfig' });
    if (!resp?.ok) throw new Error(resp?.error || t('unknownError'));
    showMsg(t('okConfigUsable'), true);
  } catch (e) {
    showMsg(t('errConfigFailed', { msg: e.message }), false);
  } finally {
    testConfigBtn.disabled = false;
    saveBtn.disabled = false;
  }
});

function requestCustomEndpointPermission(apiUrl) {
  let origin;
  try {
    origin = new URL(apiUrl).origin;
  } catch (_) {
    return Promise.resolve(false);
  }

  return new Promise(resolve => {
    chrome.permissions.request({ origins: [`${origin}/*`] }, granted => {
      if (chrome.runtime.lastError) {
        resolve(false);
        return;
      }
      resolve(Boolean(granted));
    });
  });
}

function renderProviderFields(provider) {
  if (provider === 'gemini') {
    geminiFields.classList.remove('hidden');
    openaiFields.classList.add('hidden');
    return;
  }

  geminiFields.classList.add('hidden');
  openaiFields.classList.remove('hidden');
}

function formatTimestamp(ts) {
  const value = Number(ts || 0);
  if (!Number.isFinite(value) || value <= 0) return '-';
  try {
    return new Date(value).toLocaleString(uiLanguage === 'zh' ? 'zh-CN' : 'en-US');
  } catch (_) {
    return new Date(value).toISOString();
  }
}

function showLibraryMsg(text, ok) {
  const el = document.getElementById('library-msg');
  el.textContent = text;
  el.className = 'save-msg ' + (ok ? 'ok' : 'err');
}

function renderLearnedFeatureLibrary(features = []) {
  if (!learnedFeaturesList || !learnedFeaturesEmpty || !learnedFeaturesStatus) return;

  const rows = Array.isArray(features) ? features.slice() : [];
  currentLearnedFeatures = rows;
  const activeCount = rows.filter(entry => Number(entry?.seenCount || 0) >= 2).length;
  learnedFeaturesStatus.dataset.state = 'ready';
  learnedFeaturesStatus.textContent = rows.length > 0
    ? t(activeCount > 0 ? 'libraryStatusCountActive' : 'libraryStatusCount', { n: rows.length, a: activeCount })
    : t('libraryEmpty');

  learnedFeaturesList.innerHTML = '';
  if (rows.length === 0) {
    learnedFeaturesList.classList.add('hidden');
    learnedFeaturesEmpty.classList.remove('hidden');
    learnedFeaturesEmpty.textContent = t('libraryEmpty');
    return;
  }

  learnedFeaturesEmpty.classList.add('hidden');
  learnedFeaturesList.classList.remove('hidden');

  rows.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'feature-item';

    const top = document.createElement('div');
    top.className = 'feature-top';

    const meta = document.createElement('div');
    meta.className = 'feature-meta';

    const badge = document.createElement('span');
    badge.className = 'feature-badge' + (Number(entry.seenCount || 0) >= 2 ? ' active' : '');
    badge.textContent = t('librarySeenCount', { n: Number(entry.seenCount || 0) });
    meta.appendChild(badge);

    const time = document.createElement('span');
    time.className = 'feature-time';
    time.textContent = `${t('libraryLastSeen', { time: formatTimestamp(entry.lastSeenAt) })} · ${t('libraryCreatedAt', { time: formatTimestamp(entry.createdAt) })}`;
    meta.appendChild(time);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-secondary feature-delete';
    removeBtn.textContent = t('libraryDelete');
    removeBtn.addEventListener('click', () => removeLearnedFeature(entry.id));

    top.appendChild(meta);
    top.appendChild(removeBtn);

    const featureText = document.createElement('div');
    featureText.className = 'feature-signature';
    featureText.textContent = Array.isArray(entry.features) ? entry.features.join(' + ') : '';

    item.appendChild(top);
    item.appendChild(featureText);
    learnedFeaturesList.appendChild(item);
  });
}

async function refreshLearnedFeatureLibrary(showMessage = false) {
  if (!learnedFeaturesStatus) return;
  learnedFeaturesStatus.dataset.state = 'loading';
  learnedFeaturesStatus.textContent = t('libraryLoading');
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'getAutoLearnedFeatures' });
    if (!resp?.ok) {
      throw new Error(resp?.error || t('unknownError'));
    }
    renderLearnedFeatureLibrary(resp.features || []);
    if (showMessage) {
      showLibraryMsg(t('btnRefreshLibrary'), true);
    }
  } catch (e) {
    learnedFeaturesStatus.dataset.state = 'error';
    learnedFeaturesStatus.textContent = t('libraryLoadFailed', { msg: e.message });
    if (learnedFeaturesList) learnedFeaturesList.classList.add('hidden');
    if (learnedFeaturesEmpty) learnedFeaturesEmpty.classList.remove('hidden');
    showLibraryMsg(t('libraryLoadFailed', { msg: e.message }), false);
  }
}

async function removeLearnedFeature(id) {
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'removeAutoLearnedFeature', id });
    if (!resp?.ok) {
      throw new Error(resp?.error || t('unknownError'));
    }
    renderLearnedFeatureLibrary(resp.features || []);
    showLibraryMsg(t('libraryDeleteDone'), true);
  } catch (e) {
    showLibraryMsg(t('libraryUpdateFailed', { msg: e.message }), false);
  }
}

async function clearLearnedFeatureLibrary() {
  if (!window.confirm(t('libraryClearConfirm'))) return;
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'clearAutoLearnedFeatures' });
    if (!resp?.ok) {
      throw new Error(resp?.error || t('unknownError'));
    }
    renderLearnedFeatureLibrary(resp.features || []);
    showLibraryMsg(t('libraryClearDone'), true);
  } catch (e) {
    showLibraryMsg(t('libraryUpdateFailed', { msg: e.message }), false);
  }
}

document.getElementById('btn-save-threshold').addEventListener('click', () => {
  const thresholdPct = Number(spamThresholdInput.value);

  if (!Number.isFinite(thresholdPct) || thresholdPct < 50 || thresholdPct > 100) {
    showThresholdMsg(t('errThresholdRange'), false);
    return;
  }

  chrome.storage.local.set(
    {
      spamConfidenceThreshold: normalizeThreshold(thresholdPct / 100),
      obviousBotKeywords: parseKeywordList(obviousBotKeywordsInput.value)
    },
    () => showThresholdMsg(t('okThresholdSaved'), true)
  );
});

document.getElementById('btn-save-prompt').addEventListener('click', () => {
  const val = (customPromptInput.value || '').trim();
  // If user restores to default, treat as clear
  const isDefault = val === DEFAULT_DETECTION_RULES;
  chrome.storage.local.set(
    { customDetectionPrompt: isDefault ? '' : val },
    () => showPromptMsg(isDefault ? t('okPromptReset') : t('okPromptSaved'), true)
  );
});

document.getElementById('btn-save-performance').addEventListener('click', () => {
  const analysisBatchSize = normalizeAnalysisBatchSize(analysisBatchSizeInput.value);
  const analysisParallelism = normalizeAnalysisParallelism(analysisParallelismInput.value);
  const scrapeScrollWaitMs = normalizeScrapeScrollWaitMs(scrapeScrollWaitMsInput.value);
  const scrapeMaxRounds = normalizeScrapeMaxRounds(scrapeMaxRoundsInput.value);
  const scrapeMaxTweets = normalizeScrapeMaxTweets(scrapeMaxTweetsInput.value);
  const scrapeStagnantRounds = normalizeScrapeStagnantRounds(scrapeStagnantRoundsInput.value);

  analysisBatchSizeInput.value = String(analysisBatchSize);
  analysisParallelismInput.value = String(analysisParallelism);
  scrapeScrollWaitMsInput.value = String(scrapeScrollWaitMs);
  scrapeMaxRoundsInput.value = String(scrapeMaxRounds);
  scrapeMaxTweetsInput.value = String(scrapeMaxTweets);
  scrapeStagnantRoundsInput.value = String(scrapeStagnantRounds);

  chrome.storage.local.set(
    {
      analysisBatchSize,
      analysisParallelism,
      scrapeScrollWaitMs,
      scrapeMaxRounds,
      scrapeMaxTweets,
      scrapeStagnantRounds
    },
    () => showPerformanceMsg(t('okPerformanceSaved'), true)
  );
});

function showMsg(text, ok) {
  saveMsg.textContent = text;
  saveMsg.className = 'save-msg ' + (ok ? 'ok' : 'err');
}

function showThresholdMsg(text, ok) {
  const el = document.getElementById('threshold-msg');
  el.textContent = text;
  el.className = 'save-msg ' + (ok ? 'ok' : 'err');
}

function showPromptMsg(text, ok) {
  const el = document.getElementById('prompt-msg');
  el.textContent = text;
  el.className = 'save-msg ' + (ok ? 'ok' : 'err');
}

function showPerformanceMsg(text, ok) {
  const el = document.getElementById('performance-msg');
  el.textContent = text;
  el.className = 'save-msg ' + (ok ? 'ok' : 'err');
}
