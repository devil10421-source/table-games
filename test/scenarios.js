'use strict';
require('../src/core.js');
require('../src/avalon.js');
const Core = globalThis.Core, A = globalThis.Avalon;
const assert = require('assert');
let T = 10000;
function ids(n) { const a = []; for (let i = 1; i <= n; i++) a.push('p' + i); return a; }

/* 建立一個指定角色的對局（p1 起依序給角色），隊長固定為 p1 */
function game(n, roleList, cfgOver) {
  const cfg = Object.assign(A.defaultCfg(), cfgOver || {});
  cfg.opt = Object.assign({}, cfg.opt);
  // 先用合法的簡單配置初始化，再把角色與配置換成測試要的（測試可以不受名額限制）
  const safe = { pure: false, opt: {}, lady: cfg.lady, excal: cfg.excal };
  const s = A.init({ ids: ids(n), cfg: safe, seed: 'sc', t: T });
  s.cfg = cfg;
  const base = s.order.map(function (id, i) { return roleList[i] || 'servant'; });
  s.order.forEach(function (id, i) { s.roles[id] = base[i]; });
  s.witchId = s.order.find(function (i) { return s.roles[i] === 'witch'; }) || null;
  s.deck = cfg.opt.lancelots ? Core.shuffle(['S', 'S', 'B', 'B', 'B'], Core.rng('sc:deck')) : [];
  s.leader = 0;
  if (s.lady) { s.lady.holder = s.order[n - 1]; s.lady.held = [s.order[n - 1]]; }
  return s;
}
function go(s, k, p, d) {
  T += 1000;
  const r = A.reduce(s, { k: k, p: p, t: T, d: Object.assign({ ph: s.ph }, d || {}) });
  return r;
}
function must(s, k, p, d) {
  const r = go(s, k, p, d);
  assert.notStrictEqual(r, s, 'action should be accepted: ' + k + ' ' + p + ' ' + JSON.stringify(d) + ' in ' + s.phase);
  return r;
}
function mustNot(s, k, p, d) {
  const r = go(s, k, p, d);
  assert.strictEqual(r, s, 'action should be rejected: ' + k + ' ' + p + ' ' + JSON.stringify(d));
}
function voteAll(s, yesIds) {
  s.order.forEach(function (id) { s = must(s, 'av.vote', id, { v: yesIds.indexOf(id) >= 0 }); });
  return s;
}
/* 快速走完一次通過的組隊投票 */
function approveTeam(s, team, excal) {
  s = must(s, 'av.propose', A.leaderId(s), { team: team, excal: excal });
  s = voteAll(s, s.order);
  s = must(s, 'av.next', 'p1', {});
  return s;
}
function submitCards(s, map) {
  Object.keys(map).forEach(function (id) { s = must(s, 'av.card', id, { c: map[id] }); });
  return s;
}
/* 用 timeout 跳過 pre 階段 */
function skipPre(s) {
  T += A.PRE_MS + 1000;
  return must(s, 'av.timeout', 'p1', {});
}
const n7 = ['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion', 'minion'];

/* ---- 1. 配置檢查 ---- */
(function () {
  [5, 6, 7, 8, 9, 10].forEach(function (n) {
    const base = A.check(A.defaultCfg(), n);
    assert(base.ok, 'default ok ' + n);
    assert.strictEqual(base.roles.length, n);
    assert.strictEqual(base.slots.evil.max, [2, 2, 3, 3, 3, 4][n - 5]);
  });
  assert(!A.check(A.defaultCfg(), 4).ok && !A.check(A.defaultCfg(), 11).ok);
  // 教學局：只有梅林、刺客、忠臣、爪牙
  const t5 = A.check(A.defaultCfg(), 5);
  assert.deepStrictEqual(t5.roles.slice().sort(), ['assassin', 'merlin', 'minion', 'servant', 'servant']);
  // 5 人局壞人只有 2 個名額：刺客 + 莫甘娜可以，再加莫德雷德不行
  assert(A.check({ opt: { morgana: true } }, 5).ok);
  assert(!A.check({ opt: { morgana: true, mordred: true } }, 5).ok);
  // 女皇必須搭配蘭斯洛特
  assert(!A.check({ opt: { guinevere: true } }, 9).ok);
  assert(A.check({ opt: { guinevere: true, lancelots: true } }, 9).ok);
  // 蘭斯洛特各占一個好人與一個壞人名額
  const c = A.check({ opt: { lancelots: true } }, 5);
  assert.strictEqual(c.slots.good.used, 2); assert.strictEqual(c.slots.evil.used, 2);
  // 騙子沒有查驗者會警告
  assert(A.check({ opt: { trickster: true } }, 7).warnings.length === 1);
  assert(A.check({ opt: { trickster: true, cleric: true } }, 7).warnings.length === 0);
  assert(A.check({ lady: true, opt: { trickster: true } }, 7).warnings.length === 0);
  // 完整局 10 人：所有壞人角色最多 4 個名額
  assert(!A.check({ opt: { morgana: true, mordred: true, oberon: true, trickster: true } }, 10).ok);
  console.log('ok 配置檢查');
})();

