/* 桌邊 · 手機介面（大廳 + 阿瓦隆） */
(function () {
  'use strict';
  const Core = window.Core, AV = window.Avalon, OW = window.Onuw, esc = Core.esc;
  const qs = new URLSearchParams(location.search);
  const LOCAL = qs.get('local') === '1';
  const FBCFG = (window.TABLE_CONFIG && window.TABLE_CONFIG.firebase && window.TABLE_CONFIG.firebase.databaseURL) ? window.TABLE_CONFIG.firebase : null;
  const ONLINE = LOCAL || !!FBCFG;
  const store = LOCAL ? window.sessionStorage : window.localStorage;
  function sget(k) { try { return store.getItem(k); } catch (e) { return null; } }
  function sset(k, v) { try { if (v == null) store.removeItem(k); else store.setItem(k, v); } catch (e) { /* ignore */ } }
  function lget(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* ignore */ } }

  const GAMES = [
    { id: 'avalon', n: '阿瓦隆', d: '5–10 人 · 推理與辯論', ready: true },
    { id: 'onuw', n: '一夜終極狼人', d: '3–10 人 · 一晚決勝負', ready: true },
    { id: 'undercover', n: '誰是臥底', d: '4–12 人 · 描述詞語找臥底', ready: false }
  ];

  const S = {
    screen: 'home', tp: null, folder: null, room: Core.newRoom(), meId: null, sim: false, viewAs: null,
    code: '', tab: 'game', err: '', busy: false, conn: true, synced: false, joined: false,
    name: lget('table:name') || '', joinCode: Core.normCode(qs.get('room') || ''),
    sel: { ph: -1, team: [], excal: null, target: null, mode: null, targets: [], role: null },
    holding: false, dirty: false, timeoutSent: {}, jitter: {}
  };

  const root = document.getElementById('root');
  const tabsEl = document.getElementById('tabs');

  /* ---------- 小工具 ---------- */
  function me() { return S.sim ? S.viewAs : S.meId; }
  function nm(id) { return esc(Core.nameOf(S.room, id)); }
  function seat(id) { return Core.seatOf(S.room, id); }
  function isHost() { return S.room.hostId === me(); }
  function g() { return S.room.game; }
  function tx(id) { return '<b>' + nm(id) + '</b>'; }
  function names(ids) { return ids.map(nm).join('、') || '（無）'; }
  function sideChip(side) { return '<span class="chip ' + (side === 'good' ? 'good' : 'evil') + '">' + (side === 'good' ? '好人' : '壞人') + '</span>'; }
  function alignWord(a) { return a === 'good' ? '好人' : '壞人'; }
  function toast(msg) {
    const old = document.querySelector('.toast'); if (old) old.remove();
    const el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); el.textContent = msg;
    document.body.appendChild(el); setTimeout(function () { el.remove(); }, 1800);
  }
  function copyText(text) {
    function fb() {
      const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      let ok = false; try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove(); toast(ok ? '已複製' : '請手動複製：' + text);
    }
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(text).then(function () { toast('已複製'); }, fb); return; } } catch (e) { /* fallthrough */ }
    fb();
  }
  function inviteText() {
    const url = location.origin && location.origin !== 'null' ? location.origin + location.pathname + '?' + (LOCAL ? 'local=1&' : '') + 'room=' + S.code : '';
    return '來玩桌邊！房號 ' + S.code + (url ? '\n' + url : '');
  }

  /* ---------- 連線 ---------- */
  async function openTransport(code) {
    if (LOCAL) return Core.openLocal(code);
    return await Core.openFirebase(code, FBCFG);
  }
  function attach(tp) {
    S.tp = tp; S.folder = new Core.Folder(); S.synced = false;
    tp.onChange(function (items) { S.room = S.folder.update(items); S.synced = true; onRoom(); });
    if (tp.onConnection) tp.onConnection(function (c) { S.conn = c; render(); });
  }
  function saveSession() { sset('table:sess', JSON.stringify({ code: S.code, id: S.meId, name: S.name })); }
  function closeRoom(msg) {
    try { if (S.tp) S.tp.close(); } catch (e) { /* ignore */ }
    S.tp = null; S.folder = null; S.room = Core.newRoom(); S.screen = 'home'; S.sim = false; S.viewAs = null;
    S.meId = null; S.code = ''; S.joined = false; S.synced = false; S.err = msg || ''; S.tab = 'game'; S.timeoutSent = {};
    sset('table:sess', null);
    render();
  }
  function onRoom() {
    if (S.screen === 'room' && S.joined && !S.sim && S.room.created && !S.room.players.some(function (p) { return p.id === S.meId; })) {
      closeRoom(S.room.phase === 'lobby' ? '你已不在這個房間裡' : '這個房間的遊戲已經開始，無法中途加入');
      return;
    }
    if (S.room.created && S.room.players.some(function (p) { return p.id === S.meId; })) S.joined = true;
    render();
  }
  function cleanedName() { S.name = Core.cleanName(S.name, ''); lset('table:name', S.name); return S.name; }

  async function createRoom() {
    if (!ONLINE) return;
    const name = cleanedName() || '房主';
    S.busy = true; S.err = ''; render();
    try {
      const code = Core.randomCode(), id = Core.randomId();
      const tp = await openTransport(code);
      S.code = code; S.meId = id; S.screen = 'room'; attach(tp); saveSession();
      await tp.push({ k: 'create', p: id, d: { seed: Core.randomId() + Core.randomId(), name: name } });
    } catch (e) { closeRoom('連線失敗：' + (e && e.message ? e.message : e)); }
    S.busy = false; render();
  }
  async function joinRoom(code, resumeId) {
    if (!ONLINE) return;
    code = Core.normCode(code);
    if (code.length !== 5) { S.err = '房號是 5 個字元'; render(); return; }
    const name = cleanedName() || '玩家';
    S.busy = true; S.err = ''; render();
    try {
      const id = resumeId || Core.randomId();
      const tp = await openTransport(code);
      S.code = code; S.meId = id; S.screen = 'room'; attach(tp); saveSession();
      if (!resumeId) await tp.push({ k: 'join', p: id, d: { name: name } });
      setTimeout(function () { if (S.tp === tp && !S.room.created) closeRoom('找不到房號 ' + code + '，請再確認'); }, 5000);
    } catch (e) { closeRoom('連線失敗：' + (e && e.message ? e.message : e)); }
    S.busy = false; render();
  }
  async function startSim() {
    const tp = Core.openSim();
    S.sim = true; S.code = 'DEMO'; S.screen = 'room'; S.joined = true; attach(tp);
    const nmz = ['小明', '阿華', '小美', '大雄', '靜香', '胖虎', '小夫'];
    S.meId = 'p1'; S.viewAs = 'p1';
    await tp.push({ k: 'create', p: 'p1', d: { seed: Core.randomId(), name: Core.cleanName(S.name, '') || nmz[0] } });
    for (let i = 2; i <= 7; i++) await tp.push({ k: 'join', p: 'p' + i, d: { name: nmz[i - 1] } });
  }
  function send(k, d) { return S.tp ? S.tp.push({ k: k, p: me(), d: d || {} }) : Promise.resolve(); }
  function play(k, d) { const s = g(); return send(k, Object.assign({ ph: s ? s.ph : 0 }, d || {})); }

  /* ---------- 選取狀態（依階段重置） ---------- */
  function sel() {
    const s = g(); const ph = s ? s.ph : -2;
    if (S.sel.ph !== ph) S.sel = { ph: ph, team: [], excal: null, target: null, mode: null, targets: [], role: null };
    return S.sel;
  }

  /* ---------- 畫面 ---------- */
  function render() {
    if (S.holding) { S.dirty = true; return; }
    S.dirty = false;
    let html = '';
    const inGame = S.screen === 'room' && S.room.created && S.room.phase === 'game' && g();
    if (S.screen === 'home') html = homeView();
    else if (!S.room.created) html = '<div class="card"><h2>連線中…</h2><p class="muted">正在連到房間 ' + esc(S.code) + '</p><button class="link" data-act="home">取消</button></div>';
    else html = topBar() + (S.room.phase === 'lobby' ? lobbyView() : gameView());
    const active = document.activeElement;
    const keep = active && active.id && active.tagName === 'INPUT' ? { id: active.id, a: active.selectionStart, b: active.selectionEnd } : null;
    root.innerHTML = html;
    document.body.classList.toggle('has-tabs', !!inGame);
    tabsEl.hidden = !inGame;
    if (inGame) {
      tabsEl.innerHTML = '<div class="tabs-in" role="tablist">' + [['game', '遊戲'], ['me', '我的身分'], ['log', S.room.gameId === 'onuw' ? '說明' : '紀錄']].map(function (t) {
        return '<button role="tab" aria-selected="' + (S.tab === t[0]) + '" data-act="tab" data-v="' + t[0] + '">' + t[1] + '</button>';
      }).join('') + '</div>';
    } else tabsEl.innerHTML = '';
    if (keep) { const el = document.getElementById(keep.id); if (el) { el.focus(); try { el.setSelectionRange(keep.a, keep.b); } catch (e) { /* ignore */ } } }
    tickCountdowns();
  }

  function homeView() {
    const dis = !ONLINE || S.busy ? ' disabled' : '';
    return '<div class="stack"><h1>桌邊</h1><p class="muted">面對面聚會用的桌遊小幫手。每人一支手機，只負責發身分與記錄，討論靠嘴巴。</p></div>' +
      '<div class="card"><label for="nm"><h3>你的名字</h3></label><input id="nm" class="txt" maxlength="10" autocomplete="off" placeholder="例如：小明" value="' + esc(S.name) + '"></div>' +
      (S.err ? '<p class="err" role="alert">' + esc(S.err) + '</p>' : '') +
      (ONLINE ? '' : '<div class="card warn small">這個版本還沒有連到伺服器，只能用下方的單機示範。正式使用請看「設定教學」。</div>') +
      '<div class="card"><button class="btn primary" data-act="create"' + dis + '>開一個新房間</button>' +
      '<div class="muted small" style="text-align:center">或輸入朋友給你的房號</div>' +
      '<input id="jc" class="txt code" maxlength="5" autocomplete="off" inputmode="text" placeholder="房號" value="' + esc(S.joinCode) + '" aria-label="房號">' +
      '<button class="btn" data-act="join"' + dis + '>加入房間</button></div>' +
      '<button class="btn ghost" data-act="sim">單機示範（一個畫面扮演 7 個人）</button>';
  }

  function topBar() {
    let right = '';
    if (S.sim) {
      right = '<select class="sel" data-act-change="viewas" aria-label="切換視角">' + S.room.players.map(function (p) {
        return '<option value="' + p.id + '"' + (p.id === S.viewAs ? ' selected' : '') + '>以「' + esc(p.name) + '」的視角</option>';
      }).join('') + '</select>';
    } else {
      right = '<span class="conn' + (S.conn ? '' : ' off') + '">' + (S.conn ? '已連線' : '連線中斷…') + '</span>';
    }
    const chip = S.sim ? '<span class="chip">示範</span>' : '<button class="codechip" data-act="copy" aria-label="複製邀請文字">' + esc(S.code) + '</button>';
    return '<div class="top">' + chip + right + '</div>';
  }

  /* ---------- 大廳 ---------- */
  function cfgNow() {
    const c = Object.assign(AV.defaultCfg(), Core.clone(S.room.cfg.avalon || {}));
    c.opt = c.opt || {}; return c;
  }
  function setCfg(mut) { const c = Core.clone(cfgNow()); mut(c); send('cfg', { gameId: 'avalon', cfg: c }); }
  function applyPreset(c, v, n) {
    c.opt = {};
    if (v === 'teach') return;
    c.opt.percival = true; c.opt.morgana = true;
    if (v === 'full') ['mordred', 'oberon'].forEach(function (k) { c.opt[k] = true; if (!AV.check(c, n).ok) delete c.opt[k]; });
  }
  const OPT_LABEL = {
    percival: ['派西維爾', R_d('percival')], lovers: ['特里斯坦 & 伊索德', '兩個好人互相認識；刺客要同時猜中兩人'],
    cleric: ['牧師', R_d('cleric')], troublemaker: ['麻煩友', R_d('troublemaker')], guinevere: ['女皇（需蘭斯洛特）', R_d('guinevere')],
    lancelots: ['正義 / 邪惡蘭斯洛特', '各佔一個好人、壞人名額，第 3–5 次任務前可能交換陣營'],
    morgana: ['莫甘娜', R_d('morgana')], mordred: ['莫德雷德', R_d('mordred')], oberon: ['奧伯倫', R_d('oberon')],
    trickster: ['騙子', R_d('trickster')], witch: ['巫婆', R_d('witch')], revealer: ['被揭示者', R_d('revealer')],
    lunatic: ['瘋子', R_d('lunatic')], brute: ['野蠻人', R_d('brute')]
  };
  function R_d(k) { return AV.R[k].d; }

  function optBtn(act, key, title, desc, on, disabled) {
    return '<button class="opt" data-act="' + act + '" data-k="' + key + '" aria-pressed="' + (!!on) + '"' + (disabled ? ' disabled' : '') + '><span class="box">' + (on ? '✓' : '') + '</span><span><span class="ot">' + esc(title) + '</span><br><span class="od">' + esc(desc) + '</span></span></button>';
  }

  function lobbyView() {
    const room = S.room, n = room.players.length, host = isHost();
    const gid = room.gameId || 'avalon', isOw = gid === 'onuw';
    const cfg = isOw ? cfgOw() : cfgNow(); const chk = (isOw ? OW : AV).check(cfg, n);
    const list = '<ul class="plist">' + room.players.map(function (p, i) {
      const mine = p.id === me();
      let ctl = '';
      if (host) {
        ctl = '<button class="mini" data-act="move" data-id="' + p.id + '" data-dir="-1" aria-label="上移"' + (i === 0 ? ' disabled' : '') + '>▲</button>' +
          '<button class="mini" data-act="move" data-id="' + p.id + '" data-dir="1" aria-label="下移"' + (i === n - 1 ? ' disabled' : '') + '>▼</button>' +
          (p.id !== me() ? '<button class="mini" data-act="kick" data-id="' + p.id + '" aria-label="請出">✕</button>' : '');
      }
      return '<li class="' + (mine ? 'me' : '') + '"><span class="no">' + (i + 1) + '</span><span class="nm">' + esc(p.name) + '</span>' +
        (p.id === room.hostId ? '<span class="chip acc">房主</span>' : '') + (mine && !S.sim ? '<span class="chip">你</span>' : '') + ctl + '</li>';
    }).join('') + '</ul>';
    let h = '<div class="card"><div class="row"><h2>等人加入</h2><span class="muted">' + n + ' / 10 人</span></div>' + list +
      (S.sim && host ? '<div class="btnrow"><button class="btn slim" data-act="addbot"' + (n >= 10 ? ' disabled' : '') + '>＋ 加一位</button></div>' : '') +
      '<p class="muted small">' + (isOw ? '座位順序只影響畫面排列，' : '座位順序就是任務隊長輪流的順序，') + (host ? '可以用 ▲▼ 調成大家實際的圍坐順序。' : '房主可以調整。') + '</p>' +
      (!S.sim ? '<button class="btn" data-act="copy">複製邀請（房號 ' + esc(S.code) + '）</button>' : '') + '</div>';

    h += '<div class="card"><h3>選擇遊戲</h3><div class="opts">' + GAMES.map(function (gm) {
      return '<button class="opt" aria-pressed="' + (gm.id === gid) + '"' + (gm.ready && host ? '' : ' disabled') + ' data-act="game" data-k="' + gm.id + '"><span class="box">' + (gm.id === gid ? '✓' : '') + '</span><span><span class="ot">' + gm.n + (gm.ready ? '' : '（製作中）') + '</span><br><span class="od">' + gm.d + '</span></span></button>';
    }).join('') + '</div></div>';

    if (isOw) { h += owCfgCard(cfg, chk, host); } else {
    /* 角色設定 */
    const sl = chk.slots;
    const slotChip = function (label, o) { return '<span class="chip ' + (o.used > o.max ? 'evil' : '') + '">' + label + ' ' + o.used + '/' + o.max + '</span>'; };
    let c = '<div class="card"><div class="row"><h3>阿瓦隆角色</h3><div class="slots">' + slotChip('好人名額', sl.good) + slotChip('壞人名額', sl.evil) + '</div></div>';
    if (host) {
      c += '<div class="seg" role="group" aria-label="預設組合"><button data-act="preset" data-v="teach">教學局</button><button data-act="preset" data-v="classic">經典局</button><button data-act="preset" data-v="full">完整局</button></div>' +
        '<p class="muted small">教學局：梅林、刺客、忠臣（其餘壞人是爪牙）。經典局再加派西維爾、莫甘娜。完整局再加莫德雷德、奧伯倫（名額夠才加）。</p>';
      c += '<div class="opts">' + optBtn('togcfg', 'pure', '終極梅林', '梅林改成看得到壞人的具體角色', cfg.pure) + '</div>';
      c += '<h3>好人角色</h3><div class="opts">' + AV.OPT_GOOD.map(function (k) { return optBtn('tog', k, OPT_LABEL[k][0], OPT_LABEL[k][1], cfg.opt[k]); }).join('') + '</div>';
      c += '<h3>壞人角色（刺客固定在場）</h3><div class="opts">' + AV.OPT_EVIL.map(function (k) { return optBtn('tog', k, OPT_LABEL[k][0], OPT_LABEL[k][1], cfg.opt[k]); }).join('') + '</div>';
      c += '<h3>道具</h3><div class="opts">' + optBtn('togcfg', 'lady', '湖中仙女', '第 3、4、5 次任務前，持有者查驗一人的陣營', cfg.lady) +
        optBtn('togcfg', 'excal', '神劍', '隊長指定一位隊員持有，可在翻牌前改掉另一位隊員的牌', cfg.excal) + '</div>';
    } else {
      c += '<p class="muted small">由房主設定。</p>';
    }
    if (chk.ok) {
      const inplay = AV.rolesInPlay(chk.roles).map(function (r) { return AV.R[r.key].n + (r.count > 1 ? '×' + r.count : ''); }).join('、');
      c += '<div class="note"><b>本局會用到：</b>' + esc(inplay) + (cfg.lady ? '、湖中仙女' : '') + (cfg.excal ? '、神劍' : '') + '</div>';
    }
    chk.errors.forEach(function (e) { c += '<div class="card warn small">⚠ ' + esc(e) + '</div>'; });
    chk.warnings.forEach(function (e) { c += '<p class="muted small">提醒：' + esc(e) + '</p>'; });
    c += '</div>';
    h += c; }

    if (host) h += '<button class="btn primary" data-act="start"' + (chk.ok ? '' : ' disabled') + '>開始遊戲（' + n + ' 人）</button>';
    else h += '<div class="card"><p class="muted" style="text-align:center">等房主開始遊戲…</p></div>';
    h += '<button class="link" data-act="leave">離開房間</button>';
    return h;
  }

  /* ---------- 遊戲 ---------- */
  function gameView() {
    const s = g();
    if (!s) return '';
    if (S.room.gameId === 'onuw') return owView(s);
    if (S.tab === 'me') return meTab(s);
    if (S.tab === 'log') return logTab(s);
    return gameTab(s);
  }

  function track(s) {
    let h = '<div class="track">';
    for (let i = 0; i < 5; i++) {
      const e = s.hist[i]; let cls = '', txt = String(AV.teamSizeFor(s.n, i));
      if (e) {
        if (e.hidden && !s.over) { cls = 'hid'; txt = '?'; } else { cls = e.real === 'S' ? 'ok' : 'bad'; txt = e.real === 'S' ? '成功' : '失敗'; }
      } else if (i === s.q && !s.over) cls = 'cur';
      const sub = (e ? '' : AV.teamSizeFor(s.n, i) + ' 人') + (i === 3 && s.n >= 7 ? (e ? '' : '<br>') + '需2張敗' : '');
      h += '<div class="qc"><div class="qt ' + cls + '" aria-label="第' + (i + 1) + '次任務">' + txt + '</div><div class="qs">' + sub + '</div></div>';
    }
    return h + '</div>';
  }
  function pips(s) {
    let h = '<div class="pips" aria-label="連續否決 ' + s.rejects + ' 次，滿 5 次壞人獲勝">';
    for (let i = 0; i < 5; i++) h += '<span class="pip' + (i < s.rejects ? ' on' : '') + '"></span>';
    return h + '</div>';
  }
  function roster(s) {
    const L = AV.leaderId(s);
    return '<ul class="plist">' + s.order.map(function (id, i) {
      let ch = '';
      if (id === L && s.phase !== 'over') ch += '<span class="chip acc">隊長</span>';
      if (s.team.indexOf(id) >= 0 && ['vote', 'voteres', 'quest', 'pre', 'wcheck'].indexOf(s.phase) >= 0) ch += '<span class="chip">隊員</span>';
      if (s.excal === id && s.team.length && ['vote', 'voteres', 'quest', 'pre', 'wcheck'].indexOf(s.phase) >= 0) ch += '<span class="chip warn">神劍</span>';
      if (s.lady && s.lady.holder === id && s.phase !== 'over') ch += '<span class="chip warn">湖中仙女</span>';
      if (s.revealed === id) ch += '<span class="chip evil">被揭示者·壞人</span>';
      if (s.phase === 'vote' && id in s.votes) ch += '<span class="chip good">已投票</span>';
      if (s.phase === 'quest' && s.team.indexOf(id) >= 0 && s.cards[id]) ch += '<span class="chip good">已出牌</span>';
      return '<li class="' + (id === me() ? 'me' : '') + '"><span class="no">' + (i + 1) + '</span><span class="nm">' + nm(id) + '</span>' + ch + '</li>';
    }).join('') + '</ul>';
  }
  function cd(at) { return '<span class="cd" data-at="' + at + '"></span>'; }
  function pgrid(ids, pick, disabledFn, subFn) {
    return '<div class="pgrid">' + ids.map(function (id) {
      const on = pick(id), dis = disabledFn && disabledFn(id);
      return '<button class="pl' + (on ? ' sel' : '') + (id === me() ? ' me' : '') + '" data-act="pickp" data-id="' + id + '" aria-pressed="' + (!!on) + '"' + (dis ? ' disabled' : '') + '><span class="pn">' + nm(id) + (id === me() ? '（你）' : '') + '</span><span class="ps">' + (subFn ? subFn(id) : '座位 ' + seat(id)) + '</span></button>';
    }).join('') + '</div>';
  }

  function gameTab(s) {
    const id = me(), L = AV.leaderId(s), tl = AV.tally(s);
    let h = '<div class="card"><div class="row"><h2>' + (s.over ? '遊戲結束' : '第 ' + (s.q + 1) + ' 次任務') + '</h2>' + pips(s) + '</div>' + track(s) +
      '<div class="muted small">好人 ' + tl.succ + ' 勝 · 壞人 ' + tl.fail + ' 勝' + (s.hist.some(function (e) { return e.hidden; }) && !s.over ? '（含被隱藏的結果）' : '') + ' · 連續否決 ' + s.rejects + ' / 5</div></div>';
    const st = sel();
    const lan = s.lanLog.length && s.lanLog[s.lanLog.length - 1].q === s.q ? s.lanLog[s.lanLog.length - 1] : null;
    if (lan && ['team', 'vote', 'voteres'].indexOf(s.phase) >= 0 && s.rejects === 0 && s.phase === 'team') {
      h += '<div class="note">本次任務前翻出蘭斯洛特忠誠卡：<b>' + (lan.c === 'S' ? '交換陣營！' : '空白，沒有變化') + '</b></div>';
    }

    switch (s.phase) {
      case 'team': {
        const size = AV.teamSize(s);
        if (id === L) {
          h += '<div class="card accent"><h2>你是隊長：選 ' + size + ' 位隊員</h2><p class="muted small">可以選自己。已選 ' + st.team.length + ' / ' + size + '</p>' +
            pgrid(s.order, function (x) { return st.team.indexOf(x) >= 0; }) ;
          if (s.cfg.excal) {
            const cand = st.team.filter(function (x) { return x !== id; });
            h += '<h3>神劍交給誰？（不能給自己）</h3>' + (cand.length ? '<div class="pgrid">' + cand.map(function (x) {
              return '<button class="pl' + (st.excal === x ? ' sel' : '') + '" data-act="excalto" data-id="' + x + '" aria-pressed="' + (st.excal === x) + '"><span class="pn">' + nm(x) + '</span></button>';
            }).join('') + '</div>' : '<p class="muted small">先選好隊員，再指定神劍持有者。</p>');
          }
          const ready = st.team.length === size && (!s.cfg.excal || (st.excal && st.team.indexOf(st.excal) >= 0));
          h += '<button class="btn primary" data-act="propose"' + (ready ? '' : ' disabled') + '>提出隊伍，開始投票</button></div>';
        } else {
          h += '<div class="card"><h2>等 ' + tx(L) + ' 選隊員</h2><p class="muted">這次任務要 ' + size + ' 人。趁現在討論吧。</p></div>';
        }
        break;
      }
      case 'vote': {
        const voted = id in s.votes;
        h += '<div class="card accent"><h2>表決這支隊伍</h2><p>隊長 ' + tx(L) + '</p><p>隊員：' + names(s.team) + '</p>' +
          (s.excal ? '<p>神劍持有者：' + tx(s.excal) + '</p>' : '');
        if (!voted) h += '<div class="btnrow"><button class="btn yes" data-act="vote" data-v="1">贊成</button><button class="btn no" data-act="vote" data-v="0">反對</button></div>';
        else h += '<div class="banner">你已投票。等其他人（' + Object.keys(s.votes).length + ' / ' + s.n + '）</div>';
        const wait = s.order.filter(function (x) { return !(x in s.votes); });
        if (wait.length) h += '<p class="muted small">還沒投：' + names(wait) + '</p>';
        h += '</div>';
        break;
      }
      case 'voteres': {
        const v = s.lastVote;
        h += '<div class="card ' + (v.approve ? 'good' : 'evil') + '"><h2>' + (v.approve ? '隊伍通過' : '隊伍被否決') + '</h2><p>贊成 ' + v.yes + ' · 反對 ' + v.no + '</p>' +
          '<p>贊成：' + names(s.order.filter(function (x) { return s.votes[x]; })) + '</p><p>反對：' + names(s.order.filter(function (x) { return !s.votes[x]; })) + '</p>' +
          (!v.approve ? '<p class="small">這是連續第 ' + (s.rejects + 1) + ' 次否決' + (s.rejects + 1 >= 5 ? '，壞人將直接獲勝。' : '。') + '</p>' : '') +
          '<button class="btn primary" data-act="next">' + (v.approve ? '開始任務' : (s.rejects + 1 >= 5 ? '看結果' : '換下一位隊長')) + '</button></div>';
        break;
      }
      case 'quest': {
        const inTeam = s.team.indexOf(id) >= 0;
        if (inTeam && !s.cards[id]) {
          const ok = AV.allowedCards(s, id), why = AV.forcedWhy(s, id);
          h += '<div class="card accent"><h2>你在任務隊伍裡：出一張牌</h2>' + (why ? '<p class="muted">' + esc(why) + '</p>' : '') +
            '<div class="btnrow">' + (ok.indexOf('S') >= 0 ? '<button class="btn yes" data-act="card" data-c="S">成功</button>' : '') + (ok.indexOf('F') >= 0 ? '<button class="btn no" data-act="card" data-c="F">失敗</button>' : '') + '</div></div>';
        } else if (inTeam) {
          h += '<div class="card"><h2>你已出牌</h2><p class="muted">等其他隊員（' + Object.keys(s.cards).length + ' / ' + s.team.length + '）</p></div>';
        } else {
          h += '<div class="card"><h2>任務進行中</h2><p class="muted">隊員 ' + names(s.team) + ' 正在出牌（' + Object.keys(s.cards).length + ' / ' + s.team.length + '）。</p></div>';
        }
        break;
      }
      case 'pre': {
        let any = false;
        if (id === s.excal && !s.pre.excalDone) {
          any = true;
          const cand = s.team.filter(function (x) { return x !== id; });
          h += '<div class="card accent"><h2>神劍：要改誰的牌？</h2><p class="muted small">被改的人手上的牌會翻成相反（成功↔失敗），他本人會知道。也可以不使用。倒數 ' + cd(s.t0 + AV.PRE_MS) + '</p>' +
            pgrid(cand, function (x) { return st.target === x; }) +
            '<div class="btnrow"><button class="btn primary" data-act="excalgo"' + (st.target ? '' : ' disabled') + '>使用神劍</button><button class="btn" data-act="excalpass">不使用</button></div></div>';
        }
        if (id === s.witchId && !s.pre.witchDone) {
          any = true;
          h += '<div class="card accent"><h2>巫婆：要隱藏這次任務結果嗎？</h2><p class="muted small">整局只能用一次。隱藏後，系統會隨機選一位玩家（不是你）去查驗某人的陣營。倒數 ' + cd(s.t0 + AV.PRE_MS) + '</p>' +
            '<div class="btnrow"><button class="btn no" data-act="witch" data-v="1">隱藏結果</button><button class="btn" data-act="witch" data-v="0">不隱藏</button></div></div>';
        }
        if (!any) h += '<div class="card"><h2>翻牌前的特殊行動時間</h2><p class="muted">有人可能正在行動，請稍候。' + cd(s.t0 + AV.PRE_MS) + '</p></div>';
        break;
      }
      case 'wcheck': {
        if (id === s.wc.checker) {
          const cand = s.order.filter(function (x) { return x !== id; });
          h += '<div class="card accent"><h2>你被選為查驗者</h2><p class="muted small">可以查驗任何一人的陣營（只有你看得到結果），也可以放棄。倒數 ' + cd(s.t0 + AV.WC_MS) + '</p>' +
            pgrid(cand, function (x) { return st.target === x; }) +
            '<div class="btnrow"><button class="btn primary" data-act="wchk"' + (st.target ? '' : ' disabled') + '>查驗</button><button class="btn" data-act="wskip">放棄</button></div></div>';
        } else {
          h += '<div class="card"><h2>任務結果被隱藏了</h2><p class="muted">' + tx(s.wc.checker) + ' 被選為查驗者，正在決定要不要查驗。' + cd(s.t0 + AV.WC_MS) + '</p></div>';
        }
        break;
      }
      case 'qres': {
        const e = s.hist[s.hist.length - 1];
        if (e.hidden) h += '<div class="card warn"><h2>任務結果被巫婆隱藏</h2><p>失敗張數不公開。</p>';
        else h += '<div class="card ' + (e.real === 'S' ? 'good' : 'evil') + '"><h2>任務' + (e.real === 'S' ? '成功' : '失敗') + '</h2><p>隊員 ' + names(e.team) + '</p><p>失敗票 ' + e.fails + ' 張' + (e.need > 1 ? '（本次需要 ' + e.need + ' 張才算失敗）' : '') + '</p>';
        if (e.flip) h += '<p class="small">神劍使用過：' + tx(e.flip.by) + ' 改了一位隊員的牌。</p>';
        if (s.revealed && s.feed.some(function (f) { return f.type === 'reveal' && f.id === s.revealed; }) && s.hist.filter(function (x) { return !x.hidden && x.real === 'F'; }).length === 2 && !e.hidden && e.real === 'F') {
          h += '<p class="small"><b>' + nm(s.revealed) + '</b> 是被揭示者（壞人）。</p>';
        }
        h += '<button class="btn primary" data-act="next">下一輪</button></div>';
        break;
      }
      case 'lady': {
        if (id === s.lady.holder) {
          const cand = s.order.filter(function (x) { return s.lady.held.indexOf(x) < 0; });
          h += '<div class="card accent"><h2>湖中仙女：查驗一個人</h2><p class="muted small">只有你看得到他顯示的陣營，之後湖中仙女會傳給他。倒數 ' + cd(s.t0 + AV.LADY_MS) + '</p>' +
            pgrid(cand, function (x) { return st.target === x; }) +
            '<button class="btn primary" data-act="ladygo"' + (st.target ? '' : ' disabled') + '>查驗</button></div>';
        } else {
          h += '<div class="card"><h2>湖中仙女</h2><p class="muted">' + tx(s.lady.holder) + ' 正在查驗一個人。' + cd(s.t0 + AV.LADY_MS) + '</p></div>';
        }
        break;
      }
      case 'assassin': {
        const asn = s.roles[id] === 'assassin';
        if (asn) {
          const modes = AV.killModes(s); if (!st.mode) st.mode = modes[0];
          const lab = { merlin: '刺殺梅林', lovers: '指認特里斯坦＋伊索德', guinevere: '指認女皇', cleric: '指認牧師' };
          const need = st.mode === 'lovers' ? 2 : 1;
          h += '<div class="card evil"><h2>好人拿下三次成功了——輪到刺客</h2>' +
            (modes.length > 1 ? '<div class="seg" role="group">' + modes.map(function (m) { return '<button data-act="mode" data-v="' + m + '" aria-pressed="' + (st.mode === m) + '">' + lab[m] + '</button>'; }).join('') + '</div>' : '<p>' + lab[modes[0]] + '</p>') +
            '<p class="muted small">選 ' + need + ' 人。已選 ' + st.targets.length + ' / ' + need + '</p>' +
            pgrid(s.order, function (x) { return st.targets.indexOf(x) >= 0; }) +
            '<button class="btn primary" data-act="kill"' + (st.targets.length === need ? '' : ' disabled') + '>確認指認</button></div>';
        } else {
          h += '<div class="card"><h2>好人拿下三次成功</h2><p class="muted">刺客正在決定刺殺對象。壞人還有機會翻盤！</p></div>';
        }
        break;
      }
      case 'assassin2': {
        const asn = s.roles[id] === 'assassin';
        if (asn) {
          const cands = AV.clericCandidates(s);
          h += '<div class="card evil"><h2>牧師被認出來了！</h2><p class="muted small">再指認一位好人與他的角色。</p><h3>角色</h3><div class="seg" style="flex-wrap:wrap">' + cands.map(function (k) {
            return '<button data-act="role" data-v="' + k + '" aria-pressed="' + (st.role === k) + '">' + AV.R[k].n + '</button>';
          }).join('') + '</div><h3>是誰</h3>' + pgrid(s.order, function (x) { return st.target === x; }) +
            '<button class="btn primary" data-act="kill2"' + (st.role && st.target ? '' : ' disabled') + '>確認</button></div>';
        } else {
          h += '<div class="card"><h2>刺客認出牧師了</h2><p class="muted">他還需要猜中第二個目標。</p></div>';
        }
        break;
      }
      case 'over': h += overView(s); break;
      default: break;
    }
    if (s.phase !== 'over') h += '<div class="card"><h3>玩家</h3>' + roster(s) + '</div>';
    return h;
  }

  function overView(s) {
    const o = s.over, win = o.winner;
    let h = '<div class="banner ' + win + '" role="status"><div style="font-size:24px">' + (win === 'good' ? '好人獲勝' : '壞人獲勝') + '</div><div>' + esc(o.why) + '</div></div>';
    if (o.kill) {
      h += '<div class="note">刺客指認：' + names(o.kill.targets) + (o.kill.role ? '（猜他是' + AV.R[o.kill.role].n + '）' : '') + '</div>';
    }
    h += '<div class="card"><h3>所有人的角色</h3><ul class="plist">' + s.order.map(function (id, i) {
      const k = s.roles[id], al = AV.align(s, id);
      const lan = (k === 'lancelot_good' || k === 'lancelot_evil') ? '<span class="chip">最後陣營：' + alignWord(al) + '</span>' : '';
      return '<li class="' + (id === me() ? 'me' : '') + '"><span class="no">' + (i + 1) + '</span><span class="nm">' + nm(id) + '</span><b>' + AV.R[k].n + '</b>' + sideChip(AV.R[k].side) + lan + '</li>';
    }).join('') + '</ul></div>';
    h += '<button class="btn primary" data-act="again">再玩一局（回到大廳）</button>';
    return h;
  }

  /* 我的身分 */
  function noteText(n) {
    switch (n.type) {
      case 'lanAlign': return '你現在的陣營：<b>' + alignWord(n.align) + '</b>（' + (n.flipped ? '已經交換過' : '還沒交換') + '）。目前是壞人必須出失敗，是好人必須出成功。';
      case 'clericSelf': return '你是第 1 次任務的隊長，沒有資訊。';
      case 'cleric': return '第 1 次任務的隊長 ' + tx(n.target) + ' 顯示為 <b>' + alignWord(n.shown) + '</b>。';
      case 'lady': return '湖中仙女（第 ' + (n.q + 1) + ' 次任務前）：' + tx(n.target) + ' 顯示為 <b>' + alignWord(n.shown) + '</b>。';
      case 'wcheck': return '查驗（第 ' + (n.q + 1) + ' 次任務）：' + tx(n.target) + ' 顯示為 <b>' + alignWord(n.shown) + '</b>。';
      case 'wcheckNone': return '第 ' + (n.q + 1) + ' 次任務你沒有查驗任何人。';
      case 'excal': return n.mine === 'holder' ? '第 ' + (n.q + 1) + ' 次任務：你用神劍把 ' + tx(n.target) + ' 的牌改成了「' + (n.to === 'S' ? '成功' : '失敗') + '」。'
        : '第 ' + (n.q + 1) + ' 次任務：神劍持有者 ' + tx(n.by) + ' 把你的牌改成了「' + (n.to === 'S' ? '成功' : '失敗') + '」。';
      default: return '';
    }
  }
  function meTab(s) {
    const id = me(); const inf = AV.info(s, id), R = AV.R[inf.role];
    let open = '<div class="rname ' + inf.side + '">' + R.n + '</div><div>' + sideChip(inf.side) + '</div><p>' + esc(R.d) + '</p>';
    inf.groups.forEach(function (gr) {
      open += '<div class="glist"><div class="gt">' + esc(gr.title) + '</div>';
      if (gr.items) open += gr.items.length ? gr.items.map(function (it) { return '<div class="note">' + tx(it.id) + ' — ' + esc(it.label) + '</div>'; }).join('') : '<div class="note">（沒有）</div>';
      else open += gr.ids.length ? '<div class="wrap">' + gr.ids.map(function (x) { return '<span class="chip">' + nm(x) + '</span>'; }).join('') + '</div>' : '<div class="note">（沒有）</div>';
      open += '</div>';
    });
    if (inf.notes.length) open += '<div class="notes">' + inf.notes.map(function (n) { return '<div class="note">' + noteText(n) + '</div>'; }).join('') + '</div>';
    if (!inf.groups.length && !inf.notes.length) open += '<div class="note">你沒有任何開局資訊，靠觀察與推理吧。</div>';
    const inplay = AV.rolesInPlay(Object.keys(s.roles).map(function (i) { return s.roles[i]; })).map(function (r) { return AV.R[r.key].n + (r.count > 1 ? '×' + r.count : ''); }).join('、');
    return '<div class="stack"><h2>我的身分</h2>' +
      '<div class="reveal" data-hold="1" tabindex="0" role="button" aria-label="按住查看身分"><div class="shut"><div class="hint">按住查看身分</div><div class="muted small">放開就會蓋住，旁邊的人看不到</div></div><div class="open">' + open + '</div></div>' +
      '<div class="card"><h3>本局角色</h3><p class="small">' + esc(inplay) + '</p></div></div>';
  }

  /* 紀錄 */
  function feedText(f) {
    switch (f.type) {
      case 'whide': return '第 ' + (f.q + 1) + ' 次任務的結果被隱藏，' + tx(f.checker) + ' 被選為查驗者。';
      case 'reveal': return tx(f.id) + ' 是被揭示者（壞人）。';
      case 'excal': return '第 ' + (f.q + 1) + ' 次任務：' + tx(f.by) + ' 用神劍改了 ' + tx(f.target) + ' 的牌。';
      case 'excalPass': return '第 ' + (f.q + 1) + ' 次任務：' + tx(f.by) + ' 沒有使用神劍。';
      case 'wcheck': return tx(f.by) + ' 查驗了 ' + tx(f.target) + '（結果只有他知道）。';
      case 'wcheckNone': return tx(f.by) + ' 沒有查驗任何人。';
      case 'lady': return '第 ' + (f.q + 1) + ' 次任務前：' + tx(f.by) + ' 用湖中仙女查驗了 ' + tx(f.target) + '（結果只有他知道）。';
      case 'ladySkip': return '第 ' + (f.q + 1) + ' 次任務前：湖中仙女超時，略過。';
      case 'clericHit': return '刺客認出了牧師，還要猜第二個目標。';
      default: return '';
    }
  }
  function logTab(s) {
    let h = '<div class="stack"><h2>紀錄</h2>';
    h += '<div class="card"><h3>任務</h3><div class="hist">' + (s.hist.length ? s.hist.map(function (e) {
      const res = e.hidden && !s.over ? '結果被隱藏' : (e.real === 'S' ? '成功' : '失敗') + '（失敗票 ' + e.fails + '）';
      return '<div class="hrow"><b>第 ' + (e.q + 1) + ' 次</b> · 隊長 ' + nm(e.leader) + '<br>隊員 ' + names(e.team) + (e.excal ? '（神劍：' + nm(e.excal) + '）' : '') + '<br>' + res + '</div>';
    }).join('') : '<span class="muted">還沒有完成的任務</span>') + '</div></div>';
    h += '<div class="card"><h3>投票</h3><div class="hist">' + (s.voteHist.length ? s.voteHist.slice().reverse().map(function (v) {
      return '<div class="hrow"><b>第 ' + (v.q + 1) + ' 次</b> · 隊長 ' + nm(v.leader) + ' · ' + (v.approve ? '通過' : '否決') + '<br>隊員 ' + names(v.team) + '<br>' +
        '贊成：' + names(s.order.filter(function (x) { return v.votes[x]; })) + '<br>反對：' + names(s.order.filter(function (x) { return !v.votes[x]; })) + '</div>';
    }).join('') : '<span class="muted">還沒有投票</span>') + '</div></div>';
    const ev = s.feed.map(feedText).filter(Boolean);
    const lan = s.lanLog.map(function (l) { return '第 ' + (l.q + 1) + ' 次任務前翻出忠誠卡：' + (l.c === 'S' ? '<b>交換陣營</b>' : '空白'); });
    if (ev.length || lan.length) h += '<div class="card"><h3>事件</h3><div class="hist">' + lan.concat(ev).map(function (t) { return '<div class="hrow">' + t + '</div>'; }).join('') + '</div></div>';
    h += '<button class="link" data-act="leave">離開這個房間</button></div>';
    return h;
  }


  /* ---------- 一夜終極狼人 ---------- */
  function cfgOw() {
    const c = Object.assign(OW.defaultCfg(), Core.clone(S.room.cfg.onuw || {}));
    c.roles = c.roles || {}; return c;
  }
  function setCfgOw(mut) { const c = Core.clone(cfgOw()); mut(c); send('cfg', { gameId: 'onuw', cfg: c }); }
  function owPreset(c, v, n) {
    c.roles = { werewolf: 2 };
    const steps = ['seer', 'robber', 'troublemaker'];
    if (v !== 'new') steps.push('drunk', 'insomniac');
    if (v === 'full') steps.push('minion', 'hunter', 'tanner', 'mason');
    steps.forEach(function (k) {
      c.roles[k] = k === 'mason' ? 2 : 1;
      if (!OW.check(c, n).ok) delete c.roles[k];
    });
  }
  function owCfgCard(cfg, chk, host) {
    const rc = cfg.roles, sl = chk.slots;
    let c = '<div class="card"><div class="row"><h3>一夜狼人角色</h3><span class="chip ' + (sl.used > sl.max ? 'evil' : '') + '">角色牌 ' + sl.used + '/' + sl.max + '</span></div>';
    if (host) {
      c += '<div class="seg" role="group" aria-label="預設組合"><button data-act="owpreset" data-v="new">新手局</button><button data-act="owpreset" data-v="std">標準局</button><button data-act="owpreset" data-v="full">完整局</button></div>' +
        '<p class="muted small">新手局：狼人、預言家、強盜、搗蛋鬼。標準局再加酒鬼、失眠者。完整局再加爪牙、獵人、皮革匠、守夜人（牌數夠才加）。其餘補村民。</p>';
      c += '<h3>狼人張數</h3><div class="seg" role="group">' + [0, 1, 2, 3].map(function (v) { return '<button data-act="owwolf" data-v="' + v + '" aria-pressed="' + ((rc.werewolf || 0) === v) + '">' + v + '</button>'; }).join('') + '</div>';
      c += '<h3>其他角色</h3><div class="opts">' + OW.OPTIONAL.map(function (k) {
        return optBtn('owtog', k, OW.R[k].n + (k === 'mason' ? '（2 張）' : ''), OW.R[k].d, !!rc[k]);
      }).join('') + '</div>';
      c += '<h3>白天討論時間</h3><div class="seg" role="group">' + OW.MINUTES.map(function (m) { return '<button data-act="owmin" data-v="' + m + '" aria-pressed="' + (cfg.minutes === m) + '">' + m + ' 分鐘</button>'; }).join('') + '</div>';
    } else c += '<p class="muted small">由房主設定。</p>';
    if (chk.ok) {
      const inplay = OW.rolesInPlay(chk.roles).map(function (r) { return OW.R[r.key].n + (r.count > 1 ? '×' + r.count : ''); }).join('、');
      c += '<div class="note"><b>本局的牌（玩家 + 3 張中間牌）：</b>' + esc(inplay) + '</div>';
    }
    chk.errors.forEach(function (e) { c += '<div class="card warn small">⚠ ' + esc(e) + '</div>'; });
    chk.warnings.forEach(function (e) { c += '<p class="muted small">提醒：' + esc(e) + '</p>'; });
    return c + '</div>';
  }
  function owRn(k) { return '<b>' + OW.R[k].n + '</b>'; }
  function owNote(n) {
    switch (n.type) {
      case 'loneWolf': return '你是唯一的狼人，夜晚可以偷看一張中間牌。';
      case 'noWolf': return '沒有玩家是狼人（狼人牌在中間）。';
      case 'peek': return '你偷看了中間第 ' + (n.idx + 1) + ' 張牌：' + owRn(n.role) + '。';
      case 'seerP': return '你看了 ' + tx(n.target) + ' 的牌：' + owRn(n.role) + '。';
      case 'seerC': return '你看了中間第 ' + (n.idx[0] + 1) + '、' + (n.idx[1] + 1) + ' 張牌：' + owRn(n.roles[0]) + '、' + owRn(n.roles[1]) + '。';
      case 'robber': return '你和 ' + tx(n.target) + ' 交換了牌，你現在的牌是：' + owRn(n.role) + '（' + OW.TEAM_NAME[OW.R[n.role].team] + '）。';
      case 'robberNone': return '你沒有交換任何人。';
      case 'tm': return '你交換了 ' + tx(n.a) + ' 和 ' + tx(n.b) + ' 的牌。';
      case 'tmNone': return '你沒有交換任何人。';
      case 'drunk': return '你和中間第 ' + (n.idx + 1) + ' 張牌交換了（沒有看）。你現在不確定自己是什麼。';
      case 'insomniac': return '你現在的牌是：' + owRn(n.role) + '（' + OW.TEAM_NAME[OW.R[n.role].team] + '）。';
      default: return '';
    }
  }
  function teamCls(t) { return t === 'werewolf' ? 'evil' : t === 'village' ? 'good' : 'warn'; }
  function owMeCard(s) {
    const id = me(), inf = OW.info(s, id), R = OW.R[inf.role];
    let open = '<div class="rname ' + (inf.team === 'tanner' ? '' : teamCls(inf.team)) + '">' + R.n + '</div><div><span class="chip ' + teamCls(inf.team) + '">' + OW.TEAM_NAME[inf.team] + '</span></div><p>' + esc(R.d) + '</p>';
    inf.groups.forEach(function (gr) {
      open += '<div class="glist"><div class="gt">' + esc(gr.title) + '</div>' + (gr.ids.length ? '<div class="wrap">' + gr.ids.map(function (x) { return '<span class="chip">' + nm(x) + '</span>'; }).join('') + '</div>' : '<div class="note">（沒有）</div>') + '</div>';
    });
    if (inf.notes.length) open += '<div class="notes">' + inf.notes.map(function (n) { return '<div class="note">' + owNote(n) + '</div>'; }).join('') + '</div>';
    if (s.phase !== 'night' && inf.role !== 'insomniac' && s.res[id] && s.res[id].length === 0 && !inf.groups.length && !inf.notes.length) open += '<div class="note">你的角色夜晚沒有資訊。</div>';
    return '<div class="reveal" data-hold="1" tabindex="0" role="button" aria-label="按住查看身分與夜晚資訊"><div class="shut"><div class="hint">按住查看身分與夜晚資訊</div><div class="muted small">放開就會蓋住</div></div><div class="open">' + open + '</div></div>';
  }
  function centerGrid(isOn) {
    return '<div class="pgrid">' + [0, 1, 2].map(function (i) {
      return '<button class="pl' + (isOn(i) ? ' sel' : '') + '" data-act="pickc" data-i="' + i + '" aria-pressed="' + (!!isOn(i)) + '"><span class="pn">中間第 ' + (i + 1) + ' 張</span></button>';
    }).join('') + '</div>';
  }
  function owPick(id, s, st) {
    if (s.phase === 'night') {
      const kind = OW.nightKind(s, me());
      if (kind === 'tm') toggleLim(st.targets, id, 2); else st.target = id;
    } else st.target = id;
  }
  function owOthers(s) { return s.order.filter(function (x) { return x !== me(); }); }
  function owNightPanel(s) {
    const id = me(), kind = OW.nightKind(s, id), st = sel();
    if (id in s.acts) return '<div class="banner">你已完成。等其他人（' + Object.keys(s.acts).length + ' / ' + s.n + '）</div>';
    const ok = function (txt, dis, act) { return '<button class="btn primary" data-act="' + act + '"' + (dis ? ' disabled' : '') + '>' + txt + '</button>'; };
    let h = '<div class="card accent">';
    switch (kind) {
      case 'none': h += '<h2>夜晚</h2><p class="muted">看完上面的資訊後按確認。每個人都要按，這樣別人看不出誰有行動。</p>' + ok('我知道了', false, 'n_ok'); break;
      case 'peek': h += '<h2>你是唯一的狼人</h2><p class="muted small">可以偷看一張中間牌，也可以不看。</p>' + centerGrid(function (i) { return st.target === i; }) +
        '<div class="btnrow">' + ok('偷看', st.target == null, 'n_peek') + '<button class="btn" data-act="n_ok">不看</button></div>'; break;
      case 'seer': {
        if (!st.mode) st.mode = 'p';
        h += '<h2>預言家</h2><div class="seg" role="group"><button data-act="owmode" data-v="p" aria-pressed="' + (st.mode === 'p') + '">看一位玩家</button><button data-act="owmode" data-v="c" aria-pressed="' + (st.mode === 'c') + '">看兩張中間牌</button></div>';
        if (st.mode === 'p') h += pgrid(owOthers(s), function (x) { return st.target === x; }) + ok('查看', !st.target, 'n_seer');
        else h += '<p class="muted small">已選 ' + st.targets.length + ' / 2</p>' + centerGrid(function (i) { return st.targets.indexOf(i) >= 0; }) + ok('查看', st.targets.length !== 2, 'n_seer');
        break;
      }
      case 'robber': h += '<h2>強盜</h2><p class="muted small">選一位玩家交換牌（你會看到新牌），也可以不交換。</p>' + pgrid(owOthers(s), function (x) { return st.target === x; }) +
        '<div class="btnrow">' + ok('交換', !st.target, 'n_rob') + '<button class="btn" data-act="n_ok">不交換</button></div>'; break;
      case 'tm': h += '<h2>搗蛋鬼</h2><p class="muted small">選兩位其他玩家，交換他們的牌（不能看）。也可以不交換。已選 ' + st.targets.length + ' / 2</p>' + pgrid(owOthers(s), function (x) { return st.targets.indexOf(x) >= 0; }) +
        '<div class="btnrow">' + ok('交換', st.targets.length !== 2, 'n_tm') + '<button class="btn" data-act="n_ok">不交換</button></div>'; break;
      case 'drunk': h += '<h2>酒鬼</h2><p class="muted small">必須和一張中間牌交換，而且不能看新牌。</p>' + centerGrid(function (i) { return st.target === i; }) + ok('交換', st.target == null, 'n_drunk'); break;
      default: break;
    }
    return h + '</div>';
  }
  function owRolesInPlay(s) {
    const all = Object.keys(s.roles).map(function (i) { return s.roles[i]; }).concat(s.center);
    return OW.rolesInPlay(all);
  }
  function owView(s) {
    if (S.tab === 'me') return '<div class="stack"><h2>我的身分</h2>' + owMeCard(s) + '</div>';
    if (S.tab === 'log') {
      return '<div class="stack"><h2>說明</h2><div class="card"><h3>本局的牌</h3><div class="hist">' + owRolesInPlay(s).map(function (r) {
        return '<div class="hrow"><b>' + OW.R[r.key].n + (r.count > 1 ? ' ×' + r.count : '') + '</b><br>' + esc(OW.R[r.key].d) + '</div>';
      }).join('') + '</div></div><div class="card"><h3>流程</h3><div class="hist"><div class="hrow">夜晚：每人用手機完成行動，結算順序固定（狼人→爪牙→守夜人→預言家→強盜→搗蛋鬼→酒鬼→失眠者）。</div><div class="hrow">白天：自由討論，過半數人按「開始投票」或時間到就投票。</div><div class="hrow">投票：得票最多的人死亡，平票全死；沒有人超過 1 票就沒人死。</div></div></div><button class="link" data-act="leave">離開這個房間</button></div>';
    }
    const st = sel(); const id = me();
    let h = '';
    if (s.phase === 'night') {
      h += '<div class="card"><div class="row"><h2>夜晚</h2><span class="muted small">' + Object.keys(s.acts).length + ' / ' + s.n + ' 完成</span></div><p class="muted small">所有人閉上眼睛，各自在手機上完成行動。</p></div>' + owMeCard(s) + owNightPanel(s);
    } else if (s.phase === 'day') {
      const need = Math.floor(s.n / 2) + 1;
      h += '<div class="card"><div class="row"><h2>白天討論</h2><span class="cd" style="font-size:22px">' + cd(s.t0 + s.cfg.minutes * 60000) + '</span></div><p class="muted small">自由討論。想提早投票的人按下按鈕，達到 ' + need + ' 人或時間到就開始投票。</p>' +
        '<button class="btn primary" data-act="owcall"' + (s.calls.indexOf(id) >= 0 ? ' disabled' : '') + '>' + (s.calls.indexOf(id) >= 0 ? '已提議投票' : '我想開始投票') + '（' + s.calls.length + ' / ' + need + '）</button></div>' + owMeCard(s) +
        '<div class="card"><h3>本局的牌</h3><p class="small">' + esc(owRolesInPlay(s).map(function (r) { return OW.R[r.key].n + (r.count > 1 ? '×' + r.count : ''); }).join('、')) + '（另有 3 張在中間）</p></div>';
    } else if (s.phase === 'vote') {
      const voted = id in s.votes;
      h += '<div class="card accent"><h2>投票</h2><p class="muted small">選一個你想處決的人。同時投票，得票最多的人死亡。</p>';
      if (!voted) h += pgrid(owOthers(s), function (x) { return st.target === x; }) + '<button class="btn primary" data-act="owvote"' + (st.target ? '' : ' disabled') + '>投給他</button>';
      else h += '<div class="banner">你已投票。等其他人（' + Object.keys(s.votes).length + ' / ' + s.n + '）</div>';
      const wait = s.order.filter(function (x) { return !(x in s.votes); });
      if (wait.length) h += '<p class="muted small">還沒投：' + names(wait) + '</p>';
      h += '</div>' + owMeCard(s);
    } else if (s.phase === 'over') h += owOver(s);
    return h;
  }
  function owOver(s) {
    const o = s.over, id = me();
    const win = OW.won(s, id);
    const wl = o.winners.map(function (t) { return OW.TEAM_NAME[t]; });
    let h = '<div class="banner ' + (win ? 'good' : 'evil') + '" role="status"><div style="font-size:24px">' + (win ? '你贏了' : '你輸了') + '</div><div>' + (wl.length ? '獲勝：' + wl.join('、') : '沒有人獲勝') + '</div></div>';
    h += '<div class="card"><h3>處決結果</h3><p>' + (o.dead.length ? '死亡：' + names(o.dead) : '沒有人死亡（沒有人得到超過 1 票）') + '</p>' +
      (o.shots.length ? '<p>獵人帶走：' + o.shots.map(function (x) { return tx(x.by) + ' → ' + tx(x.target); }).join('、') + '</p>' : '') +
      (o.noWolf ? '<p class="muted small">這局沒有玩家是狼人。</p>' : '') + '</div>';
    h += '<div class="card"><h3>所有人的牌</h3><ul class="plist">' + s.order.map(function (x, i) {
      const a = s.roles[x], b = s.final[x];
      return '<li class="' + (x === id ? 'me' : '') + '"><span class="no">' + (i + 1) + '</span><span class="nm">' + nm(x) + '<br><span class="muted tiny">投給 ' + nm(s.votes[x]) + ' · 得 ' + o.tally[x] + ' 票' + (o.dead.indexOf(x) >= 0 ? ' · 死亡' : '') + '</span></span>' +
        '<span>' + (a === b ? '<b>' + OW.R[b].n + '</b>' : OW.R[a].n + ' → <b>' + OW.R[b].n + '</b>') + '</span><span class="chip ' + (OW.won(s, x) ? 'good' : '') + '">' + (OW.won(s, x) ? '勝' : '敗') + '</span></li>';
    }).join('') + '</ul><p class="small muted">中間三張牌：' + s.center.map(function (c, i) { return s.finalCenter[i] === c ? OW.R[c].n : OW.R[c].n + ' → ' + OW.R[s.finalCenter[i]].n; }).join('、') + '</p></div>';
    h += '<button class="btn primary" data-act="again">再玩一局（回到大廳）</button>';
    return h;
  }

  /* ---------- 倒數與逾時 ---------- */
  function tickCountdowns() {
    const now = S.tp ? S.tp.now() : Date.now();
    document.querySelectorAll('[data-at]').forEach(function (el) {
      const at = +el.getAttribute('data-at'); const sec = Math.max(0, Math.ceil((at - now) / 1000));
      el.textContent = sec + ' 秒';
    });
  }
  function tickTimeout() {
    tickCountdowns();
    const room = S.room; if (!S.tp || !room.created || room.phase !== 'game' || !room.game) return;
    const s = room.game; const dl = Core.games[room.gameId].deadline(s); if (!dl) return;
    const now = S.tp.now();
    const key = s.ph;
    if (S.jitter[key] == null) S.jitter[key] = (isHost() ? 0 : 1500) + Math.random() * (isHost() ? 500 : 2500);
    if (now < dl.at + S.jitter[key]) return;
    const last = S.timeoutSent[key] || 0;
    if (Date.now() - last < 4000) return;
    S.timeoutSent[key] = Date.now();
    play(dl.k, {});
  }
  setInterval(tickTimeout, 400);

  /* ---------- 事件 ---------- */
  function toggleLim(arr, x, lim) {
    const i = arr.indexOf(x);
    if (i >= 0) arr.splice(i, 1); else if (arr.length < lim) arr.push(x);
  }
  function handle(act, el) {
    const ds = el.dataset, s = g();
    const st = s ? sel() : null;
    switch (act) {
      case 'create': createRoom(); return;
      case 'join': S.joinCode = Core.normCode((document.getElementById('jc') || {}).value || S.joinCode); joinRoom(S.joinCode); return;
      case 'sim': startSim(); return;
      case 'home': closeRoom(''); return;
      case 'copy': copyText(inviteText()); return;
      case 'tab': S.tab = ds.v; render(); window.scrollTo(0, 0); return;
      case 'leave':
        if (S.room.phase === 'lobby' && !S.sim) send('leave', {});
        closeRoom(''); return;
      case 'move': send('move', { id: ds.id, dir: +ds.dir }); return;
      case 'kick': send('kick', { id: ds.id }); return;
      case 'addbot': {
        const n = S.room.players.length; if (n >= 10) return;
        const extra = ['小華', '阿強', '小玉', '老王', '阿美', '小新'];
        S.tp.push({ k: 'join', p: 'p' + (n + 1), d: { name: extra[n % extra.length] + (n > 7 ? n : '') } }); return;
      }
      case 'game': if (isHost() && Core.games[ds.k] && Core.games[ds.k].ready) send('cfg', { gameId: ds.k }); return;
      case 'preset': setCfg(function (c) { applyPreset(c, ds.v, S.room.players.length); }); return;
      case 'tog': setCfg(function (c) { c.opt[ds.k] = !c.opt[ds.k]; if (!c.opt[ds.k]) delete c.opt[ds.k]; }); return;
      case 'togcfg': setCfg(function (c) { c[ds.k] = !c[ds.k]; }); return;
      case 'start': send('start', {}); S.tab = 'game'; return;
      case 'again': send('reset', {}); return;
      case 'pickp': {
        if (!s) return;
        if (S.room.gameId === 'onuw') { owPick(ds.id, s, st); render(); return; }
        if (s.phase === 'team') {
          toggleLim(st.team, ds.id, AV.teamSize(s));
          if (st.excal && st.team.indexOf(st.excal) < 0) st.excal = null;
        } else if (s.phase === 'assassin') {
          const need = st.mode === 'lovers' ? 2 : 1;
          if (need === 1) st.targets = [ds.id]; else toggleLim(st.targets, ds.id, 2);
        } else st.target = ds.id;
        render(); return;
      }
      case 'owpreset': setCfgOw(function (c) { owPreset(c, ds.v, S.room.players.length); }); return;
      case 'owtog': setCfgOw(function (c) { if (c.roles[ds.k]) delete c.roles[ds.k]; else c.roles[ds.k] = ds.k === 'mason' ? 2 : 1; }); return;
      case 'owwolf': setCfgOw(function (c) { if (+ds.v) c.roles.werewolf = +ds.v; else delete c.roles.werewolf; }); return;
      case 'owmin': setCfgOw(function (c) { c.minutes = +ds.v; }); return;
      case 'pickc': {
        if (OW.nightKind(s, me()) === 'seer') toggleLim(st.targets, +ds.i, 2); else st.target = +ds.i;
        render(); return;
      }
      case 'owmode': st.mode = ds.v; st.target = null; st.targets = []; render(); return;
      case 'n_ok': play('ow.night', { act: {} }); return;
      case 'n_peek': play('ow.night', { act: { peek: st.target } }); return;
      case 'n_seer': play('ow.night', { act: st.mode === 'c' ? { mode: 'c', idx: st.targets.slice().sort() } : { mode: 'p', target: st.target } }); return;
      case 'n_rob': play('ow.night', { act: { target: st.target } }); return;
      case 'n_tm': play('ow.night', { act: { a: st.targets[0], b: st.targets[1] } }); return;
      case 'n_drunk': play('ow.night', { act: { idx: st.target } }); return;
      case 'owcall': play('ow.call', {}); return;
      case 'owvote': play('ow.vote', { target: st.target }); return;
      case 'excalto': st.excal = ds.id; render(); return;
      case 'propose': {
        const d = { team: st.team.slice() }; if (s.cfg.excal) d.excal = st.excal;
        play('av.propose', d); return;
      }
      case 'vote': play('av.vote', { v: ds.v === '1' }); return;
      case 'next': play('av.next', {}); return;
      case 'card': play('av.card', { c: ds.c }); return;
      case 'excalgo': play('av.excal', { target: st.target }); return;
      case 'excalpass': play('av.excal', { target: null }); return;
      case 'witch': play('av.witch', { hide: ds.v === '1' }); return;
      case 'wchk': play('av.wcheck', { target: st.target }); return;
      case 'wskip': play('av.wcheck', { target: null }); return;
      case 'ladygo': play('av.lady', { target: st.target }); return;
      case 'mode': st.mode = ds.v; st.targets = []; render(); return;
      case 'kill': play('av.kill', { mode: st.mode, targets: st.targets.slice() }); return;
      case 'role': st.role = ds.v; render(); return;
      case 'kill2': play('av.kill2', { role: st.role, target: st.target }); return;
      default: return;
    }
  }

  document.addEventListener('click', function (e) {
    const el = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!el || el.disabled) return;
    handle(el.getAttribute('data-act'), el);
  });
  document.addEventListener('change', function (e) {
    const el = e.target;
    if (el && el.getAttribute && el.getAttribute('data-act-change') === 'viewas') { S.viewAs = el.value; S.sel.ph = -1; render(); }
  });
  document.addEventListener('input', function (e) {
    const el = e.target;
    if (el.id === 'nm') S.name = el.value;
    if (el.id === 'jc') { const v = Core.normCode(el.value); S.joinCode = v; if (el.value !== v) el.value = v; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.id === 'jc') { S.joinCode = Core.normCode(e.target.value); joinRoom(S.joinCode); }
    const hold = e.target && e.target.closest ? e.target.closest('[data-hold]') : null;
    if (hold && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); hold.classList.toggle('on'); }
  });
  /* 按住顯示身分：按住時不重畫畫面，放開後才補畫 */
  document.addEventListener('pointerdown', function (e) {
    const hold = e.target.closest ? e.target.closest('[data-hold]') : null;
    if (!hold) return;
    S.holding = true; hold.classList.add('on');
  });
  function release() {
    if (!S.holding) return;
    S.holding = false;
    document.querySelectorAll('[data-hold].on').forEach(function (el) { el.classList.remove('on'); });
    if (S.dirty) render();
  }
  document.addEventListener('pointerup', release);
  document.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  document.addEventListener('contextmenu', function (e) { if (e.target.closest && e.target.closest('[data-hold]')) e.preventDefault(); });

  /* ---------- 啟動 ---------- */
  (function boot() {
    render();
    let sess = null; try { sess = JSON.parse(sget('table:sess') || 'null'); } catch (e) { sess = null; }
    if (sess && sess.code && sess.id && ONLINE) {
      S.name = sess.name || S.name;
      joinRoom(sess.code, sess.id);
    }
  })();
  window.__table = S; /* 方便除錯 */
})();
