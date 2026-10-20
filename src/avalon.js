/* 桌邊 · 阿瓦隆規則引擎
 * 純函式：reduce(狀態, 動作) -> 新狀態。所有手機用同一份記錄重播，結果一致。
 * 角色與規則來源：avalon-game.com 的規則與各角色頁面。
 */
(function (g) {
  'use strict';
  const Core = g.Core;
  const A = {};

  /* ---------- 角色資料 ---------- */
  const R = {
    merlin:        { n: '梅林', side: 'good', d: '看得到所有壞人（莫德雷德除外），但不知道他們各是什麼角色。要躲過刺客。' },
    merlin_pure:   { n: '終極梅林', side: 'good', d: '看得到壞人的具體角色（莫德雷德除外）。要躲過刺客。' },
    servant:       { n: '亞瑟的忠臣', side: 'good', d: '沒有任何資訊。任務只能出成功。' },
    percival:      { n: '派西維爾', side: 'good', d: '看得到兩位疑似梅林的人，一位是梅林，另一位是莫甘娜，分不出誰是誰。沒有莫甘娜時，只會看到梅林。' },
    tristan:       { n: '特里斯坦', side: 'good', d: '認識伊索德。刺客要同時猜中兩人才算刺殺成功。' },
    isolde:        { n: '伊索德', side: 'good', d: '認識特里斯坦。刺客要同時猜中兩人才算刺殺成功。' },
    cleric:        { n: '牧師', side: 'good', d: '第 1 次任務結束後，得知第 1 次任務隊長的顯示陣營（自己當隊長就沒有資訊）。' },
    troublemaker:  { n: '麻煩友', side: 'good', d: '好人，但被牧師、巫婆、湖中仙女查驗時會顯示為壞人。任務只能出成功。' },
    guinevere:     { n: '女皇', side: 'good', d: '知道哪兩位是蘭斯洛特，但不知道他們現在的陣營。' },
    lancelot_good: { n: '正義蘭斯洛特', side: 'good', d: '開局是好人。第 3、4、5 次任務前可能與邪惡蘭斯洛特交換陣營。目前是壞人時必須出失敗，是好人時必須出成功。' },
    assassin:      { n: '刺客', side: 'evil', d: '好人拿下三次成功後，由你指認並刺殺，猜中就翻盤。' },
    minion:        { n: '爪牙', side: 'evil', d: '壞人。認識其他壞人（奧伯倫除外）。' },
    morgana:       { n: '莫甘娜', side: 'evil', d: '在派西維爾眼中，你和梅林一樣是疑似梅林。' },
    mordred:       { n: '莫德雷德', side: 'evil', d: '梅林看不到你。' },
    oberon:        { n: '奧伯倫', side: 'evil', d: '你不認識其他壞人，其他壞人也不認識你，但梅林看得到你。' },
    trickster:     { n: '騙子', side: 'evil', d: '被牧師、巫婆、湖中仙女查驗時顯示為好人。梅林仍看得到你。' },
    witch:         { n: '巫婆', side: 'evil', d: '每局一次，在任務結果翻出來前選擇隱藏它。之後系統隨機選一位玩家，他可以查驗一個人的陣營。' },
    revealer:      { n: '被揭示者', side: 'evil', d: '公開的失敗任務累計兩次後，你的身分會向所有人公開，之後照常進行。' },
    lunatic:       { n: '瘋子', side: 'evil', d: '你參加的每次任務都必須出失敗。' },
    brute:         { n: '野蠻人', side: 'evil', d: '第 4、5 次任務只能出成功，前三次任務可以自選。' },
    lancelot_evil: { n: '邪惡蘭斯洛特', side: 'evil', d: '開局是壞人，其他壞人認得你，但你不認識他們。陣營可能與正義蘭斯洛特交換。目前是壞人時必須出失敗，是好人時必須出成功。' }
  };
  const ORDER = ['merlin', 'merlin_pure', 'servant', 'percival', 'tristan', 'isolde', 'cleric', 'troublemaker', 'guinevere', 'lancelot_good',
    'assassin', 'minion', 'morgana', 'mordred', 'oberon', 'trickster', 'witch', 'revealer', 'lunatic', 'brute', 'lancelot_evil'];
  A.R = R; A.ORDER = ORDER;

  const TEAM = [[2, 3, 2, 3, 3], [2, 3, 4, 3, 4], [2, 3, 3, 4, 4], [3, 4, 4, 5, 5], [3, 4, 4, 5, 5], [3, 4, 4, 5, 5]];
  const EVIL_N = [2, 2, 3, 3, 3, 4];
  const PRE_MS = 15000, WC_MS = 60000, LADY_MS = 120000;
  A.PRE_MS = PRE_MS; A.WC_MS = WC_MS; A.LADY_MS = LADY_MS;

  const OPT_GOOD = ['percival', 'lovers', 'cleric', 'troublemaker', 'guinevere', 'lancelots'];
  const OPT_EVIL = ['morgana', 'mordred', 'oberon', 'trickster', 'witch', 'revealer', 'lunatic', 'brute'];
  A.OPT_GOOD = OPT_GOOD; A.OPT_EVIL = OPT_EVIL;

  A.defaultCfg = function () { return { pure: false, opt: {}, lady: false, excal: false }; };

  /* ---------- 配置檢查與展開 ---------- */
  A.check = function (cfg, n) {
    cfg = cfg || A.defaultCfg();
    const o = cfg.opt || {};
    const errors = [], warnings = [];
    if (n < 5 || n > 10) errors.push('人數需為 5 到 10 人（目前 ' + n + ' 人）');
    const nn = Math.min(10, Math.max(5, n));
    const E = EVIL_N[nn - 5], G = nn - E;
    const good = [cfg.pure ? 'merlin_pure' : 'merlin'];
    const evil = ['assassin'];
    if (o.percival) good.push('percival');
    if (o.lovers) good.push('tristan', 'isolde');
    if (o.cleric) good.push('cleric');
    if (o.troublemaker) good.push('troublemaker');
    if (o.guinevere) good.push('guinevere');
    if (o.lancelots) { good.push('lancelot_good'); evil.push('lancelot_evil'); }
    OPT_EVIL.forEach(function (k) { if (o[k]) evil.push(k); });
    if (o.guinevere && !o.lancelots) errors.push('女皇需要搭配蘭斯洛特');
    if (good.length > G) errors.push('好人名額不足：已選 ' + good.length + ' 個特殊角色，' + nn + ' 人局只有 ' + G + ' 位好人');
    if (evil.length > E) errors.push('壞人名額不足：已選 ' + evil.length + ' 個壞人角色（含刺客），' + nn + ' 人局只有 ' + E + ' 位壞人');
    if ((o.trickster || o.troublemaker) && !(o.cleric || o.witch || cfg.lady)) {
      warnings.push('騙子與麻煩友需要有人查驗才有作用（牧師、巫婆或湖中仙女）');
    }
    if (o.percival && !o.morgana) warnings.push('沒有莫甘娜時，派西維爾只會看到梅林');
    let roles = null;
    if (!errors.length) {
      roles = good.slice();
      while (roles.length < G) roles.push('servant');
      evil.forEach(function (k) { roles.push(k); });
      while (roles.length < nn) roles.push('minion');
    }
    return {
      ok: !errors.length, errors: errors, warnings: warnings, roles: roles,
      slots: { good: { used: good.length, max: G }, evil: { used: evil.length, max: E } }
    };
  };
  A.expand = function (cfg, n) {
    const c = A.check(cfg, n);
    if (!c.ok) throw new Error('bad cfg: ' + c.errors.join(','));
    return c.roles;
  };
  A.rolesInPlay = function (roles) {
    const cnt = {};
    roles.forEach(function (k) { cnt[k] = (cnt[k] || 0) + 1; });
    return ORDER.filter(function (k) { return cnt[k]; }).map(function (k) { return { key: k, count: cnt[k] }; });
  };

  /* ---------- 基本查詢 ---------- */
  A.teamSize = function (s) { return TEAM[s.n - 5][s.q]; };
  A.teamSizeFor = function (n, q) { return TEAM[n - 5][q]; };
  A.needFails = function (s) { return (s.n >= 7 && s.q === 3) ? 2 : 1; };
  A.leaderId = function (s) { return s.order[s.leader]; };
  A.align = function (s, id) {
    const k = s.roles[id];
    if (k === 'lancelot_good') return s.lflip ? 'evil' : 'good';
    if (k === 'lancelot_evil') return s.lflip ? 'good' : 'evil';
    return R[k].side;
  };
  /* 被牧師、巫婆、湖中仙女查驗時看到的陣營 */
  A.shown = function (s, id) {
    const k = s.roles[id];
    if (k === 'trickster') return 'good';
    if (k === 'troublemaker') return 'evil';
    return A.align(s, id);
  };
  A.allowedCards = function (s, id) {
    const k = s.roles[id];
    if (A.align(s, id) === 'good') return ['S'];
    if (k === 'lunatic') return ['F'];
    if (k === 'lancelot_good' || k === 'lancelot_evil') return ['F'];
    if (k === 'brute' && s.q >= 3) return ['S'];
    return ['S', 'F'];
  };
  A.forcedWhy = function (s, id) {
    const k = s.roles[id];
    const al = A.align(s, id);
    if (k === 'lancelot_good' || k === 'lancelot_evil') return al === 'good' ? '你現在是好人，只能出成功' : '你現在是壞人，只能出失敗';
    if (al === 'good') return '好人只能出成功';
    if (k === 'lunatic') return '瘋子的每次任務都必須出失敗';
    if (k === 'brute' && s.q >= 3) return '野蠻人在第 4、5 次任務只能出成功';
    return '';
  };
  A.clericCandidates = function (s) {
    const present = {};
    s.order.forEach(function (i) { present[s.roles[i]] = true; });
    const goodKeys = ORDER.filter(function (k) { return R[k].side === 'good' && present[k]; });
    let c = goodKeys.filter(function (k) { return k !== 'cleric' && k !== 'lancelot_good' && k !== 'merlin' && k !== 'merlin_pure' && k !== 'guinevere'; });
    if (!c.length) c = goodKeys.filter(function (k) { return k === 'merlin' || k === 'merlin_pure' || k === 'guinevere'; });
    return c;
  };
  A.killModes = function (s) {
    const m = ['merlin'];
    if (s.cfg.opt.lovers) m.push('lovers');
    if (s.cfg.opt.guinevere) m.push('guinevere');
    if (s.cfg.opt.cleric) m.push('cleric');
    return m;
  };
  A.deadline = function (s) {
    if (s.over) return null;
    if (s.phase === 'pre') return { at: s.t0 + PRE_MS, k: 'av.timeout' };
    if (s.phase === 'wcheck') return { at: s.t0 + WC_MS, k: 'av.timeout' };
    if (s.phase === 'lady') return { at: s.t0 + LADY_MS, k: 'av.timeout' };
    return null;
  };
  A.tally = function (s) {
    return {
      succ: s.hist.filter(function (e) { return e.real === 'S'; }).length,
      fail: s.hist.filter(function (e) { return e.real === 'F'; }).length
    };
  };

  /* ---------- 私人資訊 ---------- */
  A.info = function (s, id) {
    const k = s.roles[id];
    const out = { role: k, side: R[k].side, align: A.align(s, id), groups: [], notes: [] };
    const ids = s.order;
    const initEvil = ids.filter(function (i) { return R[s.roles[i]].side === 'evil'; });
    const curEvil = ids.filter(function (i) { return A.align(s, i) === 'evil'; });
    const rnd = Core.rng(s.seed + ':info:' + id);
    function holders(key) { return ids.filter(function (i) { return s.roles[i] === key; }); }

    if (k === 'merlin') {
      out.groups.push({ title: '壞人（莫德雷德不在其中）', ids: initEvil.filter(function (i) { return s.roles[i] !== 'mordred'; }) });
    } else if (k === 'merlin_pure') {
      out.groups.push({
        title: '壞人與他們的角色（莫德雷德不在其中）',
        items: curEvil.filter(function (i) { return s.roles[i] !== 'mordred'; }).map(function (i) {
          const rk = s.roles[i];
          return { id: i, label: (rk === 'lancelot_good' || rk === 'lancelot_evil') ? '蘭斯洛特（目前是壞人）' : R[rk].n };
        })
      });
    } else if (k === 'percival') {
      const c = holders('merlin').concat(holders('merlin_pure'), holders('morgana'));
      out.groups.push({ title: c.length > 1 ? '兩位疑似梅林' : '梅林', ids: Core.shuffle(c, rnd) });
    } else if (k === 'tristan' || k === 'isolde') {
      out.groups.push({ title: k === 'tristan' ? '你的伴侶伊索德' : '你的伴侶特里斯坦', ids: holders(k === 'tristan' ? 'isolde' : 'tristan') });
    } else if (k === 'guinevere') {
      out.groups.push({ title: '兩位蘭斯洛特（不知道他們的陣營）', ids: Core.shuffle(holders('lancelot_good').concat(holders('lancelot_evil')), rnd) });
    } else if (R[k].side === 'evil' && k !== 'oberon' && k !== 'lancelot_evil') {
      out.groups.push({ title: '你的壞人隊友', ids: curEvil.filter(function (i) { return i !== id && s.roles[i] !== 'oberon'; }) });
    } else if (k === 'lancelot_good') {
      /* 沒有開局資訊 */
    }

    if (k === 'lancelot_good' || k === 'lancelot_evil') {
      out.notes.push({ type: 'lanAlign', align: out.align, flipped: s.lflip });
    }
    if (k === 'cleric' && s.hist.length >= 1) {
      const L = s.hist[0].leader;
      out.notes.push(L === id ? { type: 'clericSelf' } : { type: 'cleric', target: L, shown: A.shown(s, L) });
    }
    if (s.lady) {
      s.lady.checks.forEach(function (c) { if (c.by === id) out.notes.push({ type: 'lady', q: c.q, target: c.target, shown: A.shown(s, c.target) }); });
    }
    s.wcLog.forEach(function (c) {
      if (c.checker === id) out.notes.push(c.target ? { type: 'wcheck', q: c.q, target: c.target, shown: A.shown(s, c.target) } : { type: 'wcheckNone', q: c.q });
    });
    s.hist.forEach(function (e) {
      if (e.flip && (e.flip.by === id || e.flip.target === id)) {
        out.notes.push({ type: 'excal', q: e.q, by: e.flip.by, target: e.flip.target, to: e.flip.to, mine: e.flip.by === id ? 'holder' : 'target' });
      }
    });
    return out;
  };

  /* ---------- 初始化 ---------- */
  function setPhase(s, name, t) { s.phase = name; s.ph += 1; s.t0 = t || 0; }

  A.init = function (ctx) {
    const ids = ctx.ids, n = ids.length, cfg = Core.clone(ctx.cfg || A.defaultCfg());
    cfg.opt = cfg.opt || {};
    const keys = Core.shuffle(A.expand(cfg, n), Core.rng(ctx.seed + ':deal'));
    const roles = {};
    ids.forEach(function (id, i) { roles[id] = keys[i]; });
    const s = {
      id: 'avalon', seed: ctx.seed, order: ids.slice(), n: n, cfg: cfg, roles: roles,
      ph: 0, phase: 'team', t0: ctx.t || 0, q: 0,
      leader: Math.floor(Core.rng(ctx.seed + ':leader')() * n), rejects: 0,
      team: [], excal: null, votes: {}, cards: {}, lastVote: null,
      hist: [], voteHist: [], feed: [],
      lflip: false, deck: [], lanLog: [],
      lady: null, witchId: null, witchUsed: false, pre: null, wc: null, wcLog: [],
      revealed: null, over: null, assn: null
    };
    s.witchId = ids.find(function (i) { return roles[i] === 'witch'; }) || null;
    if (cfg.opt.lancelots) s.deck = Core.shuffle(['S', 'S', 'B', 'B', 'B'], Core.rng(ctx.seed + ':deck'));
    if (cfg.lady) {
      const holder = s.order[(s.leader - 1 + n) % n];
      s.lady = { holder: holder, held: [holder], checks: [] };
    }
    beginQuest(s, ctx.t || 0);
    return s;
  };

  function beginQuest(s, t) {
    s.team = []; s.excal = null; s.votes = {}; s.cards = {}; s.pre = null; s.wc = null;
    if (s.q >= 2 && s.cfg.opt.lancelots) {
      const c = s.deck[s.q - 2];
      if (c === 'S') s.lflip = !s.lflip;
      s.lanLog.push({ q: s.q, c: c });
    }
    if (s.q >= 2 && s.lady) setPhase(s, 'lady', t); else setPhase(s, 'team', t);
  }

  function endGame(s, winner, why, t, extra) {
    s.over = Object.assign({ winner: winner, why: why }, extra || {});
    setPhase(s, 'over', t);
    return s;
  }

  function enterPre(s, t) {
    const excalNeed = !!s.excal;
    const witchNeed = !!(s.witchId && !s.witchUsed);
    if (!excalNeed && !witchNeed) return finishQuest(s, t);
    s.pre = { excalDone: !excalNeed, witchDone: !witchNeed, flip: null, hide: false };
    setPhase(s, 'pre', t);
    return s;
  }
  function checkPre(s, t) {
    if (s.pre.excalDone && s.pre.witchDone) return finishQuest(s, t);
    return s;
  }

  function finishQuest(s, t) {
    const need = A.needFails(s);
    const fails = s.team.filter(function (x) { return s.cards[x] === 'F'; }).length;
    const real = fails >= need ? 'F' : 'S';
    const hidden = !!(s.pre && s.pre.hide);
    s.hist.push({
      q: s.q, leader: s.order[s.leader], team: s.team.slice(), excal: s.excal,
      flip: s.pre ? s.pre.flip : null, fails: fails, need: need, real: real, hidden: hidden, cards: Object.assign({}, s.cards)
    });
    if (hidden) {
      const cand = s.order.filter(function (x) { return x !== s.witchId; });
      const checker = cand[Math.floor(Core.rng(s.seed + ':wc:' + s.q)() * cand.length)];
      s.wc = { checker: checker, q: s.q };
      s.feed.push({ type: 'whide', q: s.q, checker: checker });
      setPhase(s, 'wcheck', t);
      return s;
    }
    return afterQuest(s, t);
  }

  function afterQuest(s, t) {
    const tl = A.tally(s);
    if (!s.revealed) {
      const rv = s.order.find(function (x) { return s.roles[x] === 'revealer'; });
      if (rv) {
        const pub = s.hist.filter(function (e) { return !e.hidden && e.real === 'F'; }).length;
        if (pub >= 2) { s.revealed = rv; s.feed.push({ type: 'reveal', id: rv }); }
      }
    }
    if (tl.fail >= 3) return endGame(s, 'evil', '三次任務失敗', t);
    if (tl.succ >= 3) { setPhase(s, 'assassin', t); return s; }
    setPhase(s, 'qres', t);
    return s;
  }

  /* ---------- 動作處理 ---------- */
  A.reduce = function (s0, a) {
    if (s0.over) return s0;
    const d = a.d || {};
    if (d.ph !== s0.ph) return s0;
    const p = a.p, t = a.t || 0;
    if (s0.order.indexOf(p) < 0) return s0;
    const s = Core.clone(s0);
    const leaderId = s.order[s.leader];

    switch (a.k) {
      case 'av.propose': {
        if (s.phase !== 'team' || p !== leaderId) return s0;
        const size = A.teamSize(s);
        const team = Array.isArray(d.team) ? d.team : [];
        if (team.length !== size || new Set(team).size !== size) return s0;
        if (team.some(function (x) { return s.order.indexOf(x) < 0; })) return s0;
        let ex = null;
        if (s.cfg.excal) {
          ex = d.excal;
          if (!ex || team.indexOf(ex) < 0 || ex === p) return s0;
        }
        s.team = s.order.filter(function (x) { return team.indexOf(x) >= 0; });
        s.excal = ex; s.votes = {};
        setPhase(s, 'vote', t);
        return s;
      }
      case 'av.vote': {
        if (s.phase !== 'vote' || Object.prototype.hasOwnProperty.call(s.votes, p) || typeof d.v !== 'boolean') return s0;
        s.votes[p] = d.v;
        if (Object.keys(s.votes).length === s.n) {
          const yes = s.order.filter(function (x) { return s.votes[x]; }).length;
          const approve = yes * 2 > s.n;
          s.voteHist.push({ q: s.q, leader: leaderId, team: s.team.slice(), excal: s.excal, votes: Object.assign({}, s.votes), approve: approve, rej: s.rejects });
          s.lastVote = { approve: approve, yes: yes, no: s.n - yes };
          setPhase(s, 'voteres', t);
        }
        return s;
      }
      case 'av.next': {
        if (s.phase === 'voteres') {
          if (s.lastVote.approve) {
            s.rejects = 0; s.cards = {};
            setPhase(s, 'quest', t);
          } else {
            s.rejects += 1;
            if (s.rejects >= 5) return endGame(s, 'evil', '連續五次組隊被否決', t);
            s.leader = (s.leader + 1) % s.n;
            s.team = []; s.excal = null; s.votes = {};
            setPhase(s, 'team', t);
          }
          return s;
        }
        if (s.phase === 'qres') {
          s.q += 1;
          s.leader = (s.leader + 1) % s.n;
          beginQuest(s, t);
          return s;
        }
        return s0;
      }
      case 'av.card': {
        if (s.phase !== 'quest' || s.team.indexOf(p) < 0 || s.cards[p]) return s0;
        if (A.allowedCards(s, p).indexOf(d.c) < 0) return s0;
        s.cards[p] = d.c;
        if (Object.keys(s.cards).length === s.team.length) return enterPre(s, t);
        return s;
      }
      case 'av.excal': {
        if (s.phase !== 'pre' || p !== s.excal || s.pre.excalDone) return s0;
        const tg = d.target;
        if (tg) {
          if (s.team.indexOf(tg) < 0 || tg === p) return s0;
          const from = s.cards[tg], to = from === 'S' ? 'F' : 'S';
          s.cards[tg] = to;
          s.pre.flip = { by: p, target: tg, from: from, to: to };
          s.feed.push({ type: 'excal', q: s.q, by: p, target: tg });
        } else {
          s.feed.push({ type: 'excalPass', q: s.q, by: p });
        }
        s.pre.excalDone = true;
        return checkPre(s, t);
      }
      case 'av.witch': {
        if (s.phase !== 'pre' || p !== s.witchId || s.pre.witchDone) return s0;
        if (d.hide) {
          if (s.witchUsed) return s0;
          s.witchUsed = true; s.pre.hide = true;
        }
        s.pre.witchDone = true;
        return checkPre(s, t);
      }
      case 'av.wcheck': {
        if (s.phase !== 'wcheck' || !s.wc || p !== s.wc.checker) return s0;
        const tg = d.target || null;
        if (tg && (s.order.indexOf(tg) < 0 || tg === p)) return s0;
        s.wcLog.push({ q: s.q, checker: p, target: tg });
        s.feed.push(tg ? { type: 'wcheck', q: s.q, by: p, target: tg } : { type: 'wcheckNone', q: s.q, by: p });
        return afterQuest(s, t);
      }
      case 'av.lady': {
        if (s.phase !== 'lady' || !s.lady || p !== s.lady.holder) return s0;
        const tg = d.target;
        if (!tg || tg === p || s.order.indexOf(tg) < 0 || s.lady.held.indexOf(tg) >= 0) return s0;
        s.lady.checks.push({ q: s.q, by: p, target: tg });
        s.lady.holder = tg; s.lady.held.push(tg);
        s.feed.push({ type: 'lady', q: s.q, by: p, target: tg });
        setPhase(s, 'team', t);
        return s;
      }
      case 'av.timeout': {
        const dl = A.deadline(s);
        if (!dl || t < dl.at - 300) return s0;
        if (s.phase === 'pre') {
          s.pre.excalDone = true; s.pre.witchDone = true;
          return checkPre(s, t);
        }
        if (s.phase === 'wcheck') {
          s.wcLog.push({ q: s.q, checker: s.wc.checker, target: null });
          s.feed.push({ type: 'wcheckNone', q: s.q, by: s.wc.checker });
          return afterQuest(s, t);
        }
        if (s.phase === 'lady') {
          s.feed.push({ type: 'ladySkip', q: s.q });
          setPhase(s, 'team', t);
          return s;
        }
        return s0;
      }
      case 'av.kill': {
        if (s.phase !== 'assassin' || s.roles[p] !== 'assassin') return s0;
        const m = d.mode, tg = Array.isArray(d.targets) ? d.targets : [];
        if (A.killModes(s).indexOf(m) < 0) return s0;
        if (tg.some(function (x) { return s.order.indexOf(x) < 0; })) return s0;
        const extra = { kill: { mode: m, targets: tg } };
        if (m === 'merlin') {
          if (tg.length !== 1) return s0;
          const ok = s.roles[tg[0]] === 'merlin' || s.roles[tg[0]] === 'merlin_pure';
          return endGame(s, ok ? 'evil' : 'good', ok ? '刺客刺中了梅林' : '刺客沒有刺中梅林', t, extra);
        }
        if (m === 'lovers') {
          if (tg.length !== 2 || tg[0] === tg[1]) return s0;
          const ks = tg.map(function (x) { return s.roles[x]; }).sort().join(',');
          const ok = ks === 'isolde,tristan';
          return endGame(s, ok ? 'evil' : 'good', ok ? '刺客同時指認了特里斯坦與伊索德' : '刺客沒有同時指認出特里斯坦與伊索德', t, extra);
        }
        if (m === 'guinevere') {
          if (tg.length !== 1) return s0;
          const ok = s.roles[tg[0]] === 'guinevere';
          return endGame(s, ok ? 'evil' : 'good', ok ? '刺客指認了女皇' : '刺客沒有指認出女皇', t, extra);
        }
        if (m === 'cleric') {
          if (tg.length !== 1) return s0;
          if (s.roles[tg[0]] !== 'cleric') return endGame(s, 'good', '刺客沒有認出牧師', t, extra);
          s.assn = { step: 2, cleric: tg[0] };
          s.feed.push({ type: 'clericHit' });
          setPhase(s, 'assassin2', t);
          return s;
        }
        return s0;
      }
      case 'av.kill2': {
        if (s.phase !== 'assassin2' || s.roles[p] !== 'assassin') return s0;
        if (A.clericCandidates(s).indexOf(d.role) < 0 || s.order.indexOf(d.target) < 0) return s0;
        const ok = s.roles[d.target] === d.role;
        return endGame(s, ok ? 'evil' : 'good', ok ? '刺客認出了牧師，也猜中了第二個目標' : '刺客認出牧師，但第二個目標猜錯了', t,
          { kill: { mode: 'cleric', targets: [s.assn.cleric, d.target], role: d.role } });
      }
      default: return s0;
    }
  };

  A.id = 'avalon'; A.name = '阿瓦隆'; A.prefix = 'av.'; A.ready = true; A.min = 5; A.max = 10;
  Core.games.avalon = A;
  g.Avalon = A;
  if (typeof module !== 'undefined' && module.exports) module.exports = A;
})(typeof globalThis !== 'undefined' ? globalThis : window);