/* ---- 2. 五次否決 ---- */
(function () {
  let s = game(5, ['merlin', 'servant', 'servant', 'assassin', 'minion']);
  for (let i = 0; i < 5; i++) {
    const L = A.leaderId(s);
    s = must(s, 'av.propose', L, { team: s.order.slice(0, 2) });
    s = voteAll(s, []);
    assert.strictEqual(s.lastVote.approve, false);
    s = must(s, 'av.next', 'p3', {});
  }
  assert(s.over && s.over.winner === 'evil' && s.over.why.indexOf('五次') >= 0);
  // 平票算否決（4 人贊成 2 人反對可通過；6 人 3:3 不通過）
  let t = game(6, ['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion']);
  t = must(t, 'av.propose', 'p1', { team: ['p1', 'p2'] });
  t = voteAll(t, ['p1', 'p2', 'p3']);
  assert.strictEqual(t.lastVote.approve, false);
  console.log('ok 五次否決與平票');
})();

/* ---- 3. 否決後隊長順位、通過後重置計數 ---- */
(function () {
  let s = game(5, ['merlin', 'servant', 'servant', 'assassin', 'minion']);
  s = must(s, 'av.propose', 'p1', { team: ['p1', 'p2'] });
  s = voteAll(s, []);
  s = must(s, 'av.next', 'p2', {});
  assert.strictEqual(A.leaderId(s), 'p2'); assert.strictEqual(s.rejects, 1);
  mustNot(s, 'av.propose', 'p1', { team: ['p1', 'p2'] });          // 不是隊長
  mustNot(s, 'av.propose', 'p2', { team: ['p1'] });                  // 人數不對
  mustNot(s, 'av.propose', 'p2', { team: ['p1', 'p1'] });            // 重複
  s = must(s, 'av.propose', 'p2', { team: ['p1', 'p2'] });
  s = voteAll(s, s.order);
  s = must(s, 'av.next', 'p2', {});
  assert.strictEqual(s.phase, 'quest'); assert.strictEqual(s.rejects, 0);
  // 過時動作（舊的 ph）會被忽略
  const stale = A.reduce(s, { k: 'av.card', p: 'p1', t: T, d: { ph: s.ph - 1, c: 'S' } });
  assert.strictEqual(stale, s);
  // 重複投票被忽略
  let v = game(5, ['merlin', 'servant', 'servant', 'assassin', 'minion']);
  v = must(v, 'av.propose', 'p1', { team: ['p1', 'p2'] });
  v = must(v, 'av.vote', 'p1', { v: true });
  mustNot(v, 'av.vote', 'p1', { v: false });
  console.log('ok 隊長輪替、非法動作');
})();

/* ---- 4. 第 4 次任務在 7 人以上需要 2 張失敗 ---- */
(function () {
  [1, 2].forEach(function (nf) {
    let s = game(7, n7);
    s.q = 3; s.phase = 'team';
    const team = ['p1', 'p2', 'p3', 'p5'];                      // 7 人局第 4 次任務 4 人
    s = must(s, 'av.propose', 'p1', { team: team });
    s = voteAll(s, s.order);
    s = must(s, 'av.next', 'p1', {});
    const cards = { p1: 'S', p2: 'S', p3: 'S', p5: 'S' };
    if (nf >= 1) cards.p5 = 'F';
    if (nf >= 2) cards.p6 = undefined;
    // 第二張失敗需要另一個壞人在隊內：改用 p6
    let t = game(7, n7);
    t.q = 3; t.phase = 'team';
    const team2 = ['p1', 'p5', 'p6', 'p2'];
    t = must(t, 'av.propose', 'p1', { team: team2 });
    t = voteAll(t, t.order);
    t = must(t, 'av.next', 'p1', {});
    t = submitCards(t, { p1: 'S', p2: 'S', p5: 'F', p6: nf === 2 ? 'F' : 'S' });
    const e = t.hist[0];
    assert.strictEqual(e.need, 2);
    assert.strictEqual(e.real, nf === 2 ? 'F' : 'S');
  });
  // 5、6 人局第 4 次任務只要 1 張
  let s = game(6, ['merlin', 'servant', 'servant', 'servant', 'assassin', 'minion']);
  s.q = 3; s.phase = 'team';
  s = approveTeam(s, ['p1', 'p2', 'p5'], null);
  s = submitCards(s, { p1: 'S', p2: 'S', p5: 'F' });
  assert.strictEqual(s.hist[0].need, 1); assert.strictEqual(s.hist[0].real, 'F');
  console.log('ok 第 4 次任務兩張失敗規則');
})();

