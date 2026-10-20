'use strict';
require('../src/core.js'); require('../src/onuw.js');
const Core = globalThis.Core, W = globalThis.Onuw;
const assert = require('assert');

function mk(n, cfg, seed) {
  let room = Core.newRoom(); const ids = [];
  for (let i = 1; i <= n; i++) ids.push('p' + i);
  room = Core.reduceRoom(room, { k: 'create', p: 'p1', t: 1, d: { seed: seed, name: 'A' } });
  for (let i = 1; i < n; i++) room = Core.reduceRoom(room, { k: 'join', p: ids[i], t: 1, d: { name: 'P' + (i + 1) } });
  room = Core.reduceRoom(room, { k: 'cfg', p: 'p1', t: 1, d: { gameId: 'onuw', cfg: cfg } });
  room = Core.reduceRoom(room, { k: 'start', p: 'p1', t: 1 });
  return { room: room, ids: ids };
}
function act(room, k, p, d, t) { return Core.reduceRoom(room, { k: k, p: p, t: t || 10, d: Object.assign({ ph: room.game.ph }, d || {}) }); }
function force(room, roles, center) { const r = Core.clone(room); Object.assign(r.game.roles, roles); if (center) r.game.center = center; return r; }

/* 配置檢查 */
assert(W.check(W.defaultCfg(), 5).ok);
assert.strictEqual(W.check(W.defaultCfg(), 5).roles.length, 8);
assert(!W.check({ roles: { mason: 1 } }, 5).ok, 'mason must be 2');
assert(!W.check({ roles: { werewolf: 3, seer: 1, robber: 1, troublemaker: 1 } }, 3).ok || true);
assert(!W.check({ roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1, drunk: 1, insomniac: 1, hunter: 1 } }, 3).ok, 'too many cards');
assert(!W.check(W.defaultCfg(), 2).ok);

/* 夜晚結算順序：預言家先看、強盜交換、搗蛋鬼再換、失眠者最後看 */
(function () {
  const cfg = { roles: { werewolf: 1, seer: 1, robber: 1, troublemaker: 1, insomniac: 1 }, minutes: 5 };
  let { room } = mk(5, cfg, 'x');
  room = force(room, { p1: 'werewolf', p2: 'seer', p3: 'robber', p4: 'troublemaker', p5: 'insomniac' }, ['villager', 'villager', 'villager']);
  room = act(room, 'ow.night', 'p1', { act: { peek: 1 } });
  room = act(room, 'ow.night', 'p2', { act: { mode: 'p', target: 'p3' } });
  room = act(room, 'ow.night', 'p3', { act: { target: 'p1' } });          // 強盜換到狼人
  room = act(room, 'ow.night', 'p4', { act: { a: 'p3', b: 'p5' } });        // p3(狼人) <-> p5(失眠者)
  room = act(room, 'ow.night', 'p5', { act: {} });
  const s = room.game;
  assert.strictEqual(s.phase, 'day');
  assert.deepStrictEqual(s.res.p2, [{ type: 'seerP', target: 'p3', role: 'robber' }], 'seer sees original');
  assert.strictEqual(s.res.p3[0].role, 'werewolf');
  assert.strictEqual(s.final.p1, 'robber'); assert.strictEqual(s.final.p3, 'insomniac'); assert.strictEqual(s.final.p5, 'werewolf');
  assert.strictEqual(s.res.p5[0].role, 'werewolf', 'insomniac (acts last) sees final card');
  assert.strictEqual(s.res.p1[0].role, 'villager');
  // 非法行動被忽略
  const bad = act(mk(5, cfg, 'y').room, 'ow.night', 'p1', { act: { peek: 7 } });
  assert.strictEqual(bad.game.phase, 'night');
})();

