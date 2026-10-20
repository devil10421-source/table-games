'use strict';
require('../src/core.js');
require('../src/avalon.js');
const Core = globalThis.Core, A = globalThis.Avalon;
const assert = require('assert');

function mkRoom(n, cfg, seed) {
  let room = Core.newRoom();
  const ids = [];
  for (let i = 0; i < n; i++) ids.push('p' + (i + 1));
  let t = 1000;
  room = Core.reduceRoom(room, { k: 'create', p: ids[0], t: t, d: { seed: seed, name: 'P1' } });
  for (let i = 1; i < n; i++) room = Core.reduceRoom(room, { k: 'join', p: ids[i], t: t, d: { name: 'P' + (i + 1) } });
  room = Core.reduceRoom(room, { k: 'cfg', p: ids[0], t: t, d: { gameId: 'avalon', cfg: cfg } });
  room = Core.reduceRoom(room, { k: 'start', p: ids[0], t: t });
  return { room: room, ids: ids };
}
let REC = null;
function act(room, k, p, d, t) {
  const a = { k: k, p: p, t: t, d: Object.assign({ ph: room.game.ph }, d || {}) };
  if (REC) REC.push(a);
  return Core.reduceRoom(room, a);
}

function randomCfg(rnd, n) {
  for (let tries = 0; tries < 200; tries++) {
    const cfg = { pure: rnd() < 0.3, opt: {}, lady: rnd() < 0.5, excal: rnd() < 0.5 };
    A.OPT_GOOD.concat(A.OPT_EVIL).forEach(function (k) { if (rnd() < 0.35) cfg.opt[k] = true; });
    if (A.check(cfg, n).ok) return cfg;
  }
  return A.defaultCfg();
}
function pick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }

/* 一個隨機玩家：回傳 [房間, 是否有動作] */
function step(room, rnd, clock) {
  const s = room.game; const t = clock.t;
  const L = A.leaderId(s);
  switch (s.phase) {
    case 'team': {
      const size = A.teamSize(s);
      const team = Core.shuffle(s.order, rnd).slice(0, size);
      const d = { team: team };
      if (s.cfg.excal) { const c = team.filter(function (x) { return x !== L; }); d.excal = pick(c, rnd); }
      return act(room, 'av.propose', L, d, t);
    }
    case 'vote': {
      const who = s.order.filter(function (x) { return !(x in s.votes); });
      return act(room, 'av.vote', pick(who, rnd), { v: rnd() < 0.7 }, t);
    }
    case 'voteres': case 'qres': return act(room, 'av.next', pick(s.order, rnd), {}, t);
    case 'quest': {
      const who = s.team.filter(function (x) { return !s.cards[x]; });
      const p = pick(who, rnd); const ok = A.allowedCards(s, p);
      return act(room, 'av.card', p, { c: pick(ok, rnd) }, t);
    }
    case 'pre': {
      const r = rnd();
      if (!s.pre.excalDone && r < 0.5) {
        const c = s.team.filter(function (x) { return x !== s.excal; });
        return act(room, 'av.excal', s.excal, { target: rnd() < 0.6 ? pick(c, rnd) : null }, t);
      }
      if (!s.pre.witchDone && r >= 0.5 && r < 0.9) return act(room, 'av.witch', s.witchId, { hide: rnd() < 0.6 }, t);
      clock.t += A.PRE_MS + 1000;
      return act(room, 'av.timeout', pick(s.order, rnd), {}, clock.t);
    }
    case 'wcheck': {
      const c = s.order.filter(function (x) { return x !== s.wc.checker; });
      return act(room, 'av.wcheck', s.wc.checker, { target: rnd() < 0.7 ? pick(c, rnd) : null }, t);
    }
    case 'lady': {
      const c = s.order.filter(function (x) { return s.lady.held.indexOf(x) < 0; });
      return act(room, 'av.lady', s.lady.holder, { target: pick(c, rnd) }, t);
    }
    case 'assassin': {
      const asn = s.order.find(function (x) { return s.roles[x] === 'assassin'; });
      const m = pick(A.killModes(s), rnd);
      const n = m === 'lovers' ? 2 : 1;
      return act(room, 'av.kill', asn, { mode: m, targets: Core.shuffle(s.order, rnd).slice(0, n) }, t);
    }
    case 'assassin2': {
      const asn = s.order.find(function (x) { return s.roles[x] === 'assassin'; });
      return act(room, 'av.kill2', asn, { role: pick(A.clericCandidates(s), rnd), target: pick(s.order, rnd) }, t);
    }
    default: throw new Error('unexpected phase ' + s.phase);
  }
}