/* ---- 5. 出牌限制 ---- */
(function () {
  let s = game(7, ['merlin', 'servant', 'lunatic', 'brute', 'assassin', 'minion', 'minion']);
  assert.deepStrictEqual(A.allowedCards(s, 'p1'), ['S']);
  assert.deepStrictEqual(A.allowedCards(s, 'p3'), ['F']);
  assert.deepStrictEqual(A.allowedCards(s, 'p4'), ['S', 'F']);   // 野蠻人第 1 次任務自選
  assert.deepStrictEqual(A.allowedCards(s, 'p5'), ['S', 'F']);
  s.q = 3;
  assert.deepStrictEqual(A.allowedCards(s, 'p4'), ['S']);        // 第 4 次任務只能出成功
  s.q = 4;
  assert.deepStrictEqual(A.allowedCards(s, 'p4'), ['S']);
  s.q = 2;
  assert.deepStrictEqual(A.allowedCards(s, 'p4'), ['S', 'F']);
  // 實際動作：好人不能出失敗
  s = game(5, ['merlin', 'servant', 'servant', 'assassin', 'minion']);
  s = approveTeam(s, ['p1', 'p4'], null);
  mustNot(s, 'av.card', 'p1', { c: 'F' });
  mustNot(s, 'av.card', 'p2', { c: 'S' });                       // 不在隊內
  console.log('ok 出牌限制');
})();

/* ---- 6. 神劍 ---- */
(function () {
  let s = game(5, ['merlin', 'servant', 'servant', 'assassin', 'minion'], { excal: true });
  mustNot(s, 'av.propose', 'p1', { team: ['p1', 'p2'] });                    // 沒指定神劍
  mustNot(s, 'av.propose', 'p1', { team: ['p1', 'p2'], excal: 'p1' });       // 不能給自己
  mustNot(s, 'av.propose', 'p1', { team: ['p1', 'p2'], excal: 'p3' });       // 必須在隊內
  s = approveTeam(s, ['p1', 'p4'], 'p4');
  s = submitCards(s, { p1: 'S', p4: 'F' });
  assert.strictEqual(s.phase, 'pre');
  mustNot(s, 'av.excal', 'p1', { target: 'p4' });                             // 不是持有者
  mustNot(s, 'av.excal', 'p4', { target: 'p4' });                             // 不能翻自己
  s = must(s, 'av.excal', 'p4', { target: 'p1' });                            // p1 的成功翻成失敗
  assert.strictEqual(s.hist[0].real, 'F');
  assert.strictEqual(s.hist[0].flip.to, 'F');
  assert.strictEqual(s.hist[0].fails, 2);
  // 私人資訊：持有者與目標知道，其他人不知道
  assert(A.info(s, 'p4').notes.some(function (x) { return x.type === 'excal' && x.mine === 'holder'; }));
  assert(A.info(s, 'p1').notes.some(function (x) { return x.type === 'excal' && x.mine === 'target'; }));
  assert(!A.info(s, 'p2').notes.some(function (x) { return x.type === 'excal'; }));
  // 不使用
  let t = game(5, ['merlin', 'servant', 'servant', 'assassin', 'minion'], { excal: true });
  t = approveTeam(t, ['p1', 'p4'], 'p4');
  t = submitCards(t, { p1: 'S', p4: 'F' });
  t = must(t, 'av.excal', 'p4', { target: null });
  assert.strictEqual(t.hist[0].real, 'F'); assert.strictEqual(t.hist[0].flip, null);
  // 逾時自動略過
  let u = game(5, ['merlin', 'servant', 'servant', 'assassin', 'minion'], { excal: true });
  u = approveTeam(u, ['p1', 'p4'], 'p4');
  u = submitCards(u, { p1: 'S', p4: 'F' });
  mustNot(u, 'av.timeout', 'p1', {});                                         // 還沒到時間
  u = skipPre(u);
  assert.strictEqual(u.hist.length, 1);
  console.log('ok 神劍');
})();

