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
  hasDecoratedCjkBotPattern,
  hasAdultLureShortCopy,
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

section('Deep Scan review-before-block invariant');
{
  const performDeepScanSource = String(ctx.performDeepScan || '');
  assertFalsy(
    'Deep Scan must not enqueue block jobs before popup confirmation',
    /enqueueBlockAccounts\s*\(\s*deepScanState\.candidates/.test(performDeepScanSource)
  );
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
assertTruthy('资源 in display name', hasObviousBotKeyword('真实资源-主页自取'));
assertTruthy('主页 in display name', hasObviousBotKeyword('主页自取'));
assertTruthy('好涩 in display name', hasObviousBotKeyword('\u5979\u597d\u6da9\u2763\uFE0F\u6211\u4E0D\u884C\u4E86\uD83D\uDC49'));
assertTruthy('第一骚 in display name', hasObviousBotKeyword('m\u63A8\u7279\uD83D\uDC93\u7B2C\u4E00\u9A9A'));
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
assert('Pcbgqtvw-style wrapped \u201cAccept change\u201d (4 obscure chars total)',
  hasObscureScriptDecoration('\u22C6\uA9BF\uA673\u0F18 Accept change embrace new blessings. \uA673\uA9BF\u0F18\u22C6'), true);
// Should NOT fire
assert('plain English with emoji (no obscure chars)',
  hasObscureScriptDecoration('Keep exploring the beautiful world \uD83C\uDF44 \uD83C\uDF89'), false);
assert('only 3 obscure chars (below threshold)',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46 Keep your heart light and free \uD83C\uDF31'), false);
assert('no emoji but wrapped on both sides still counts',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46\uAA47 Keep your heart light and free \uAA48\uAA49\uAA4A\uAA4B'), true);
assert('too few English words (< 4)',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46\uAA47 Hi \uAA48 \uD83C\uDF31'), false);
assert('English dominates (ratio > 0.86)',
  hasObscureScriptDecoration('\uAA44\uAA45\uAA46\uAA47 The quick brown fox jumps over the lazy dog and then runs away \uD83C\uDF31'), false);

// ═══════════════════════════════════════════════════════════════
// 11. detectObviousBotReply — obscure-script-wrapped bots (standalone rule)
// ═══════════════════════════════════════════════════════════════
// Non-random-looking handles to verify the standalone obscureScriptDeco rule fires
// without the randomHandle condition. Confidence should be ≥0.88.
section('hasDecoratedCjkBotPattern');
assert('superscript-word prefix + CJK phrase + suffix symbol',
  hasDecoratedCjkBotPattern('\u1d49\u1d50\u1d52\u1d57\u2071\u1d52\u207f \u5c81\u6708\u6e29\u67d4\u4e07\u4e8b\u7686\u5982\u613f \u273c'), true);
assert('letterlike-symbol wrapper around CJK phrase',
  hasDecoratedCjkBotPattern('\u2130\u301b\u250b \u661f\u843d\u5e73\u91ce\u8d74\u5c71\u6cb3 \u301a\u2128\u250a'), true);
assert('decorative symbol wrapper around CJK phrase #2',
  hasDecoratedCjkBotPattern('\u2118\u250b\u301a \u5c71\u6cb3\u65e7\u5ff5\u6c90\u665a\u98ce \u301b\u213c\u250a'), true);
assert('replacement-char noise + emoji wrapper around CJK phrase #1',
  hasDecoratedCjkBotPattern('\uFFFD\uD83C\uDF39\uFFFD\u25D9\u70F9\u7F8A\u5BB0\u725B\u4E14\u4E3A\u4E50\u25D9\uD83E\uDD69'), true);
assert('replacement-char noise + emoji wrapper around CJK phrase #2',
  hasDecoratedCjkBotPattern('\uFFFD\uD83C\uDF39\uFFFD\u2668\u5C0F\u65F6\u4E0D\u8BC6\u6708\u61F5\u61C2\u2668\uD83C\uDF19'), true);
assert('plain Chinese sentence should not trigger',
  hasDecoratedCjkBotPattern('\u5c81\u6708\u6e29\u67d4\u4e07\u4e8b\u7686\u5982\u613f'), false);
assert('English sentence with wrappers should not trigger this CJK rule',
  hasDecoratedCjkBotPattern('\u2130\u301b\u250b Keep calm and carry on \u301a\u2128\u250a'), false);

section('detectObviousBotReply \u2014 obscure-script-wrapped bots (standalone rule)');
const OBSCURE_SCRIPT_BOTS = [
  // handle doesn't look random — standalone rule must carry the detection
  { handle: '@sunshine_fan',   displayName: 'Sunshine',   text: '\u29D2\uAA44\uAA45\uAA46\uA6A8\uAA69\uAA69 Keep exploring the beautiful big world outside \uAA6A\uAA6B\uAA6C\uAA45\uAA46\uAA47\u29D3 \uD83D\uDCA6 \uD83C\uDF89 \uD83D\uDCBC \uD83D\uDC90 \uD83C\uDF44' },
  { handle: '@GrowthMindset',  displayName: 'Growth',     text: '\u301D\uAA2C\uAA2D\uAA2E\uAA68\uAA69 Every child writes their own beautiful life story \uAA6A\uAA6B\uAA6C\uAA2D\uAA2E\uAA2F\u301E \uD83C\uDF10 \uD83D\uDD25 \uD83C\uDF1E \uD83C\uDF8A \uD83C\uDF10' },
  { handle: '@peacelovejoy',   displayName: 'Peace',      text: '\uA956\uA9C5\u301A\uAA5C\uA734 Keep your heart light and free \uA957\u301B\uAA9C\uAA5D\uA9C6 \uD83C\uDF42 \uD83E\uDDF3 \uD83C\uDEEC \uD83C\uDF3A \uD83D\uDCBC' },
  // Only 2 emoji — relies solely on obscureScriptDeco (not emojiDecoratedPhrase)
  { handle: '@DailyWisdomX',   displayName: 'DailyWisdom', text: '\u29D5\uAA59\uAA5A\uAA5B\uAA76\uAA77\uAA77 Grow stronger little by little each day \uA6A8\uAA69\uAA6A\uAA5A\uAA5B\uAA5C\u29D6 \uD83C\uDEEC \uD83C\uDF31' },
  { handle: '@pcbgqtvw1448',   displayName: 'Pcbgqtvw',    text: '\u22C6\uA9BF\uA673\u0F18 Accept change embrace new blessings. \uA673\uA9BF\u0F18\u22C6' },
];
for (const t of OBSCURE_SCRIPT_BOTS) {
  assertDetected(t.handle, t, 0.85);
}

section('detectObviousBotReply — decorated CJK wrapper bots');
const DECORATED_CJK_BOTS = [
  { handle: '@qabvpw85456',   displayName: 'Qabvpw',   text: '\u1d49\u1d50\u1d52\u1d57\u2071\u1d52\u207f \u5c81\u6708\u6e29\u67d4\u4e07\u4e8b\u7686\u5982\u613f \u273c' },
  { handle: '@wztgoark22506', displayName: 'Wztgoark', text: '\u2130\u301b\u250b \u661f\u843d\u5e73\u91ce\u8d74\u5c71\u6cb3 \u301a\u2128\u250a' },
  { handle: '@aqnts131726',   displayName: 'Aqnts',    text: '\u2118\u250b\u301a \u5c71\u6cb3\u65e7\u5ff5\u6c90\u665a\u98ce \u301b\u213c\u250a' },
  { handle: '@aqnts131726',   displayName: 'Aqnts',    text: '\u250b\u2127\u301a \u96fe\u6f2b\u5f52\u7a0b\u4f34\u6e05\u6b22 \u301b\u2118\u250a' },
  { handle: '@aqnts131726',   displayName: 'Aqnts',    text: '\u2130\u250a\u3018 \u6e05\u5ead\u85cf\u96fe\u5fc6\u6e05\u6b22 \u3019\u2124\u250b' },
  { handle: '@xpvugqor30410', displayName: 'Xpvugqor', text: '\uFFFD\uD83C\uDF39\uFFFD\u25D9\u70F9\u7F8A\u5BB0\u725B\u4E14\u4E3A\u4E50\u25D9\uD83E\uDD69' },
  { handle: '@Lguha340054',   displayName: 'Lguha',    text: '\uFFFD\uD83C\uDF39\uFFFD\u2668\u5C0F\u65F6\u4E0D\u8BC6\u6708\u61F5\u61C2\u2668\uD83C\uDF19' },
];
for (const t of DECORATED_CJK_BOTS) {
  assertDetected(t.handle, t, 0.90);
}

// ═══════════════════════════════════════════════════════════════
section('detectObviousBotReply — adult display name + tiny fragment bots');
assertDetected('@danitinahd',
  { handle: '@danitinahd', displayName: '\u5979\u597d\u6da9\u2763\uFE0F\u6211\u4E0D\u884C\u4E86\uD83D\uDC49', text: 'f\u7948\u5E03\u51E1' }, 0.9);
assertDetected('@elonmusk7pg',
  { handle: '@elonmusk7pg', displayName: 'm\u63A8\u7279\uD83D\uDC93\u7B2C\u4E00\u9A9A', text: 'n' }, 0.9);

section('hasAdultLureShortCopy');
assertTruthy('line-offline adult lure copy',
  hasAdultLureShortCopy('+\u7ebf\u4e0b\u6211\u5c31\u66f0\u8fc7\uD83D\uDC97\u8fd9\u4e2a\u9a9a\u8d27\uD83D\uDC49'));
assertTruthy('resource-homepage self-pick copy',
  hasAdultLureShortCopy('\u771f\u5b9e\u8d44\u6e90-\u4e3b\u9875\u81ea\u53d6'));
assertTruthy('homepage can do it lure copy',
  hasAdultLureShortCopy('m\u5237\u4e86\u534a\u5929\u7684X\uD83E\uDD73\u5c31\u5979\u7684\u4e3b\u9875\u80fd\u6253\u2708\uFE0F\u4e86'));
assertTruthy('too sexy lure copy',
  hasAdultLureShortCopy('\u2764\uFE0F\u5979\u597d\u6da9\uD83E\uDD7A\u6211\u4e0d\u884c\u4e86\uD83D\uDC49'));
assertTruthy('compare sexy lure copy',
  hasAdultLureShortCopy('y\u6bd4\u5979\u597d\u770b\u7684\u6ca1\u5979\u9a9a\uD83E\uDD24\u6bd4\u5979\u9a9a\u7684\u6ca1\u5979\u597d\u770b'));
assertFalsy('normal Chinese sentence should not trigger short-copy lure rule',
  hasAdultLureShortCopy('\u4eca\u5929\u7684\u665a\u971e\u5f88\u597d\u770b\u6211\u60f3\u51fa\u53bb\u6563\u6b65'));

section('detectObviousBotReply — adult lure short-copy bots');
assertDetected('@trizha1018',
  { handle: '@trizha1018', displayName: '\u6a80\u8574', text: '+\u7ebf\u4e0b\u6211\u5c31\u66f0\u8fc7\uD83D\uDC97\u8fd9\u4e2a\u9a9a\u8d27\uD83D\uDC49' }, 0.9);
assertDetected('@chrisropp',
  { handle: '@chrisropp', displayName: '\u53f0\u5929\u83f1', text: 'm\u5237\u4e86\u534a\u5929\u7684X\uD83E\uDD73\u5c31\u5979\u7684\u4e3b\u9875\u80fd\u6253\u2708\uFE0F\u4e86' }, 0.9);
assertDetected('@chrisropp',
  { handle: '@chrisropp', displayName: '\u53f0\u5929\u83f1', text: '\u2764\uFE0F\u5979\u597d\u6da9\uD83E\uDD7A\u6211\u4e0d\u884C\u4E86\uD83D\uDC49' }, 0.9);
assertDetected('@MarkNewtnCMT1',
  { handle: '@MarkNewtnCMT1', displayName: 'Mark Newton. CMT', text: '*\u5237\u4e86\u534a\u5929\u7684X\uD83E\uDD29\u5c31\u5979\u7684\u4e3b\u9875\u80fd\u6253\u2708\uFE0F\u4e86' }, 0.9);
assertDetected('@elonmuskchats09',
  { handle: '@elonmuskchats09', displayName: 'Mr. Musk', text: 'y\u6bd4\u5979\u597d\u770b\u7684\u6ca1\u5979\u9a9a\uD83E\uDD24\u6bd4\u5979\u9a9a\u7684\u6ca1\u5979\u597d\u770b' }, 0.9);

section('detectObviousBotReply — reported homepage-resource lure samples');
assertDetected('@Isabella4091513 with single-letter emoji lure',
  { handle: '@Isabella4091513', displayName: '\u771f\u5b9e\u8d44\u6e90-\u4e3b\u9875\u81ea\u53d6', text: 'H \u{1F302} \u{1F331} \u{1F38C} \u{1F342} \u{1F4B0}' }, 0.9);
assertDetected('@Isabella4091513 variant with W + emoji',
  { handle: '@Isabella4091513', displayName: '\u771f\u5b9e\u8d44\u6e90-\u4e3b\u9875\u81ea\u53d6', text: 'W \u{1F38C} \u{1F33B} \u{1F340} \u{1F389}' }, 0.9);
assertDetected('@Maya989213418 nearby/adult keyword + single-letter emoji',
  { handle: '@Maya989213418', displayName: '\u5b89\u59aebaby', text: 'D \u{1F36C} \u{1F4B0}' }, 0.9);
assertDetected('@Eva647152086 nearby keyword + emoji letter token',
  { handle: '@Eva647152086', displayName: '\u9644\u8fd1\u771f\u5b9e\u7684\u90fd\u5728\u8fd9', text: 'L \u{1F33B} \u{1F6A9}' }, 0.9);
assertDetected('@Eva542463644 fixed-partner keyword + emoji letter token',
  { handle: '@Eva542463644', displayName: '\u5bfb\u56fa\u70ae', text: 'X \u{1F680} \u{1F4BC}' }, 0.9);

section('detectObviousBotReply — long decorative inspirational bots');
assertDetected('@Yaekn131039',
  { handle: '@Yaekn131039', displayName: 'Yaekn', text: '\u22c6\ua9bf\ud83c\udf42\ua673\u0f18\u26f8\ufe0f Even gloomy cloudy rainy days become warm once we have a nice casual chat together slowly. \u0f18\u26ec\ua9bf\u0f18\u22c6 \ud83c\udf6c \ud83c\udf44 \ud83d\udd25 \ud83d\ude80' }, 0.9);
assertDetected('@blrnav22485',
  { handle: '@blrnav22485', displayName: 'Blrnav', text: '\ua9bf\ud83c\udf37\u0f18\u22c6\u26f1\ufe0f Sincere communication is the most precious bridge that connects two hearts across the distance. \u0f18\ud83d\udcab\ua9bf\u0f18\u22c6 \ud83c\udf08 \ud83e\ude90 \ud83d\udd25 \ud83c\udf41' }, 0.9);
assertDetected('@Wyzeb140374',
  { handle: '@Wyzeb140374', displayName: 'Wyzeb', text: '\ua9bf\ud83c\udf43\u0f18\u22c6\u26f8\ufe0f Treasure every person who is willing to spend free time listening carefully to your inner voice. \u0f18\u2698\ua9bf\u0f18\u22c6 \ud83d\ude80 \ud83c\udf42' }, 0.9);

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
