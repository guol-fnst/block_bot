'use strict';

const providerSel = document.getElementById('provider');
const geminiFields = document.getElementById('gemini-fields');
const openaiFields = document.getElementById('openai-fields');
const openaiEndpointText = document.getElementById('openai-endpoint');

const geminiKeyInput = document.getElementById('gemini-key');
const geminiModelSel = document.getElementById('gemini-model');
const openaiModelInput = document.getElementById('openai-model');
const openaiKeyInput = document.getElementById('openai-key');
const spamThresholdInput = document.getElementById('spam-threshold');

const saveBtn  = document.getElementById('btn-save');
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

const PRESETS = {
  deepseek: {
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat',
    label: '固定端点：api.deepseek.com'
  },
  qwen: {
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus',
    label: '固定端点：dashscope.aliyuncs.com'
  }
};

function normalizeProvider(provider) {
  return provider === 'deepseek' || provider === 'qwen' || provider === 'gemini'
    ? provider
    : 'gemini';
}

function applyPresetIfNeeded(provider, forceModelReset = false) {
  const p = PRESETS[provider];
  if (!p) return;

  openaiEndpointText.textContent = p.label;
  if (forceModelReset || !openaiModelInput.value.trim()) {
    openaiModelInput.value = p.model;
  }
}

chrome.storage.local.get(
  ['llmProvider', 'geminiApiKey', 'geminiModel', 'openaiApiKey', 'openaiModel', 'spamConfidenceThreshold'],
  d => {
    providerSel.value = normalizeProvider(d.llmProvider || 'gemini');
    geminiKeyInput.value = d.geminiApiKey || '';
    geminiModelSel.value = d.geminiModel || 'auto';
    openaiKeyInput.value = d.openaiApiKey || '';
    openaiModelInput.value = d.openaiModel || '';
    spamThresholdInput.value = String(Math.round(normalizeThreshold(d.spamConfidenceThreshold) * 100));
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

saveBtn.addEventListener('click', () => {
  const selected = providerSel.value;

  if (selected === 'gemini') {
    const key = geminiKeyInput.value.trim();
    const model = geminiModelSel.value || 'auto';
    if (!key) {
      showMsg('请输入 Gemini API Key', false);
      return;
    }
    if (!key.startsWith('AIza')) {
      showMsg('Gemini Key 通常以 "AIza" 开头', false);
      return;
    }

    chrome.storage.local.set({
      llmProvider: 'gemini',
      geminiApiKey: key,
      geminiModel: model
    }, () => showMsg('Gemini 配置已保存 ✓', true));
    return;
  }

  const preset = PRESETS[selected];
  if (!preset) {
    showMsg('请选择受支持的模型提供商', false);
    return;
  }

  const apiKey = openaiKeyInput.value.trim();
  const model = openaiModelInput.value.trim() || preset.model;

  if (!model) {
    showMsg('请输入模型名', false);
    return;
  }
  if (!apiKey) {
    showMsg('请输入 API Key', false);
    return;
  }

  chrome.storage.local.set({
    llmProvider: selected,
    openaiApiUrl: preset.url,
    openaiApiKey: apiKey,
    openaiModel: model
  }, () => showMsg(`${selected === 'deepseek' ? 'DeepSeek' : 'Qwen'} 配置已保存 ✓`, true));
});

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
    { spamConfidenceThreshold: normalizeThreshold(thresholdPct / 100) },
    () => showThresholdMsg('阈值已保存 ✓', true)
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