/* ---- 7. 巫婆 ---- */
(function () {
  const roles = ['merlin', 'servant', 'trickster', 'troublemaker', 'assassin', 'witch', 'mordred'];
  let s = game(7, roles, { opt: { witch: true, trickster: true, troublemaker: true, mordred: true } });
  s.witchId = 'p6';
  s = approveTeam(s, ['p1', 'p2'], null);
  s = submitCards(s, { p1: 'S', p2: 'S' });
  assert.strictEqual(s.phase, 'pre');
  mustNot(s, 'av.witch', 'p1', { hide: true });                               // 不是巫婆
  s = must(s, 'av.witch', 'p6', { hide: true });
  assert.strictEqual(s.phase, 'wcheck');
  const checker = s.wc.checker;
  assert.notStrictEqual(checker, 'p6');
  assert.strictEqual(s.hist[0].hidden, true);
  mustNot(s, 'av.wcheck', 'p6', { target: 'p1' });                            // 只有被選中的人能查
  mustNot(s, 'av.wcheck', checker, { target: checker });                      // 不能查自己
  const targets = { p3: 'good', p4: 'evil', p7: 'evil', p1: 'good', p5: 'evil' };
  Object.keys(targets).forEach(function (tg) {
    if (tg === checker) return;
    const r = must(s, 'av.wcheck', checker, { target: tg });
    const note = A.info(r, checker).notes.find(function (x) { return x.type === 'wcheck'; });
    assert.strictEqual(note.shown, targets[tg], 'shown ' + tg);
    // 別人看不到結果
    s.order.forEach(function (o) { if (o !== checker) assert(!A.info(r, o).notes.some(function (x) { return x.type === 'wcheck'; })); });
  });
  // 查驗者可以不查
  const none = must(s, 'av.wcheck', checker, { target: null });
  assert(A.info(none, checker).notes.some(function (x) { return x.type === 'wcheckNone'; }));
  assert.strictEqual(none.phase, 'qres');
  // 逾時視為不查
  T += A.WC_MS + 1000;
  const to = must(s, 'av.timeout', 'p1', {});
  assert.strictEqual(to.phase, 'qres');
  // 每局只能一次：之後的任務不再出現 pre 階段（沒有神劍）
  let r = none;
  r = must(r, 'av.next', 'p1', {});
  r = approveTeam(r, ['p2', 'p3', 'p4'], null);
  assert.strictEqual(r.q, 1);
  r = submitCards(r, { p2: 'S', p3: 'S', p4: 'S' });
  assert.strictEqual(r.phase, 'qres');
  // 巫婆選擇不隱藏：本次不隱藏，但下次仍可隱藏
  let w = game(7, roles, { opt: { witch: true } });
  w.witchId = 'p6';
  w = approveTeam(w, ['p1', 'p2'], null);
  w = submitCards(w, { p1: 'S', p2: 'S' });
  w = must(w, 'av.witch', 'p6', { hide: false });
  assert.strictEqual(w.phase, 'qres'); assert.strictEqual(w.witchUsed, false);
  w = must(w, 'av.next', 'p1', {});
  w = approveTeam(w, ['p2', 'p3', 'p4'], null);
  w = submitCards(w, { p2: 'S', p3: 'S', p4: 'S' });
  assert.strictEqual(w.phase, 'pre');
  // 隱藏的結果不影響勝負計算：三次成功後進入刺殺
  let h = game(7, roles, { opt: { witch: true } });
  h.witchId = 'p6';
  h.hist = [{ q: 0, real: 'S', hidden: false, fails: 0, need: 1, team: ['p1', 'p2'], leader: 'p1', flip: null }, { q: 1, real: 'S', hidden: false, fails: 0, need: 1, team: [], leader: 'p2', flip: null }];
  h.q = 2; h.phase = 'team';
  h = approveTeam(h, ['p1', 'p2', 'p3'], null);
  h = submitCards(h, { p1: 'S', p2: 'S', p3: 'S' });
  h = must(h, 'av.witch', 'p6', { hide: true });
  const after = must(h, 'av.wcheck', h.wc.checker, { target: null });
  assert.strictEqual(after.phase, 'assassin');
  console.log('ok 巫婆');
})();

