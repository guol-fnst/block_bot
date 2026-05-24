/**
 * Block Bot — Regression Test Suite
 * Run with:  node _tests/regression.mjs
 *
 * Uses Node vm to load background.js with a minimal chrome-API mock so all
 * pure detection functions can be exercised without a real browser.
 */

import { readFileSync } from 'fs';
import vm from 'vm';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Chrome API mock ──────────────────────────────────────────────────────────
const storageMem = {};
const chromeMock = {
  storage: {
    local: {
      get: (keys, cb) => { const r = {}; (Array.isArray(keys) ? keys : [keys]).forEach(k => { if (k in storageMem) r[k] = storageMem[k]; }); if (cb) cb(r); return Promise.resolve(r); },
      set: (obj, cb) => { Object.assign(storageMem, obj); if (cb) cb(); return Promise.resolve(); },
      remove: (keys, cb) => { (Array.isArray(keys) ? keys : [keys]).forEach(k => delete storageMem[k]); if (cb) cb(); return Promise.resolve(); }
    }
  },
  runtime: {
    onMessage: { addListener: () => {} },
    lastError: null,
    id: 'test'
  },
  tabs: {
    onUpdated: { addListener: () => {} },
    onRemoved: { addListener: () => {} },
    get: () => Promise.resolve({ url: 'https://x.com/test' }),
    sendMessage: () => Promise.resolve()
  },
  scripting: { executeScript: () => Promise.resolve([]) },
  action: { setIcon: () => {}, setBadgeText: () => {}, setBadgeBackgroundColor: () => {} }
};

// ── Load background.js in a vm context ──────────────────────────────────────
const bgPath = join(__dirname, '..', 'background', 'background.js');
const bgCode = readFileSync(bgPath, 'utf8');

const ctx = {
  chrome: chromeMock,
  console,
  setTimeout, clearTimeout, setInterval, clearInterval,
  Promise, JSON, Math, Date, Error, Set, Map, Array, Object, String, Number, Boolean,
  RegExp, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }),
  self: {},
};
vm.createContext(ctx);
try {
  vm.runInContext(bgCode, ctx, { filename: 'background.js' });
} catch (e) {
  console.error('Failed to load background.js:', e.message);
  process.exit(1);
}

// Pull the pure functions out of the vm context
const {
  looksLikeRandomHandle,
  hasDecorativeTemplateSignal,
  hasEmojiDecoratedShortEnglishPhrase,
  countEmojiChars,
  hasEmojiBurst,
  getEnglishJokeTemplateFamily,
  detectObviousBotReply,
  addJokeTemplateClusterResults,
  buildLocalRuleHit,
  normalizeCandidates,
  hasObviousBotKeyword,
} = ctx;

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
const failures = [];

function assert(label, actual, expected) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(`  FAIL: ${label}\n       expected=${JSON.stringify(expected)}  got=${JSON.stringify(actual)}`);
  }
}

function assertTruthy(label, actual) {
  if (actual) { passed++; } else { failed++; failures.push(`  FAIL: ${label}  (expected truthy, got ${JSON.stringify(actual)})`); }
}

function assertFalsy(label, actual) {
  if (!actual) { passed++; } else { failed++; failures.push(`  FAIL: ${label}  (expected falsy, got ${JSON.stringify(actual)})`); }
}

function assertDetected(label, tweet, minConfidence = 0.8) {
  const r = detectObviousBotReply(tweet);
  if (r && r.isSpamOrBot && r.confidence >= minConfidence) {
    passed++;
  } else {
    failed++;
    failures.push(`  FAIL: ${label}  detectObviousBotReply → ${r ? `conf=${r.confidence} isBot=${r.isSpamOrBot}` : 'null'}`);
  }
}

function assertNotDetected(label, tweet) {
  const r = detectObviousBotReply(tweet);
  if (!r) {
    passed++;
  } else {
    failed++;
    failures.push(`  FAIL: ${label}  expected null, got conf=${r.confidence} reason="${r.reason}"`);
  }
}

