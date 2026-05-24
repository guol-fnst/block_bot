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
  hasMathSymbolPrefix,
  hasObscureScriptDecoration,
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
// 8. hasMathSymbolPrefix — math/unicode-operator prefix detection
// ═══════════════════════════════════════════════════════════════════════════
section('hasMathSymbolPrefix');
assert('∂∇∂ prefix (U+2202 U+2207)',       hasMathSymbolPrefix('\u2202\u2207\u2202 Can you give me a discount?'), true);
assert('⊗⊕⊖ prefix (U+2297 U+2295 U+2296)', hasMathSymbolPrefix('\u2297\u2295\u2296 I usually play it on Saturday afternoons.'), true);
assert('⊕⊖⊗ prefix',                        hasMathSymbolPrefix('\u2295\u2296\u2297 Yes they are. They look very beautiful.'), true);
assert('∪∩∈ prefix',                         hasMathSymbolPrefix('\u222A\u2229\u2208 I know that song.'), true);
assert('// slash prefix',                    hasMathSymbolPrefix('// \u26A1 /\\ I like reading books.'), true);
assert('/\\ slash prefix',                   hasMathSymbolPrefix('/\\ hello world'), true);
// Should NOT fire
assert('plain English text',                 hasMathSymbolPrefix('I love quiet cozy places.'), false);
assert('single math char (only 1)',          hasMathSymbolPrefix('\u221E miles away'), false);
assert('→ arrow (not in math op block)',     hasMathSymbolPrefix('\u2192 click here'), false);

// ═══════════════════════════════════════════════════════════════════════════
// 9. detectObviousBotReply — math-prefix bot cluster (screenshot bots)
// ═══════════════════════════════════════════════════════════════════════════
section('detectObviousBotReply — math-symbol-prefix bots (new wave)');
const MATH_PREFIX_BOTS = [
  { handle: '@Pzthc162184',  displayName: 'Pzthc',    text: '\u2202\u2207\u2202 Can you give me a discount? Sorry it is already on sale. \uD83C\uDF3A \uD83E\uDDF3 \u2B50 \uD83D\uDC4D \uD83C\uDF41' },
  { handle: '@dmegjsui22230', displayName: 'Dmegjsui', text: '\u2297\u2295\u2296 I usually play it on Saturday afternoons. \uD83C\uDF42 \uD83C\uDF38 \uD83E\uDE84' },
  { handle: '@zogsa71014',   displayName: 'Zogsa',     text: '// \u26A1 /\\ I like reading books and watching movies. \uD83C\uDF41 \uD83C\uDF86 \uD83C\uDF3A \uD83C\uDF1F' },
  { handle: '@mnxabrv38895', displayName: 'Mnxabrv',   text: '\u2295\u2296\u2297 Yes they are. They look very beautiful. \uD83C\uDF3F \uD83C\uDF10' },
  { handle: '@vaoefxb2234',  displayName: 'Vaoefxb',   text: '\u222A\u2229\u2208 I know that song it is very nice. \uD83E\uDDF3 \uD83C\uDFAD \uD83C\uDF10 \uD83E\uDDF3 \uD83E\uDD8B' },
];
for (const t of MATH_PREFIX_BOTS) {
  assertDetected(t.handle, t, 0.90);
}

section('addJokeTemplateClusterResults — math-prefix bot cluster');
{
  const results = [];
  addJokeTemplateClusterResults(MATH_PREFIX_BOTS, results);
  // Per-tweet rules already catch 4/5; the cluster should flag the remaining one (@mnxabrv38895)
  // All 5 should end up flagged between per-tweet + cluster combined
  const allResults = [
    ...MATH_PREFIX_BOTS.flatMap(t => { const r = detectObviousBotReply(t); return r ? [r] : []; }),
    ...results,
  ];
  const handles = new Set(allResults.map(r => r.handle.toLowerCase()));
  assert('all 5 math-prefix bots eventually flagged', handles.size, 5);
}

// ═══════════════════════════════════════════════════════════════
// 10. hasObscureScriptDecoration — Cham / Tai Viet / Rejang wrapped bots
// ═══════════════════════════════════════════════════════════════
section('hasObscureScriptDecoration');
// Should fire for all 4 known bot tweet patterns
assert('Cham-wrapped \u201cKeep exploring\u201d (5 emoji)',
  hasObscureScriptDecoration('\u29D2\uAA44\uAA45\uAA46\uA6A8\uAA69\uAA69 Keep exploring the beautiful big world outside \uAA6A\uAA6B\uAA6C\uAA45\uAA46\uAA47\u29D3 \uD83D\uDCA6 \uD83C\uDF89 \uD83D\uDCBC \uD83D\uDC90 \uD83C\uDF44'), true);
