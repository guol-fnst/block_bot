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

function normalizeThreshold(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return DEFAULT_SPAM_THRESHOLD;
  if (v < 0.5) return 0.5;
  if (v > 1) return 1;
  return v;
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
    label: '填写完整 OpenAI 兼容 chat/completions URL',
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
    'customDetectionPrompt'
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
    customPromptInput.value = (typeof d.customDetectionPrompt === 'string' && d.customDetectionPrompt.trim())
      ? d.customDetectionPrompt
      : DEFAULT_DETECTION_RULES;
    renderProviderFields(providerSel.value);
    applyPresetIfNeeded(providerSel.value);
  }
);

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

function storageSetAsync(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

async function saveProviderConfig(showSuccess = true) {
  const selected = providerSel.value;

  if (selected === 'gemini') {
    const key = geminiKeyInput.value.trim();
    const model = geminiModelSel.value || 'auto';
    if (!key) {
      showMsg('请输入 Gemini API Key', false);
      return false;
    }
    if (!key.startsWith('AIza')) {
      showMsg('Gemini Key 通常以 "AIza" 开头', false);
      return false;
    }

    await storageSetAsync({
      llmProvider: 'gemini',
      geminiApiKey: key,
      geminiModel: model
    });
    if (showSuccess) showMsg('Gemini 配置已保存 ✓', true);
    return true;
  }

  const preset = PRESETS[selected];
  if (!preset) {
    showMsg('请选择受支持的模型提供商', false);
    return false;
  }

  const apiKey = openaiKeyInput.value.trim();
  const apiUrl = selected === 'custom_openai' ? openaiUrlInput.value.trim() : preset.url;
  const model = openaiModelInput.value.trim() || preset.model;

  if (!apiUrl || !/^https:\/\/.+/i.test(apiUrl)) {
    showMsg('请输入 https:// 开头的 API URL', false);
    return false;
  }
  if (!model) {
    showMsg('请输入模型名', false);
    return false;
  }
  if (!apiKey) {
    showMsg('请输入 API Key', false);
    return false;
  }

  if (selected === 'custom_openai') {
    const granted = await requestCustomEndpointPermission(apiUrl);
    if (!granted) {
      showMsg('未授予该 API 域名权限，无法保存自定义端点', false);
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
  if (showSuccess) showMsg('模型配置已保存 ✓', true);
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
  showMsg('正在测试模型配置…', true);
  try {
    const resp = await chrome.runtime.sendMessage({ action: 'testProviderConfig' });
    if (!resp?.ok) throw new Error(resp?.error || '测试失败');
    showMsg('测试通过，模型配置可用 ✓', true);
  } catch (e) {
    showMsg('测试失败：' + e.message, false);
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

document.getElementById('btn-save-threshold').addEventListener('click', () => {
  const thresholdPct = Number(spamThresholdInput.value);

  if (!Number.isFinite(thresholdPct) || thresholdPct < 50 || thresholdPct > 100) {
    showThresholdMsg('屏蔽阈值必须在 50 到 100 之间', false);
    return;
  }

  chrome.storage.local.set(
    {
      spamConfidenceThreshold: normalizeThreshold(thresholdPct / 100),
      obviousBotKeywords: parseKeywordList(obviousBotKeywordsInput.value)
    },
    () => showThresholdMsg('屏蔽策略已保存 ✓', true)
  );
});

document.getElementById('btn-save-prompt').addEventListener('click', () => {
  const val = (customPromptInput.value || '').trim();
  // If user restores to default, treat as clear
  const isDefault = val === DEFAULT_DETECTION_RULES;
  chrome.storage.local.set(
    { customDetectionPrompt: isDefault ? '' : val },
    () => showPromptMsg(isDefault ? '已恢复为默认提示词 ✓' : '自定义提示词已保存 ✓', true)
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
