/* 桌邊 · 共用核心
 * 做法：所有人把「動作」寫進同一份事件記錄，每支手機用同一套規則把記錄重播一遍，
 * 就會算出相同的遊戲狀態。所以伺服器只需要「存記錄、通知大家」，不需要懂遊戲規則。
 */
(function (g) {
  'use strict';
  const Core = {};
  Core.games = {};

  /* ---------- 小工具 ---------- */
  Core.hash = function (s) {
    s = String(s);
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return h >>> 0;
  };
  Core.rng = function (seed) {
    let a = Core.hash(seed);
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  Core.shuffle = function (arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  };
  Core.clone = function (o) { return JSON.parse(JSON.stringify(o)); };
  Core.esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  const CODE_AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  function randInt(n) {
    try {
      const c = (typeof crypto !== 'undefined' && crypto.getRandomValues) ? crypto : null;
      if (c) { const u = new Uint32Array(1); c.getRandomValues(u); return u[0] % n; }
    } catch (e) { /* fallthrough */ }
    return Math.floor(Math.random() * n);
  }
  Core.randomCode = function () { let s = ''; for (let i = 0; i < 5; i++) s += CODE_AL[randInt(32)]; return s; };
  Core.randomId = function () { let s = ''; for (let i = 0; i < 8; i++) s += CODE_AL[randInt(32)].toLowerCase(); return s; };
  Core.normCode = function (s) {
    return String(s || '').toUpperCase().split('').filter(function (c) { return CODE_AL.indexOf(c) >= 0; }).join('').slice(0, 5);
  };

  /* ---------- 房間狀態機 ---------- */
  const MAX_PLAYERS = 12;
  Core.newRoom = function () {
    return { created: false, seed: '', players: [], hostId: null, phase: 'lobby', gameId: 'avalon', cfg: {}, game: null, rev: 0 };
  };
  Core.nameOf = function (room, id) {
    const p = room.players.find(function (x) { return x.id === id; });
    return p ? p.name : '?';
  };
  Core.seatOf = function (room, id) { return room.players.findIndex(function (x) { return x.id === id; }) + 1; };
  function cleanName(s, fallback) {
    s = String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 10);
    return s || fallback;
  }
  Core.cleanName = cleanName;

  Core.reduceRoom = function (room0, a) {
    if (!a || typeof a.k !== 'string') return room0;
    const d = a.d || {};
    const room = Core.clone(room0);
    const isPlayer = room.players.some(function (x) { return x.id === a.p; });
    const isHost = a.p === room.hostId;

    if (a.k === 'create') {
      if (room.created) return room0;
      room.created = true;
      room.seed = String(d.seed || 'seed');
      room.hostId = a.p;
      room.players = [{ id: a.p, name: cleanName(d.name, '玩家1') }];
      return room;
    }
    if (!room.created) return room0;

    if (a.k === 'join') {
      if (isPlayer) {
        const me = room.players.find(function (x) { return x.id === a.p; });
        me.name = cleanName(d.name, me.name);
        return room;
      }
      if (room.phase !== 'lobby' || room.players.length >= MAX_PLAYERS) return room0;
      room.players.push({ id: a.p, name: cleanName(d.name, '玩家' + (room.players.length + 1)) });
      return room;
    }
    if (!isPlayer) return room0;

    switch (a.k) {
      case 'leave': {
        if (room.phase !== 'lobby') return room0;
        room.players = room.players.filter(function (x) { return x.id !== a.p; });
        if (room.hostId === a.p) room.hostId = room.players.length ? room.players[0].id : null;
        return room;
      }
      case 'kick': {
        if (room.phase !== 'lobby' || !isHost || d.id === a.p) return room0;
        room.players = room.players.filter(function (x) { return x.id !== d.id; });
        return room;
      }
      case 'move': {
        if (room.phase !== 'lobby' || !isHost) return room0;
        const i = room.players.findIndex(function (x) { return x.id === d.id; });
        const j = i + (d.dir < 0 ? -1 : 1);
        if (i < 0 || j < 0 || j >= room.players.length) return room0;
        const t = room.players[i]; room.players[i] = room.players[j]; room.players[j] = t;
        return room;
      }
      case 'cfg': {
        if (room.phase !== 'lobby' || !isHost || !Core.games[d.gameId]) return room0;
        room.gameId = d.gameId;
        if (d.cfg) room.cfg[d.gameId] = d.cfg;
        return room;
      }
      case 'start': {
        if (room.phase !== 'lobby' || !isHost) return room0;
        const G = Core.games[room.gameId];
        if (!G || !G.ready) return room0;
        const cfg = room.cfg[room.gameId] || G.defaultCfg();
        const n = room.players.length;
        const chk = G.check(cfg, n);
        if (!chk.ok) return room0;
        room.game = G.init({ ids: room.players.map(function (x) { return x.id; }), cfg: cfg, seed: room.seed + ':' + room.rev, t: a.t || 0 });
        room.phase = 'game';
        return room;
      }
      case 'reset': {
        if (room.phase !== 'game') return room0;
        const G = Core.games[room.gameId];
        const over = room.game && room.game.over;
        if (!isHost && !over) return room0;
        void G;
        room.phase = 'lobby'; room.game = null; room.rev += 1;
        return room;
      }
      default: break;
    }
    if (room.phase === 'game' && room.game) {
      const G = Core.games[room.gameId];
      if (G && a.k.indexOf(G.prefix) === 0) {
        room.game = G.reduce(room.game, a);
        return room;
      }
    }
    return room0;
  };

  /* 把排序好的記錄折疊成房間狀態；新增動作時只重播新增的部分 */
  Core.Folder = function () {
    let keys = [];
    let room = Core.newRoom();
    this.update = function (sorted) {
      let same = keys.length <= sorted.length;
      for (let i = 0; same && i < keys.length; i++) if (keys[i] !== sorted[i].key) same = false;
      if (!same) { room = Core.newRoom(); keys = []; }
      for (let i = keys.length; i < sorted.length; i++) {
        try { room = Core.reduceRoom(room, sorted[i].a); }
        catch (e) { if (typeof console !== 'undefined') console.error('skip bad action', sorted[i], e); }
        keys.push(sorted[i].key);
      }
      return room;
    };
    this.room = function () { return room; };
  };

  /* ---------- 連線層 ---------- */
  /* 共同介面：push(a) 寫入一筆動作；onChange(cb) 收到排序後的 [{key,a}]；now() 伺服器時間估計；close() */
  function padKey(n) { return String(n).padStart(15, '0'); }

  /* 本機示範：全部玩家都在同一個畫面，沒有網路 */
  Core.openSim = function () {
    const items = []; let cb = null; let counter = 0;
    function fire() { if (cb) cb(items.slice()); }
    return {
      kind: 'sim',
      push: function (a) {
        const x = Object.assign({}, a, { t: Date.now() });
        items.push({ key: padKey(++counter), a: x });
        fire(); return Promise.resolve();
      },
      onChange: function (f) { cb = f; fire(); },
      now: function () { return Date.now(); },
      close: function () { cb = null; },
      items: items
    };
  };

  /* 同一個瀏覽器的多個分頁（測試用，網址加 ?local=1） */
  Core.openLocal = function (code) {
    const lsKey = 'table:log:' + code;
    let cb = null;
    let bc = null;
    try { bc = new BroadcastChannel('table:' + code); } catch (e) { bc = null; }
    function load() {
      try { return JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch (e) { return []; }
    }
    function fire() { if (cb) cb(load().sort(function (x, y) { return x.key < y.key ? -1 : x.key > y.key ? 1 : 0; })); }
    if (bc) bc.onmessage = function () { fire(); };
    window.addEventListener('storage', function (e) { if (e.key === lsKey) fire(); });
    return {
      kind: 'local',
      push: function (a) {
        const arr = load();
        const key = padKey(Date.now()) + '-' + Core.randomId().slice(0, 4);
        arr.push({ key: key, a: Object.assign({}, a, { t: Date.now() }) });
        try { localStorage.setItem(lsKey, JSON.stringify(arr)); } catch (e) { /* ignore */ }
        if (bc) bc.postMessage('x');
        fire(); return Promise.resolve();
      },
      onChange: function (f) { cb = f; fire(); },
      now: function () { return Date.now(); },
      close: function () { cb = null; if (bc) bc.close(); }
    };
  };

  /* Firebase Realtime Database（正式連線） */
  const FB_VER = '10.14.1';
  function loadScript(src) {
    return new Promise(function (res, rej) {
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = function () { rej(new Error('載入失敗：' + src)); };
      document.head.appendChild(s);
    });
  }
  Core.openFirebase = async function (code, cfg) {
    if (!g.firebase) {
      await loadScript('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-app-compat.js');
      await loadScript('https://www.gstatic.com/firebasejs/' + FB_VER + '/firebase-database-compat.js');
    }
    const fb = g.firebase;
    if (!fb.apps.length) fb.initializeApp(cfg);
    const db = fb.database();
    const ref = db.ref('rooms/' + code + '/log');
    const store = {};
    let cb = null; let pending = false; let offset = 0; let connected = false;
    db.ref('.info/serverTimeOffset').on('value', function (s) { offset = s.val() || 0; });
    const connCbs = [];
    db.ref('.info/connected').on('value', function (s) { connected = !!s.val(); connCbs.forEach(function (f) { f(connected); }); });
    function fire() {
      pending = false;
      if (!cb) return;
      cb(Object.keys(store).sort().map(function (k) { return { key: k, a: store[k] }; }));
    }
    function schedule() { if (!pending) { pending = true; setTimeout(fire, 0); } }
    ref.on('child_added', function (s) { store[s.key] = s.val(); schedule(); });
    ref.on('child_changed', function (s) { store[s.key] = s.val(); schedule(); });
    return {
      kind: 'firebase',
      push: function (a) {
        const x = Object.assign({}, a, { t: fb.database.ServerValue.TIMESTAMP });
        return ref.push(x);
      },
      onChange: function (f) { cb = f; schedule(); },
      onConnection: function (f) { connCbs.push(f); f(connected); },
      now: function () { return Date.now() + offset; },
      close: function () { ref.off(); }
    };
  };

  g.Core = Core;
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
})(typeof globalThis !== 'undefined' ? globalThis : window);