assert('Cham-wrapped \u201cEvery child writes\u201d (5 emoji)',
  hasObscureScriptDecoration('\u301D\uAA2C\uAA2D\uAA2E\uAA68\uAA69 Every child writes their own beautiful life story \uAA6A\uAA6B\uAA6C\uAA2D\uAA2E\uAA2F\u301E \uD83C\uDF10 \uD83D\uDD25 \uD83C\uDF1E \uD83C\uDF8A \uD83C\uDF10'), true);
assert('Rejang-wrapped \u201cKeep your heart light\u201d (5 emoji)',
  hasObscureScriptDecoration('\uA956\uA9C5\u301A\uAA5C\uA734 Keep your heart light and free \uA957\u301B\uAA9C\uAA5D\uA9C6 \uD83C\uDF42 \uD83E\uDDF3 \uD83C\uDEEC \uD83C\uDF3A \uD83D\uDCBC'), true);
assert('Cham-wrapped \u201cGrow stronger\u201d (only 2 emoji)',
  hasObscureScriptDecoration('\u29D5\uAA59\uAA5A\uAA5B\uAA76\uAA77\uAA77 Grow stronger little by little each day \uA6A8\uAA69\uAA6A\uAA5A\uAA5B\uAA5C\u29D6 \uD83C\uDEEC \uD83C\uDF31'), true);
// Should NOT fire
assert('plain English with emoji (no obscure chars)',
  hasObscureScriptDecoration('Keep exploring the beautiful world \uD83C\uDF44 \uD83C\uDF89'), false);
assert('only 3 obscure chars (below threshold)',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46 Keep your heart light and free \uD83C\uDF31'), false);
assert('no emoji (fails emoji requirement)',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46\uAA47 Keep your heart light and free \uAA48\uAA49\uAA4A\uAA4B'), false);
assert('too few English words (< 4)',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46\uAA47 Hi \uAA48 \uD83C\uDF31'), false);
assert('English dominates (ratio > 0.82)',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46\uAA47 The quick brown fox jumps over the lazy dog and then runs away \uD83C\uDF31'), false);

// ═══════════════════════════════════════════════════════════════
// 11. detectObviousBotReply — obscure-script-wrapped bots (standalone rule)
// ═══════════════════════════════════════════════════════════════
// Non-random-looking handles to verify the standalone obscureScriptDeco rule fires
// without the randomHandle condition. Confidence should be ≥0.88.
section('detectObviousBotReply \u2014 obscure-script-wrapped bots (standalone rule)');
const OBSCURE_SCRIPT_BOTS = [
  // handle doesn't look random — standalone rule must carry the detection
  { handle: '@sunshine_fan',   displayName: 'Sunshine',   text: '\u29D2\uAA44\uAA45\uAA46\uA6A8\uAA69\uAA69 Keep exploring the beautiful big world outside \uAA6A\uAA6B\uAA6C\uAA45\uAA46\uAA47\u29D3 \uD83D\uDCA6 \uD83C\uDF89 \uD83D\uDCBC \uD83D\uDC90 \uD83C\uDF44' },
  { handle: '@GrowthMindset',  displayName: 'Growth',     text: '\u301D\uAA2C\uAA2D\uAA2E\uAA68\uAA69 Every child writes their own beautiful life story \uAA6A\uAA6B\uAA6C\uAA2D\uAA2E\uAA2F\u301E \uD83C\uDF10 \uD83D\uDD25 \uD83C\uDF1E \uD83C\uDF8A \uD83C\uDF10' },
  { handle: '@peacelovejoy',   displayName: 'Peace',      text: '\uA956\uA9C5\u301A\uAA5C\uA734 Keep your heart light and free \uA957\u301B\uAA9C\uAA5D\uA9C6 \uD83C\uDF42 \uD83E\uDDF3 \uD83C\uDEEC \uD83C\uDF3A \uD83D\uDCBC' },
  // Only 2 emoji — relies solely on obscureScriptDeco (not emojiDecoratedPhrase)
  { handle: '@DailyWisdomX',   displayName: 'DailyWisdom', text: '\u29D5\uAA59\uAA5A\uAA5B\uAA76\uAA77\uAA77 Grow stronger little by little each day \uA6A8\uAA69\uAA6A\uAA5A\uAA5B\uAA5C\u29D6 \uD83C\uDEEC \uD83C\uDF31' },
];
for (const t of OBSCURE_SCRIPT_BOTS) {
  assertDetected(t.handle, t, 0.85);
}

// ═══════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(55));
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(55));
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(f));
}
process.exit(failed > 0 ? 1 : 0);