function checkInvariants(room) {
  const s = room.game; if (!s) return;
  assert(s.hist.length <= 5, 'hist too long');
  assert(s.rejects >= 0 && s.rejects <= 5);
  const tl = A.tally(s);
  assert(tl.succ <= 3 && tl.fail <= 3, 'tally');
  if (!s.cfg.opt.lancelots) assert(!s.lflip);
  // 角色數量與配置一致
  const cnt = {}; s.order.forEach(function (i) { cnt[s.roles[i]] = (cnt[s.roles[i]] || 0) + 1; });
  const chk = A.check(s.cfg, s.n);
  const exp = {}; chk.roles.forEach(function (k) { exp[k] = (exp[k] || 0) + 1; });
  assert.deepStrictEqual(cnt, exp, 'role counts');
  const evil = s.order.filter(function (i) { return A.R[s.roles[i]].side === 'evil'; }).length;
  assert.strictEqual(evil, [2, 2, 3, 3, 3, 4][s.n - 5], 'evil count');
  // 蘭斯洛特陣營人數不變
  const curEvil = s.order.filter(function (i) { return A.align(s, i) === 'evil'; }).length;
  assert.strictEqual(curEvil, evil, 'alignment conserved');
  // 每次任務隊員人數與出牌合法
  s.hist.forEach(function (e) {
    assert.strictEqual(e.team.length, [[2, 3, 2, 3, 3], [2, 3, 4, 3, 4], [2, 3, 3, 4, 4], [3, 4, 4, 5, 5], [3, 4, 4, 5, 5], [3, 4, 4, 5, 5]][s.n - 5][e.q]);
    assert(['S', 'F'].indexOf(e.real) >= 0);
    const need = (s.n >= 7 && e.q === 3) ? 2 : 1;
    assert.strictEqual(e.real, e.fails >= need ? 'F' : 'S');
  });
  // info 不會丟例外，且不洩漏自己看不到的人
  s.order.forEach(function (id) {
    const inf = A.info(s, id);
    inf.groups.forEach(function (gr) {
      (gr.ids || (gr.items || []).map(function (x) { return x.id; })).forEach(function (x) { assert(x !== id, 'sees self'); });
    });
  });
}

function playOne(seed) {
  const rnd = Core.rng('fuzz:' + seed);
  const n = 5 + Math.floor(rnd() * 6);
  const cfg = randomCfg(rnd, n);
  const mk = mkRoom(n, cfg, 'S' + seed);
  let room = mk.room;
  assert.strictEqual(room.phase, 'game', 'start failed ' + JSON.stringify(cfg) + ' n=' + n);
  const clock = { t: 5000 };
  const actions = [];
  let guard = 0;
  while (!room.game.over) {
    if (++guard > 600) throw new Error('stuck at ' + room.game.phase + ' seed ' + seed);
    const before = room;
    const t0 = clock.t; clock.t += 1500;
    room = step(room, rnd, clock);
    if (room === before) throw new Error('no-op action in phase ' + before.game.phase + ' seed ' + seed);
    checkInvariants(room);
  }
  return { room: room, n: n, cfg: cfg };
}

let games = 0; const stats = { good: 0, evil: 0, why: {} };
const N = +process.argv[2] || 3000;
for (let i = 0; i < N; i++) {
  const r = playOne(i);
  games++;
  stats[r.room.game.over.winner]++;
  stats.why[r.room.game.over.why] = (stats.why[r.room.game.over.why] || 0) + 1;
}
console.log('games', games, JSON.stringify(stats));

/* 重播一致性：把整局記錄存下來，一次折疊、逐筆折疊、亂序分批折疊，結果都要和當場玩的一樣 */
(function () {
  let checked = 0;
  for (let g = 0; g < 60; g++) {
    const rnd = Core.rng('replay' + g);
    const n = 5 + Math.floor(rnd() * 6); const cfg = randomCfg(rnd, n);
    const mk = mkRoom(n, cfg, 'RP' + g);
    // mkRoom 的前置動作也要進記錄
    const ids = mk.ids;
    const head = [
      { k: 'create', p: ids[0], t: 1000, d: { seed: 'RP' + g, name: 'P1' } }
    ];
    for (let i = 1; i < n; i++) head.push({ k: 'join', p: ids[i], t: 1000, d: { name: 'P' + (i + 1) } });
    head.push({ k: 'cfg', p: ids[0], t: 1000, d: { gameId: 'avalon', cfg: cfg } });
    head.push({ k: 'start', p: ids[0], t: 1000 });
    REC = [];
    let room = mk.room; const clock = { t: 5000 }; let guard = 0;
    while (!room.game.over && guard++ < 600) { clock.t += 1500; room = step(room, rnd, clock); }
    const all = head.concat(REC); REC = null;
    const sorted = all.map(function (a, i) { return { key: String(i).padStart(6, '0'), a: a }; });
    const full = new Core.Folder().update(sorted);
    assert.deepStrictEqual(full, room, 'full replay differs');
    const f2 = new Core.Folder(); let r2;
    for (let i = 1; i <= sorted.length; i++) r2 = f2.update(sorted.slice(0, i));
    assert.deepStrictEqual(r2, room, 'incremental replay differs');
    const f3 = new Core.Folder(); let i = 0, r3;
    while (i < sorted.length) { i = Math.min(sorted.length, i + 1 + Math.floor(rnd() * 7)); r3 = f3.update(sorted.slice(0, i)); }
    assert.deepStrictEqual(r3, room, 'batched replay differs');
    checked++;
  }
  console.log('replay consistency ok', checked);
})();
console.log('fuzz done');