/* ---- 8. 蘭斯洛特 ---- */
(function () {
  const roles = ['lancelot_good', 'merlin_pure', 'guinevere', 'servant', 'servant', 'lancelot_evil', 'assassin', 'minion', 'oberon'];
  const cfg = { pure: true, opt: { lancelots: true, guinevere: true, oberon: true } };
  // 9 人局 3 個壞人：刺客 + 邪惡蘭斯洛特 + 奧伯倫 → 爪牙 0
  const roles9 = ['lancelot_good', 'merlin_pure', 'guinevere', 'servant', 'servant', 'servant', 'lancelot_evil', 'assassin', 'oberon'];
  let s = game(9, roles9, cfg);
  s.deck = ['S', 'B', 'S', 'B', 'B'];            // 第 3 次任務前換邊、第 4 次不變、第 5 次再換
  s.lflip = false;
  // 初始：p1 好、p7 壞
  assert.strictEqual(A.align(s, 'p1'), 'good'); assert.strictEqual(A.align(s, 'p7'), 'evil');
  // 梅林（一般版）資訊：只看到初始壞人，不含莫德雷德
  const merlinS = Object.assign({}, s, { roles: Object.assign({}, s.roles, { p2: 'merlin' }) });
  const mi = A.info(merlinS, 'p2').groups[0].ids.slice().sort();
  assert.deepStrictEqual(mi, ['p7', 'p8', 'p9']);   // 邪惡蘭斯洛特、刺客、奧伯倫
  // 終極梅林：看到具體角色
  const pi = A.info(s, 'p2').groups[0].items;
  assert(pi.some(function (x) { return x.id === 'p7' && x.label.indexOf('蘭斯洛特') >= 0; }));
  assert(pi.some(function (x) { return x.id === 'p8' && x.label === '刺客'; }));
  // 壞人（刺客）看得到邪惡蘭斯洛特，看不到奧伯倫
  const ei = A.info(s, 'p8').groups[0].ids.slice().sort();
  assert.deepStrictEqual(ei, ['p7']);
  // 邪惡蘭斯洛特什麼都看不到、奧伯倫也是
  assert.strictEqual(A.info(s, 'p7').groups.length, 0); assert.strictEqual(A.info(s, 'p9').groups.length, 0);
  // 女皇看得到兩位蘭斯洛特，沒有陣營資訊
  const gi = A.info(s, 'p3');
  assert.deepStrictEqual(gi.groups[0].ids.slice().sort(), ['p1', 'p7']);
  // 前兩次任務不抽牌
  s = approveTeam(s, ['p1', 'p2', 'p3'], null);
  s = submitCards(s, { p1: 'S', p2: 'S', p3: 'S' });
  s = must(s, 'av.next', 'p1', {});
  s = approveTeam(s, ['p1', 'p2', 'p3', 'p4'], null);
  s = submitCards(s, { p1: 'S', p2: 'S', p3: 'S', p4: 'S' });
  assert.strictEqual(s.lflip, false);
  s = must(s, 'av.next', 'p1', {});
  // 第 3 次任務開始前抽到「轉換」：兩位蘭斯洛特陣營互換
  assert.strictEqual(s.q, 2); assert.strictEqual(s.lflip, true);
  assert.strictEqual(A.align(s, 'p1'), 'evil'); assert.strictEqual(A.align(s, 'p7'), 'good');
  assert.deepStrictEqual(A.allowedCards(s, 'p1'), ['F']);
  assert.deepStrictEqual(A.allowedCards(s, 'p7'), ['S']);
  // 一般梅林的標記不會更新（仍然包含 p7、不包含 p1）
  const mi2 = A.info(Object.assign({}, s, { roles: Object.assign({}, s.roles, { p2: 'merlin' }) }), 'p2').groups[0].ids.slice().sort();
  assert.deepStrictEqual(mi2, ['p7', 'p8', 'p9']);
  // 終極梅林會更新：現在 p1 是壞人，p7 不是
  const pi2 = A.info(s, 'p2').groups[0].items.map(function (x) { return x.id; }).sort();
  assert.deepStrictEqual(pi2, ['p1', 'p8', 'p9']);
  // 刺客的隊友資訊更新為現在的壞蘭斯洛特 p1
  assert.deepStrictEqual(A.info(s, 'p8').groups[0].ids, ['p1']);
  // 女皇仍然只知道誰是蘭斯洛特
  assert.deepStrictEqual(A.info(s, 'p3').groups[0].ids.slice().sort(), ['p1', 'p7']);
  // 蘭斯洛特知道自己目前的陣營
  const ln = A.info(s, 'p1').notes.find(function (x) { return x.type === 'lanAlign'; });
  assert.strictEqual(ln.align, 'evil'); assert.strictEqual(ln.flipped, true);
  // 第 4 次任務前抽到空白，不變；第 5 次再換
  s = approveTeam(s, ['p1', 'p2', 'p3', 'p4'], null);
  s = submitCards(s, { p1: 'F', p2: 'S', p3: 'S', p4: 'S' });
  s = must(s, 'av.next', 'p1', {});
  assert.strictEqual(s.q, 3); assert.strictEqual(s.lflip, true);
  console.log('ok 蘭斯洛特換邊與資訊更新');
})();