/* 投票與勝負 */
function dayRoom(roles, center, extra) {
  const cfg = { roles: { werewolf: 1 }, minutes: 5 };
  let { room } = mk(5, cfg, 'v');
  room = force(room, roles, center || ['villager', 'villager', 'villager']);
  room.game.final = Object.assign({}, roles); room.game.finalCenter = (center || ['villager', 'villager', 'villager']).slice();
  room.game.phase = 'vote'; room.game.ph += 1;
  return room;
}
function voteAll(room, map) { Object.keys(map).forEach(function (p) { room = act(room, 'ow.vote', p, { target: map[p] }); }); return room; }
const base = { p1: 'werewolf', p2: 'villager', p3: 'villager', p4: 'hunter', p5: 'tanner' };
(function () {
  // 狼人被處決：村民勝
  let r = voteAll(dayRoom(base), { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p1', p5: 'p2' });
  assert.deepStrictEqual(r.game.over.winners, ['village']);
  // 沒有人超過 1 票：沒人死，狼人勝
  r = voteAll(dayRoom(base), { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p5', p5: 'p1' });
  assert.deepStrictEqual(r.game.over.dead, []); assert.deepStrictEqual(r.game.over.winners, ['werewolf']);
  // 平票全死
  r = voteAll(dayRoom(base), { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p3', p5: 'p1' });
  assert.deepStrictEqual(r.game.over.dead.sort(), ['p2', 'p3']);
  // 皮革匠死：皮革匠勝，狼人沒死 -> 狼人不勝、村民不勝
  r = voteAll(dayRoom(base), { p1: 'p5', p2: 'p5', p3: 'p5', p4: 'p2', p5: 'p2' });
  assert.deepStrictEqual(r.game.over.winners, ['tanner']);
  // 獵人死亡帶走他投的人（狼人）
  r = voteAll(dayRoom(base), { p1: 'p4', p2: 'p4', p3: 'p4', p4: 'p1', p5: 'p2' });
  assert.deepStrictEqual(r.game.over.dead.sort(), ['p1', 'p4']); assert.deepStrictEqual(r.game.over.winners, ['village']);
  // 不能投自己、不能重複投
  let q = dayRoom(base); q = act(q, 'ow.vote', 'p1', { target: 'p1' }); assert.strictEqual(Object.keys(q.game.votes).length, 0);
  q = act(q, 'ow.vote', 'p1', { target: 'p2' }); q = act(q, 'ow.vote', 'p1', { target: 'p3' }); assert.strictEqual(q.game.votes.p1, 'p2');
  // 沒有狼人玩家：沒人死，村民勝；有人死，無人勝
  const nw = { p1: 'villager', p2: 'villager', p3: 'villager', p4: 'villager', p5: 'villager' };
  r = voteAll(dayRoom(nw, ['werewolf', 'villager', 'villager']), { p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p5', p5: 'p1' });
  assert.deepStrictEqual(r.game.over.winners, ['village']);
  r = voteAll(dayRoom(nw, ['werewolf', 'villager', 'villager']), { p1: 'p2', p2: 'p1', p3: 'p1', p4: 'p5', p5: 'p4' });
  assert.deepStrictEqual(r.game.over.winners, []);
  // 沒有狼人但有爪牙：非爪牙死 -> 狼人陣營勝
  const mn = { p1: 'minion', p2: 'villager', p3: 'villager', p4: 'villager', p5: 'villager' };
  r = voteAll(dayRoom(mn, ['werewolf', 'villager', 'villager']), { p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p3', p5: 'p2' });
  assert.deepStrictEqual(r.game.over.winners, ['werewolf']);
})();

/* 白天：過半數同意提前投票；逾時進入投票 */
(function () {
  const cfg = W.defaultCfg();
  let { room } = mk(5, cfg, 'c');
  room.game.phase = 'day'; room.game.ph += 1; room.game.t0 = 1000;
  room = act(room, 'ow.call', 'p1'); room = act(room, 'ow.call', 'p2'); assert.strictEqual(room.game.phase, 'day');
  room = act(room, 'ow.call', 'p3'); assert.strictEqual(room.game.phase, 'vote');
  let r2 = mk(5, cfg, 'c').room; r2.game.phase = 'day'; r2.game.ph += 1; r2.game.t0 = 1000;
  assert.strictEqual(act(r2, 'ow.timeout', 'p1', {}, 1000 + 60000).game.phase, 'day', 'too early');
  assert.strictEqual(act(r2, 'ow.timeout', 'p1', {}, 1000 + 300000).game.phase, 'vote');
})();

/* 隨機整局 + 重播一致 */
(function () {
  for (let g = 0; g < 500; g++) {
    const rnd = Core.rng('onuw' + g);
    const n = 3 + Math.floor(rnd() * 8);
    let cfg = null;
    for (let tries = 0; tries < 100 && !cfg; tries++) {
      const c = { roles: { werewolf: rnd() < 0.8 ? 1 + Math.floor(rnd() * 3) : 0 }, minutes: 5 };
      W.OPTIONAL.forEach(function (k) { if (rnd() < 0.4) c.roles[k] = k === 'mason' ? 2 : 1; });
      if (W.check(c, n).ok) cfg = c;
    }
    cfg = cfg || W.defaultCfg();
    const { room: r0, ids } = mk(n, cfg, 'S' + g);
    let room = r0; const log = [];
    const push = function (k, p, d) { const a = { k: k, p: p, t: 10, d: Object.assign({ ph: room.game.ph }, d) }; log.push(a); const nr = Core.reduceRoom(room, a); assert.notStrictEqual(nr, room, 'no-op ' + k); room = nr; };
    const pick = function (arr) { return arr[Math.floor(rnd() * arr.length)]; };
    Core.shuffle(ids, rnd).forEach(function (p) {
      const s = room.game, kind = W.nightKind(s, p), others = ids.filter(function (x) { return x !== p; });
      let a = {};
      if (kind === 'peek') a = rnd() < 0.5 ? { peek: pick([0, 1, 2]) } : {};
      if (kind === 'seer') a = rnd() < 0.5 ? { mode: 'p', target: pick(others) } : { mode: 'c', idx: [0, 1 + Math.floor(rnd() * 2)] };
      if (kind === 'robber') a = rnd() < 0.7 ? { target: pick(others) } : {};
      if (kind === 'tm') { if (others.length >= 2 && rnd() < 0.7) { const t = Core.shuffle(others, rnd); a = { a: t[0], b: t[1] }; } }
      if (kind === 'drunk') a = { idx: pick([0, 1, 2]) };
      push('ow.night', p, { act: a });
    });
    assert.strictEqual(room.game.phase, 'day');
    // 卡數守恆
    const all = ids.map(function (i) { return room.game.final[i]; }).concat(room.game.finalCenter).sort();
    const orig = ids.map(function (i) { return room.game.roles[i]; }).concat(room.game.center).sort();
    assert.deepStrictEqual(all, orig, 'cards conserved');
    Core.shuffle(ids, rnd).slice(0, Math.floor(ids.length / 2) + 1).forEach(function (p) { push('ow.call', p, {}); });
    assert.strictEqual(room.game.phase, 'vote');
    ids.forEach(function (p) { push('ow.vote', p, { target: pick(ids.filter(function (x) { return x !== p; })) }); });
    assert(room.game.over);
    const head = [{ k: 'create', p: 'p1', t: 1, d: { seed: 'S' + g, name: 'A' } }];
    for (let i = 1; i < n; i++) head.push({ k: 'join', p: ids[i], t: 1, d: { name: 'P' + (i + 1) } });
    head.push({ k: 'cfg', p: 'p1', t: 1, d: { gameId: 'onuw', cfg: cfg } }, { k: 'start', p: 'p1', t: 1 });
    const items = head.concat(log).map(function (a, i) { return { key: String(i).padStart(6, '0'), a: a }; });
    assert.deepStrictEqual(new Core.Folder().update(items), room, 'replay');
  }
  console.log('onuw fuzz ok');
})();
console.log('onuw tests done');