function section(name) {
  console.log(`\n── ${name}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. looksLikeRandomHandle
// ═══════════════════════════════════════════════════════════════════════════
section('looksLikeRandomHandle');
assert('dqikco32633 (6 letters + 5 digits)', looksLikeRandomHandle('@dqikco32633'), true);
assert('ansqyfgo458 (8 letters + 3 digits)',  looksLikeRandomHandle('@ansqyfgo458'), true);
assert('Hralx284483 (5 mixed-case + 6 digits)', looksLikeRandomHandle('@Hralx284483'), true);
assert('ackshb18912 (10+ lowercase alphanumeric)', looksLikeRandomHandle('@ackshb18912'), true);
assert('oystpua20877 (7 letters + 5 digits)', looksLikeRandomHandle('@oystpua20877'), true);
assert('kghvrt73422 (6 letters + 5 digits)',  looksLikeRandomHandle('@kghvrt73422'), true);
assert('JohnSmith1234 (camel-case + 4 digits)', looksLikeRandomHandle('@JohnSmith1234'), true);
// Should NOT flag legitimate-looking handles
assert('normal handle – word only',        looksLikeRandomHandle('@elonmusk'),    false);
assert('normal handle – short digits',     looksLikeRandomHandle('@user42'),      false);
assert('normal handle – letters only',     looksLikeRandomHandle('@openai'),      false);

// ═══════════════════════════════════════════════════════════════════════════
// 2. hasEmojiDecoratedShortEnglishPhrase  (threshold 0.75)
// ═══════════════════════════════════════════════════════════════════════════
section('hasEmojiDecoratedShortEnglishPhrase');
// These all have ratio < 0.75 and ≥5 emoji and 4–13 words
assert('dqikco32633 text (ratio 0.62)',
  hasEmojiDecoratedShortEnglishPhrase('\u{AA70}\u{1F342}\u{1F3CC}\u{1F3FC} I fall in love with you more every morning. *\u{1F343}\u{1F38B}\u{1F33A}\u{1F338}\u{1F338}'),
  true);
assert('Hralx284483 text',
  hasEmojiDecoratedShortEnglishPhrase('\u{1F319}\u{1F319}* \u{1F319} I can feel fake energy easily. \u{1F319}\u2744\uFE0F\u26E9\uFE0F\u{1F339}\u{1F340}'),
  true);
assert('ackshb18912 text',
  hasEmojiDecoratedShortEnglishPhrase('\u2728\u2606*\u{1F41D} I love quiet cozy places. *\u{1F30C}\u{1F319}\u2726*\u{1F98B}\u{1F6A9}\u{1F308}\u{1F382}\u{1F680}'),
  true);
// Too few emoji → false
assert('plain sentence no emoji',
  hasEmojiDecoratedShortEnglishPhrase('I love quiet cozy places.'),
  false);
// Too many words → false
assert('17-word sentence with emoji',
  hasEmojiDecoratedShortEnglishPhrase('\u{1F319}\u{1F319}\u{1F319}\u{1F319}\u{1F319} one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen'),
  false);

// ═══════════════════════════════════════════════════════════════════════════
// 3. hasDecorativeTemplateSignal
// ═══════════════════════════════════════════════════════════════════════════
section('hasDecorativeTemplateSignal');
assertTruthy('dqikco32633 text',
  hasDecorativeTemplateSignal('\u{AA70}\u{1F342}\u{1F3CC}\u{1F3FC} I fall in love with you more every morning. *\u{1F343}\u{1F38B}\u{1F33A}\u{1F338}\u{1F338}'));
assertTruthy('oystpua20877 text',
  hasDecorativeTemplateSignal('\u{1F341}\u{1F3C2} \u224B\u2080\u{1F3D4}\uFE0F Hotel California holds endless lonely stories. *\u{1F4A0}\u{1F319}\u224B\u2726* \u{1F341}'));
assertFalsy('plain English sentence',
  hasDecorativeTemplateSignal('Hello, how are you today?'));
assertFalsy('very short text',
  hasDecorativeTemplateSignal('\u{1F319} hi'));

// ═══════════════════════════════════════════════════════════════════════════
// 4. detectObviousBotReply — per-tweet detection
// ═══════════════════════════════════════════════════════════════════════════
section('detectObviousBotReply — known bots');
const BOT_TWEETS = [
  { handle: '@dqikco32633',  displayName: 'Dqikco',  text: '\u{AA70}\u{1F342}\u{1F3CC}\u{1F3FC} I fall in love with you more every morning. *\u{1F343}\u{1F38B}\u{1F33A}\u{1F338}\u{1F338}' },
  { handle: '@Hralx284483',  displayName: 'Hralx',   text: '\u{1F319}\u{1F319}* \u{1F319} I can feel fake energy easily. \u{1F319}\u2744\uFE0F\u26E9\uFE0F\u{1F339}\u{1F340}' },
  { handle: '@ansqyfgo458',  displayName: 'Ansqyfgo', text: '\u{1F319}\u2726* \u{1F319} I go with my mood every day. \u{1F319}\u2022\u{1F311}*\u2726' },
  { handle: '@ackshb18912',  displayName: 'Ackshb',  text: '\u2728\u2606*\u{1F41D} I love quiet cozy places. *\u{1F30C}\u{1F319}\u2726*\u{1F98B}\u{1F6A9}\u{1F308}\u{1F382}\u{1F680}' },
  { handle: '@oystpua20877', displayName: 'Oystpua', text: '\u{1F341}\u{1F3C2} \u224B\u2080\u{1F3D4}\uFE0F Hotel California holds endless lonely stories. *\u{1F4A0}\u{1F319}\u224B\u2726* \u{1F341}' },
  { handle: '@kghvrt73422',  displayName: 'Kghvrt',  text: '*\u2022\u{1F31F}\u{1F33F}\u2726\u{1F319} Counting stars while chasing my own dream. *\u{1F300}\u2726*\u{1F341}\u{1F525}' },
];
for (const t of BOT_TWEETS) {
  assertDetected(t.handle, t, 0.88);
}

section('detectObviousBotReply — adult keyword bots');
assertDetected('maya58925857 (炮友 keyword)',
  { handle: '@maya58925857', displayName: '炮友交友', text: '来玩吧' }, 0.88);
assertDetected('adultname + random handle',
  { handle: '@xhdsj8823441', displayName: '找炮友', text: '🌸' }, 0.88);

section('detectObviousBotReply — joke template bots');
assertDetected('why-did joke template',
  { handle: '@abcde12345', displayName: 'Fun Bot',
    text: 'Why did the chicken cross the road? 🐔🐔🐔🐔🐔 To get to the other side! 🤣🤣🤣🤣🤣' }, 0.88);

section('detectObviousBotReply — should NOT flag normal users');
assertNotDetected('normal reply',
  { handle: '@johndoe', displayName: 'John Doe', text: 'Great post! Thanks for sharing.' });
assertNotDetected('normal emoji reply',
  { handle: '@alice', displayName: 'Alice', text: 'I love this! 🎉' });
assertNotDetected('legit short reply',
  { handle: '@news_bot99', displayName: 'News', text: 'Breaking: market closes up 2%' });

// ═══════════════════════════════════════════════════════════════════════════
// 5. addJokeTemplateClusterResults — emoji phrase cluster
// ═══════════════════════════════════════════════════════════════════════════
section('addJokeTemplateClusterResults — emoji phrase cluster (≥3 accounts)');
{
  const results = [];
  addJokeTemplateClusterResults(BOT_TWEETS, results);
  const detected = results.filter(r => r.isSpamOrBot);
  assert('cluster detects ≥3 bots from the 6-account thread',
    detected.length >= 3, true);
  assert('cluster confidence ≥ 0.90',
    detected.every(r => r.confidence >= 0.90), true);
}

section('addJokeTemplateClusterResults — cluster does NOT fire for <3 accounts');
{
  const results = [];
  addJokeTemplateClusterResults(BOT_TWEETS.slice(0, 2), results);
  assert('only 2 accounts → no cluster', results.length, 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. hasObviousBotKeyword
// ═══════════════════════════════════════════════════════════════════════════
section('hasObviousBotKeyword');
assertTruthy('炮友 in display name', hasObviousBotKeyword('炮友交友'));
assertTruthy('找炮 in display name', hasObviousBotKeyword('找炮友'));
assertFalsy('normal name',          hasObviousBotKeyword('John Smith'));

// ═══════════════════════════════════════════════════════════════════════════
// 7. normalizeCandidates — threshold filtering
// ═══════════════════════════════════════════════════════════════════════════
section('normalizeCandidates');
{
  const raw = [
    { handle: '@bot1', displayName: 'B1', isSpamOrBot: true,  confidence: 0.95, reason: 'x', evidenceTweet: '' },
    { handle: '@bot2', displayName: 'B2', isSpamOrBot: true,  confidence: 0.75, reason: 'x', evidenceTweet: '' },
    { handle: '@ok1',  displayName: 'O1', isSpamOrBot: false, confidence: 0.95, reason: 'x', evidenceTweet: '' },
    { handle: '@bot3', displayName: 'B3', isSpamOrBot: true,  confidence: 0.80, reason: 'x', evidenceTweet: '' },
  ];
  const out = normalizeCandidates(raw, 0.8);
  assert('passes conf≥0.8 bots only', out.length, 2);
  assert('bot1 selected (conf≥0.9)', out.find(r => r.handle === '@bot1')?.selected, true);
  assert('bot3 not selected (conf<0.9)', out.find(r => r.handle === '@bot3')?.selected, false);
}

// ═══════════════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(55));
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