/* ---- 9. 牧師 ---- */
(function () {
  const roles = ['merlin', 'cleric', 'trickster', 'troublemaker', 'servant', 'assassin', 'minion'];
  let s = game(7, roles, { opt: { cleric: true, trickster: true, troublemaker: true } });
  assert(!A.info(s, 'p2').notes.some(function (x) { return x.type === 'cleric'; }));       // 第 1 次任務之前沒有資訊
  s = approveTeam(s, ['p1', 'p2'], null);
  s = submitCards(s, { p1: 'S', p2: 'S' });
  const c1 = A.info(s, 'p2').notes.find(function (x) { return x.type === 'cleric'; });
  assert.strictEqual(c1.target, 'p1'); assert.strictEqual(c1.shown, 'good');
  // 隊長是騙子：顯示好人；麻煩友：顯示壞人
  [['p3', 'good'], ['p4', 'evil'], ['p6', 'evil']].forEach(function (x) {
    let t = game(7, roles, { opt: { cleric: true } });
    t.leader = +x[0].slice(1) - 1;
    const L = A.leaderId(t);
    const team = [L, t.order.find(function (o) { return o !== L; })];
    t = approveTeam(t, team, null);
    t = Object.assign({}, t); t.team = team;
    t.phase = 'quest'; t.cards = {};
    t = submitCards(t, (function () { const m = {}; team.forEach(function (id) { m[id] = A.allowedCards(t, id)[0]; }); return m; })());
    const note = A.info(t, 'p2').notes.find(function (n) { return n.type === 'cleric' || n.type === 'clericSelf'; });
    if (L === 'p2') assert.strictEqual(note.type, 'clericSelf'); else assert.strictEqual(note.shown, x[1]);
  });
  // 牧師自己當隊長：沒有資訊
  let u = game(7, roles, { opt: { cleric: true } });
  u.leader = 1;
  u = approveTeam(u, ['p2', 'p1'], null);
  u = submitCards(u, { p2: 'S', p1: 'S' });
  assert(A.info(u, 'p2').notes.some(function (x) { return x.type === 'clericSelf'; }));
  // 刺殺牧師的第二步候選名單
  let k = game(7, roles, { opt: { cleric: true } });
  k.phase = 'assassin'; k.ph += 1;
  assert.deepStrictEqual(A.clericCandidates(k), ['servant', 'troublemaker']);   // 排除牧師、梅林
  // 沒有其他好人角色時才可選梅林／終極梅林／女皇
  const k2 = game(7, ['merlin', 'cleric', 'guinevere', 'lancelot_good', 'lancelot_evil', 'assassin', 'minion']);
  assert.deepStrictEqual(A.clericCandidates(k2).sort(), ['guinevere', 'merlin']);
  // 刺客先指錯牧師 → 好人勝
  const ok = Object.assign({}, k, { phase: 'assassin' });
  const w1 = must(ok, 'av.kill', 'p6', { mode: 'cleric', targets: ['p1'] });
  assert(w1.over && w1.over.winner === 'good');
  // 指對牧師 → 進入第二步；第二步猜對 → 壞人勝；猜錯 → 好人勝
  const st2 = must(ok, 'av.kill', 'p6', { mode: 'cleric', targets: ['p2'] });
  assert.strictEqual(st2.phase, 'assassin2');
  mustNot(st2, 'av.kill2', 'p6', { role: 'cleric', target: 'p2' });       // 不能選牧師
  mustNot(st2, 'av.kill2', 'p6', { role: 'merlin', target: 'p1' });       // 有其他候選時不能選梅林
  const win = must(st2, 'av.kill2', 'p6', { role: 'servant', target: 'p5' });
  assert.strictEqual(win.over.winner, 'evil');
  const lose = must(st2, 'av.kill2', 'p6', { role: 'servant', target: 'p1' });
  assert.strictEqual(lose.over.winner, 'good');
  console.log('ok 牧師與牧師刺殺');
})();

/* ---- 10. 湖中仙女 ---- */
(function () {
  let s = game(7, n7, { lady: true });
  assert.strictEqual(s.lady.holder, 'p7');                            // 首任隊長右側（前一位）
  s.q = 2; s.phase = 'team'; s.ph += 1;
  // 手動進入 lady 階段
  s.phase = 'lady'; s.ph += 1;
  mustNot(s, 'av.lady', 'p1', { target: 'p2' });                      // 不是持有者
  mustNot(s, 'av.lady', 'p7', { target: 'p7' });                      // 不能查自己
  s = must(s, 'av.lady', 'p7', { target: 'p5' });
  assert.strictEqual(s.lady.holder, 'p5'); assert.strictEqual(s.phase, 'team');
  const note = A.info(s, 'p7').notes.find(function (x) { return x.type === 'lady'; });
  assert.strictEqual(note.target, 'p5'); assert.strictEqual(note.shown, 'evil');
  assert(!A.info(s, 'p1').notes.some(function (x) { return x.type === 'lady'; }));
  // 曾持有者不能再被查
  s.phase = 'lady'; s.ph += 1;
  mustNot(s, 'av.lady', 'p5', { target: 'p7' });
  mustNot(s, 'av.lady', 'p5', { target: 'p5' });
  const s2 = must(s, 'av.lady', 'p5', { target: 'p2' });
  assert.strictEqual(s2.lady.held.length, 3);
  // 逾時略過
  T += A.LADY_MS + 1000;
  const sk = must(s, 'av.timeout', 'p1', {});
  assert.strictEqual(sk.phase, 'team'); assert.strictEqual(sk.lady.holder, 'p5');
  // 完整流程：第 3 次任務前自動進入仙女階段，且第 1、2 次不會
  let f = game(7, n7, { lady: true });
  f = approveTeam(f, ['p1', 'p2'], null); f = submitCards(f, { p1: 'S', p2: 'S' });
  f = must(f, 'av.next', 'p1', {});
  assert.strictEqual(f.phase, 'team');
  f = approveTeam(f, ['p2', 'p3', 'p4'], null); f = submitCards(f, { p2: 'S', p3: 'S', p4: 'S' });
  f = must(f, 'av.next', 'p1', {});
  assert.strictEqual(f.phase, 'lady');
  console.log('ok 湖中仙女');
})();

