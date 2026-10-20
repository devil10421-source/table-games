/* 桌邊 · 一夜終極狼人規則引擎
 * 規則：玩家數 + 3 張牌，3 張放中間。夜晚每人（同時）做自己的行動，全部完成後依固定順序結算，
 * 白天討論，同時投票，得票最多者死亡。沿用阿瓦隆同一套「記錄重播」架構。
 * 未實作：化身幽靈。
 */
(function (g) {
  'use strict';
  const Core = g.Core;
  const W = {};

  const R = {
    villager:     { n: '村民', team: 'village', d: '沒有特殊能力。靠討論找出狼人。' },
    werewolf:     { n: '狼人', team: 'werewolf', d: '夜晚彼此認識。如果只有你一隻狼，可以偷看 1 張中間牌。你要避免狼人被處決。' },
    minion:       { n: '爪牙', team: 'werewolf', d: '夜晚會知道誰是狼人（狼人不知道你是誰）。你要讓狼人活下來，即使你自己被處決也算贏。' },
    mason:        { n: '守夜人', team: 'village', d: '夜晚認識另一位守夜人。' },
    seer:         { n: '預言家', team: 'village', d: '夜晚二選一：看一位玩家的牌，或看兩張中間牌。' },
    robber:       { n: '強盜', team: 'village', d: '夜晚可以和一位玩家交換牌，並看你拿到的新牌。之後你屬於新牌的陣營。' },
    troublemaker: { n: '搗蛋鬼', team: 'village', d: '夜晚可以交換另外兩位玩家的牌（不能看）。' },
    drunk:        { n: '酒鬼', team: 'village', d: '夜晚必須和一張中間牌交換，而且不能看新牌。' },
    insomniac:    { n: '失眠者', team: 'village', d: '夜晚最後醒來，看一眼自己現在的牌。' },
    hunter:       { n: '獵人', team: 'village', d: '你被處決時，你投票指的那個人也會一起死。' },
    tanner:       { n: '皮革匠', team: 'tanner', d: '你只想被處決。你死了就算你贏；此時如果有狼人也死了，村民也贏。' }
  };
  const ORDER = ['villager', 'werewolf', 'minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'hunter', 'tanner'];
  const TEAM_NAME = { village: '村民陣營', werewolf: '狼人陣營', tanner: '皮革匠' };
  W.R = R; W.ORDER = ORDER; W.TEAM_NAME = TEAM_NAME;
  W.OPTIONAL = ['minion', 'mason', 'seer', 'robber', 'troublemaker', 'drunk', 'insomniac', 'hunter', 'tanner'];
  W.MINUTES = [3, 5, 8];

  W.defaultCfg = function () { return { roles: { werewolf: 2, seer: 1, robber: 1, troublemaker: 1 }, minutes: 5 }; };

  W.check = function (cfg, n) {
    cfg = cfg || W.defaultCfg();
    const rc = cfg.roles || {};
    const errors = [], warnings = [];
    if (n < 3 || n > 10) errors.push('人數需為 3 到 10 人（目前 ' + n + ' 人）');
    const total = Math.min(10, Math.max(3, n)) + 3;
    const roles = [];
    let used = 0;
    ORDER.forEach(function (k) {
      if (k === 'villager') return;
      const c = rc[k] || 0;
      if (k === 'werewolf' && c > 3) errors.push('狼人最多 3 張');
      if (k === 'mason' && c !== 0 && c !== 2) errors.push('守夜人要一次放 2 張');
      if (k !== 'werewolf' && k !== 'mason' && c > 1) errors.push(R[k].n + '最多 1 張');
      for (let i = 0; i < c; i++) roles.push(k);
      used += c;
    });
    if (used > total) errors.push('角色牌太多：選了 ' + used + ' 張，這局只有 ' + total + ' 張牌（玩家數 + 3）');
    if (!(rc.werewolf > 0)) warnings.push('沒有狼人牌：玩家之中可能沒有人是狼人，大家都要賭「沒有狼人」');
    if (rc.minion && !(rc.werewolf > 0)) warnings.push('爪牙需要有狼人牌才有意義');
    let list = null;
    if (!errors.length) {
      list = roles.slice();
      while (list.length < total) list.push('villager');
    }
    return { ok: !errors.length, errors: errors, warnings: warnings, roles: list, slots: { used: used, max: total } };
  };
  W.rolesInPlay = function (roles) {
    const cnt = {};
    roles.forEach(function (k) { cnt[k] = (cnt[k] || 0) + 1; });
    return ORDER.filter(function (k) { return cnt[k]; }).map(function (k) { return { key: k, count: cnt[k] }; });
  };

  function setPhase(s, name, t) { s.phase = name; s.ph += 1; s.t0 = t || 0; }

  W.init = function (ctx) {
    const ids = ctx.ids, n = ids.length, cfg = Core.clone(ctx.cfg || W.defaultCfg());
    const chk = W.check(cfg, n);
    if (!chk.ok) throw new Error('bad cfg');
    const deck = Core.shuffle(chk.roles, Core.rng(ctx.seed + ':deal'));
    const roles = {};
    ids.forEach(function (id, i) { roles[id] = deck[i]; });
    return {
      id: 'onuw', seed: ctx.seed, order: ids.slice(), n: n, cfg: cfg, roles: roles, center: deck.slice(n),
      ph: 0, phase: 'night', t0: ctx.t || 0, acts: {}, final: null, finalCenter: null, res: {},
      calls: [], votes: {}, over: null
    };
  };

  W.holders = function (s, key) { return s.order.filter(function (i) { return s.roles[i] === key; }); };
  W.lone = function (s, id) { return s.roles[id] === 'werewolf' && W.holders(s, 'werewolf').length === 1; };

  /* 這個玩家夜晚要做什麼：'none'（只需確認）、或具體行動 */
  W.nightKind = function (s, id) {
    const k = s.roles[id];
    if (k === 'werewolf') return W.lone(s, id) ? 'peek' : 'none';
    if (k === 'seer') return 'seer';
    if (k === 'robber') return 'robber';
    if (k === 'troublemaker') return 'tm';
    if (k === 'drunk') return 'drunk';
    return 'none';
  };

  W.deadline = function (s) {
    if (s.over) return null;
    if (s.phase === 'day') return { at: s.t0 + s.cfg.minutes * 60000, k: 'ow.timeout' };
    return null;
  };

  function validAct(s, id, a) {
    const kind = W.nightKind(s, id);
    const isP = function (x) { return typeof x === 'string' && s.order.indexOf(x) >= 0 && x !== id; };
    const isC = function (x) { return x === 0 || x === 1 || x === 2; };
    if (kind === 'none') return {};
    if (kind === 'peek') return isC(a.peek) ? { peek: a.peek } : (a.peek == null ? {} : null);
    if (kind === 'seer') {
      if (a.mode === 'p' && isP(a.target)) return { mode: 'p', target: a.target };
      if (a.mode === 'c' && Array.isArray(a.idx) && a.idx.length === 2 && a.idx[0] !== a.idx[1] && a.idx.every(isC)) return { mode: 'c', idx: a.idx.slice() };
      return null;
    }
    if (kind === 'robber') return isP(a.target) ? { target: a.target } : (a.target == null ? {} : null);
    if (kind === 'tm') {
      if (a.a == null && a.b == null) return {};
      return (isP(a.a) && isP(a.b) && a.a !== a.b) ? { a: a.a, b: a.b } : null;
    }
    if (kind === 'drunk') return isC(a.idx) ? { idx: a.idx } : null;
    return null;
  }

  function resolveNight(s) {
    const cards = Object.assign({}, s.roles), center = s.center.slice();
    const res = {}; s.order.forEach(function (i) { res[i] = []; });
    const by = function (k) { return W.holders(s, k); };
    by('werewolf').forEach(function (w) {
      const a = s.acts[w];
      if (W.lone(s, w) && a && a.peek != null) res[w].push({ type: 'peek', idx: a.peek, role: center[a.peek] });
    });
    by('seer').forEach(function (i) {
      const a = s.acts[i];
      if (a.mode === 'p') res[i].push({ type: 'seerP', target: a.target, role: cards[a.target] });
      else res[i].push({ type: 'seerC', idx: a.idx, roles: a.idx.map(function (x) { return center[x]; }) });
    });
    by('robber').forEach(function (i) {
      const a = s.acts[i];
      if (a.target) { const t = cards[i]; cards[i] = cards[a.target]; cards[a.target] = t; res[i].push({ type: 'robber', target: a.target, role: cards[i] }); }
      else res[i].push({ type: 'robberNone' });
    });
    by('troublemaker').forEach(function (i) {
      const a = s.acts[i];
      if (a.a) { const t = cards[a.a]; cards[a.a] = cards[a.b]; cards[a.b] = t; res[i].push({ type: 'tm', a: a.a, b: a.b }); }
      else res[i].push({ type: 'tmNone' });
    });
    by('drunk').forEach(function (i) {
      const a = s.acts[i];
      const t = cards[i]; cards[i] = center[a.idx]; center[a.idx] = t;
      res[i].push({ type: 'drunk', idx: a.idx });
    });
    by('insomniac').forEach(function (i) { res[i].push({ type: 'insomniac', role: cards[i] }); });
    s.final = cards; s.finalCenter = center; s.res = res;
  }

  function resolveVote(s) {
    const tally = {}; s.order.forEach(function (i) { tally[i] = 0; });
    s.order.forEach(function (i) { tally[s.votes[i]] += 1; });
    const max = Math.max.apply(null, s.order.map(function (i) { return tally[i]; }));
    const dead = max > 1 ? s.order.filter(function (i) { return tally[i] === max; }) : [];
    const shots = [];
    let changed = true;
    while (changed) {
      changed = false;
      dead.slice().forEach(function (d) {
        if (s.final[d] === 'hunter') {
          const t = s.votes[d];
          if (dead.indexOf(t) < 0) { dead.push(t); shots.push({ by: d, target: t }); changed = true; }
        }
      });
    }
    const fin = function (i) { return s.final[i]; };
    const wolfPlayers = s.order.filter(function (i) { return fin(i) === 'werewolf'; });
    const wolfDied = dead.some(function (i) { return fin(i) === 'werewolf'; });
    const tannerDied = dead.some(function (i) { return fin(i) === 'tanner'; });
    const minionIn = s.order.some(function (i) { return fin(i) === 'minion'; });
    const winners = [];
    if (tannerDied) winners.push('tanner');
    if (wolfPlayers.length) {
      if (wolfDied) winners.push('village'); else if (!tannerDied) winners.push('werewolf');
    } else if (minionIn) {
      if (dead.some(function (i) { return fin(i) !== 'minion'; })) winners.push('werewolf'); else winners.push('village');
    } else if (!dead.length) winners.push('village');
    s.over = { winners: winners, dead: dead, tally: tally, shots: shots, noWolf: !wolfPlayers.length, noDeath: !dead.length };
    s.phase = 'over'; s.ph += 1;
  }

  W.teamOf = function (s, id) { return R[s.final ? s.final[id] : s.roles[id]].team; };
  W.won = function (s, id) {
    if (!s.over) return false;
    const t = W.teamOf(s, id);
    return s.over.winners.indexOf(t) >= 0;
  };

  W.info = function (s, id) {
    const k = s.roles[id];
    const out = { role: k, team: R[k].team, groups: [], notes: [] };
    if (k === 'werewolf') {
      const o = W.holders(s, 'werewolf').filter(function (i) { return i !== id; });
      if (o.length) out.groups.push({ title: '其他狼人', ids: o }); else out.notes.push({ type: 'loneWolf' });
    }
    if (k === 'minion') {
      const w = W.holders(s, 'werewolf');
      if (w.length) out.groups.push({ title: '狼人', ids: w }); else out.notes.push({ type: 'noWolf' });
    }
    if (k === 'mason') {
      const o = W.holders(s, 'mason').filter(function (i) { return i !== id; });
      out.groups.push({ title: '另一位守夜人', ids: o });
    }
    if (s.phase !== 'night' && s.res[id]) s.res[id].forEach(function (n) { out.notes.push(n); });
    return out;
  };

  W.reduce = function (s0, a) {
    if (s0.over) return s0;
    const d = a.d || {};
    if (d.ph !== s0.ph) return s0;
    const p = a.p, t = a.t || 0;
    if (s0.order.indexOf(p) < 0) return s0;
    const s = Core.clone(s0);
    switch (a.k) {
      case 'ow.night': {
        if (s.phase !== 'night' || s.acts[p]) return s0;
        const act = validAct(s, p, d.act || {});
        if (!act) return s0;
        s.acts[p] = act;
        if (Object.keys(s.acts).length === s.n) { resolveNight(s); setPhase(s, 'day', t); }
        return s;
      }
      case 'ow.call': {
        if (s.phase !== 'day' || s.calls.indexOf(p) >= 0) return s0;
        s.calls.push(p);
        if (s.calls.length * 2 > s.n) setPhase(s, 'vote', t);
        return s;
      }
      case 'ow.timeout': {
        const dl = W.deadline(s);
        if (!dl || s.phase !== 'day' || t < dl.at - 300) return s0;
        setPhase(s, 'vote', t);
        return s;
      }
      case 'ow.vote': {
        if (s.phase !== 'vote' || (p in s.votes)) return s0;
        if (s.order.indexOf(d.target) < 0 || d.target === p) return s0;
        s.votes[p] = d.target;
        if (Object.keys(s.votes).length === s.n) resolveVote(s);
        return s;
      }
      default: return s0;
    }
  };

  W.id = 'onuw'; W.name = '一夜終極狼人'; W.prefix = 'ow.'; W.ready = true; W.min = 3; W.max = 10;
  Core.games.onuw = W;
  g.Onuw = W;
  if (typeof module !== 'undefined' && module.exports) module.exports = W;
})(typeof globalThis !== 'undefined' ? globalThis : window);
