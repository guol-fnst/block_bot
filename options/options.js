'use strict';

const providerSel = document.getElementById('provider');
const geminiFields = document.getElementById('gemini-fields');
const openaiFields = document.getElementById('openai-fields');

const geminiKeyInput = document.getElementById('gemini-key');
const geminiModelSel = document.getElementById('gemini-model');
const openaiUrlInput = document.getElementById('openai-url');
const openaiModelInput = document.getElementById('openai-model');
const openaiKeyInput = document.getElementById('openai-key');

const saveBtn  = document.getElementById('btn-save');
const saveMsg  = document.getElementById('save-msg');

const toggleGeminiBtn = document.getElementById('btn-toggle-gemini');
const toggleOpenaiBtn = document.getElementById('btn-toggle-openai');

const PRESETS = {
  deepseek: {
    provider: 'openai_compat',
    url: 'https://api.deepseek.com/v1/chat/completions',
    model: 'deepseek-chat'
  },
  qwen: {
    provider: 'openai_compat',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-plus'
  }
};

chrome.storage.local.get(
  ['llmProvider', 'geminiApiKey', 'geminiModel', 'openaiApiUrl', 'openaiApiKey', 'openaiModel'],
  d => {
    providerSel.value = d.llmProvider || 'gemini';
    geminiKeyInput.value = d.geminiApiKey || '';
    geminiModelSel.value = d.geminiModel || 'auto';
    openaiUrlInput.value = d.openaiApiUrl || '';
    openaiKeyInput.value = d.openaiApiKey || '';
    openaiModelInput.value = d.openaiModel || '';
    renderProviderFields(providerSel.value);
  }
);

providerSel.addEventListener('change', () => {
  const selected = providerSel.value;
  if (selected === 'deepseek' || selected === 'qwen') {
    const p = PRESETS[selected];
    openaiUrlInput.value = p.url;
    openaiModelInput.value = p.model;
    renderProviderFields('openai_compat');
    return;
  }
  renderProviderFields(selected);
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

  const url = openaiUrlInput.value.trim();
  const apiKey = openaiKeyInput.value.trim();
  const model = openaiModelInput.value.trim();

  if (!url || !/^https:\/\//.test(url)) {
    showMsg('请输入有效的 OpenAI 兼容 API URL（仅支持 https）', false);
    return;
  }
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
    openaiApiUrl: url,
    openaiApiKey: apiKey,
    openaiModel: model
  }, () => showMsg('OpenAI 兼容配置已保存 ✓', true));
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

function showMsg(text, ok) {
  saveMsg.textContent = text;
  saveMsg.className = 'save-msg ' + (ok ? 'ok' : 'err');
}