/* ---- 11. 被揭示者 ---- */
(function () {
  const roles = ['merlin', 'servant', 'servant', 'servant', 'assassin', 'revealer', 'minion'];
  let s = game(7, roles, { opt: { revealer: true } });
  s = approveTeam(s, ['p1', 'p5'], null); s = submitCards(s, { p1: 'S', p5: 'F' });
  assert.strictEqual(s.revealed, null);
  s = must(s, 'av.next', 'p1', {});
  s = approveTeam(s, ['p2', 'p5', 'p4'], null); s = submitCards(s, { p2: 'S', p5: 'F', p4: 'S' });
  assert.strictEqual(s.revealed, 'p6');
  console.log('ok 被揭示者');
})();

/* ---- 12. 派西維爾 ---- */
(function () {
  const withM = game(7, ['merlin', 'percival', 'morgana', 'servant', 'servant', 'assassin', 'minion'], { opt: { percival: true, morgana: true } });
  assert.deepStrictEqual(A.info(withM, 'p2').groups[0].ids.slice().sort(), ['p1', 'p3']);
  const withoutM = game(7, ['merlin', 'percival', 'servant', 'servant', 'servant', 'assassin', 'minion'], { opt: { percival: true } });
  const g = A.info(withoutM, 'p2').groups[0];
  assert.deepStrictEqual(g.ids, ['p1']); assert.strictEqual(g.title, '梅林');
  // 莫甘娜與壞人互相認識
  assert(A.info(withM, 'p3').groups[0].ids.indexOf('p6') >= 0);
  // 奧伯倫
  const ob = game(7, ['merlin', 'servant', 'oberon', 'servant', 'servant', 'assassin', 'minion'], { opt: { oberon: true } });
  assert.strictEqual(A.info(ob, 'p3').groups.length, 0);
  assert(A.info(ob, 'p1').groups[0].ids.indexOf('p3') >= 0);           // 梅林看得到奧伯倫
  assert(A.info(ob, 'p6').groups[0].ids.indexOf('p3') < 0);            // 壞人看不到奧伯倫
  // 莫德雷德：梅林看不到
  const mo = game(7, ['merlin', 'servant', 'mordred', 'servant', 'servant', 'assassin', 'minion'], { opt: { mordred: true } });
  assert(A.info(mo, 'p1').groups[0].ids.indexOf('p3') < 0);
  assert(A.info(mo, 'p6').groups[0].ids.indexOf('p3') >= 0);
  // 特里斯坦與伊索德互相認識
  const lv = game(7, ['merlin', 'tristan', 'isolde', 'servant', 'servant', 'assassin', 'minion'], { opt: { lovers: true } });
  assert.deepStrictEqual(A.info(lv, 'p2').groups[0].ids, ['p3']);
  assert.deepStrictEqual(A.info(lv, 'p3').groups[0].ids, ['p2']);
  console.log('ok 角色視野');
})();

/* ---- 13. 刺殺 ---- */
(function () {
  let s = game(7, ['merlin', 'tristan', 'isolde', 'guinevere', 'lancelot_good', 'assassin', 'lancelot_evil'], { opt: { lovers: true, guinevere: true, lancelots: true } });
  s.phase = 'assassin'; s.ph += 1;
  mustNot(s, 'av.kill', 'p1', { mode: 'merlin', targets: ['p1'] });             // 不是刺客
  mustNot(s, 'av.kill', 'p6', { mode: 'cleric', targets: ['p1'] });             // 沒有牧師
  assert.strictEqual(must(s, 'av.kill', 'p6', { mode: 'merlin', targets: ['p1'] }).over.winner, 'evil');
  assert.strictEqual(must(s, 'av.kill', 'p6', { mode: 'merlin', targets: ['p2'] }).over.winner, 'good');
  assert.strictEqual(must(s, 'av.kill', 'p6', { mode: 'lovers', targets: ['p2', 'p3'] }).over.winner, 'evil');
  assert.strictEqual(must(s, 'av.kill', 'p6', { mode: 'lovers', targets: ['p2', 'p4'] }).over.winner, 'good');
  assert.strictEqual(must(s, 'av.kill', 'p6', { mode: 'guinevere', targets: ['p4'] }).over.winner, 'evil');
  assert.strictEqual(must(s, 'av.kill', 'p6', { mode: 'guinevere', targets: ['p1'] }).over.winner, 'good');
  // 終極梅林也算梅林
  const pm = game(7, ['merlin_pure', 'servant', 'servant', 'servant', 'servant', 'assassin', 'minion'], { pure: true });
  pm.phase = 'assassin'; pm.ph += 1;
  assert.strictEqual(must(pm, 'av.kill', 'p6', { mode: 'merlin', targets: ['p1'] }).over.winner, 'evil');
  // 遊戲結束後不再接受動作
  const done = must(s, 'av.kill', 'p6', { mode: 'merlin', targets: ['p1'] });
  assert.strictEqual(A.reduce(done, { k: 'av.next', p: 'p1', t: T, d: { ph: done.ph } }), done);
  console.log('ok 刺殺');
})();

/* ---- 14. 房間層 ---- */
(function () {
  let r = Core.newRoom();
  r = Core.reduceRoom(r, { k: 'create', p: 'a', t: 1, d: { seed: 'x', name: '甲' } });
  r = Core.reduceRoom(r, { k: 'join', p: 'b', t: 1, d: { name: '乙' } });
  r = Core.reduceRoom(r, { k: 'join', p: 'c', t: 1, d: { name: '丙' } });
  assert.deepStrictEqual(r.players.map(function (x) { return x.name; }), ['甲', '乙', '丙']);
  // 只有房主能調整順序、踢人、設定、開始
  assert.strictEqual(Core.reduceRoom(r, { k: 'move', p: 'b', t: 1, d: { id: 'c', dir: -1 } }), r);
  const mv = Core.reduceRoom(r, { k: 'move', p: 'a', t: 1, d: { id: 'c', dir: -1 } });
  assert.deepStrictEqual(mv.players.map(function (x) { return x.id; }), ['a', 'c', 'b']);
  assert.strictEqual(Core.reduceRoom(r, { k: 'kick', p: 'b', t: 1, d: { id: 'c' } }), r);
  assert.strictEqual(Core.reduceRoom(r, { k: 'start', p: 'a', t: 1 }), r);      // 人數不足
  // 房主離開，換下一位
  const lv = Core.reduceRoom(r, { k: 'leave', p: 'a', t: 1 });
  assert.strictEqual(lv.hostId, 'b');
  // 重複建立被忽略；改名
  assert.strictEqual(Core.reduceRoom(r, { k: 'create', p: 'z', t: 1, d: { seed: 'y' } }), r);
  const rn = Core.reduceRoom(r, { k: 'join', p: 'b', t: 1, d: { name: '乙乙' } });
  assert.strictEqual(rn.players[1].name, '乙乙');
  // 名字清理
  const cn = Core.reduceRoom(r, { k: 'join', p: 'd', t: 1, d: { name: '  <b>很長很長很長很長很長很長</b>  ' } });
  assert(cn.players[3].name.length <= 10);
  // 遊戲開始後新人不能加入；結束後才能由非房主重置
  const mk = (function () {
    let q = Core.newRoom();
    q = Core.reduceRoom(q, { k: 'create', p: 'p1', t: 1, d: { seed: 'x', name: '1' } });
    for (let i = 2; i <= 5; i++) q = Core.reduceRoom(q, { k: 'join', p: 'p' + i, t: 1, d: { name: String(i) } });
    q = Core.reduceRoom(q, { k: 'start', p: 'p1', t: 5 });
    return q;
  })();
  assert.strictEqual(mk.phase, 'game');
  assert.strictEqual(Core.reduceRoom(mk, { k: 'join', p: 'zz', t: 1, d: { name: '路人' } }), mk);
  assert.strictEqual(Core.reduceRoom(mk, { k: 'reset', p: 'p2', t: 1 }), mk);
  const rs = Core.reduceRoom(mk, { k: 'reset', p: 'p1', t: 1 });
  assert.strictEqual(rs.phase, 'lobby'); assert.strictEqual(rs.rev, 1);
  // 局序不同 → 角色分配不同（種子含局數）
  const mk2 = Core.reduceRoom(rs, { k: 'start', p: 'p1', t: 5 });
  assert.notDeepStrictEqual(mk.game.roles, mk2.game.roles);
  console.log('ok 房間層');
})();
console.log('scenarios done');
