'use strict';
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
const SHOT = path.join(__dirname, '..', 'shots'); require('fs').mkdirSync(SHOT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox'] }).catch(async () => chromium.launch({ args: ['--no-sandbox'] }));
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  await page.goto(URL);
  await page.screenshot({ path: SHOT + '/01_home.png' });
  await page.click('[data-act=sim]');
  await page.waitForSelector('text=等人加入');
  await page.screenshot({ path: SHOT + '/02_lobby.png', fullPage: true });
  // 經典局 + 湖中仙女 + 神劍
  await page.click('[data-act=preset][data-v=classic]');
  await page.click('[data-act=togcfg][data-k=lady]');
  await page.click('[data-act=togcfg][data-k=excal]');
  await page.click('[data-act=tog][data-k=witch]');
  await page.screenshot({ path: SHOT + '/03_lobby_cfg.png', fullPage: true });
  await page.click('[data-act=start]');
  await page.waitForSelector('.tabs-in');
  await page.screenshot({ path: SHOT + '/04_game_start.png' });

  const st = () => page.evaluate(() => { const S = window.__table; const g = S.room.game; return g ? { phase: g.phase, ph: g.ph, over: !!g.over } : null; });
  async function as(id) { await page.selectOption('select.sel', id); }
  async function clickIf(sel) { const el = await page.$(sel + ':not([disabled])'); if (el) { await el.click(); return true; } return false; }
  let steps = 0, shots = {};
  while (steps++ < 400) {
    const info = await page.evaluate(() => {
      const S = window.__table, g = S.room.game; if (!g) return null;
      const AV = window.Avalon;
      return { phase: g.phase, over: !!g.over, order: g.order, leader: AV.leaderId(g), team: g.team, votes: Object.keys(g.votes), cards: Object.keys(g.cards), excal: g.excal, witch: g.witchId, pre: g.pre, wc: g.wc, lady: g.lady && g.lady.holder, size: g.phase === 'team' ? AV.teamSize(g) : 0, roles: g.roles, q: g.q };
    });
    if (info.over) break;
    if (!shots[info.phase]) { shots[info.phase] = 1; }
    switch (info.phase) {
      case 'team': {
        await as(info.leader);
        for (const id of info.order.slice(0, info.size)) await page.click('[data-act=pickp][data-id=' + id + ']');
        if (await page.$('[data-act=excalto]')) { const e = info.order.slice(0, info.size).find(x => x !== info.leader); await page.click('[data-act=excalto][data-id=' + e + ']'); }
        if (!shots.teamshot) { shots.teamshot = 1; await page.screenshot({ path: SHOT + '/05_team.png', fullPage: true }); }
        await page.click('[data-act=propose]'); break;
      }
      case 'vote': {
        const who = info.order.find(x => !info.votes.includes(x));
        await as(who);
        if (!shots.voteshot) { shots.voteshot = 1; await page.screenshot({ path: SHOT + '/06_vote.png' }); }
        await page.click('[data-act=vote][data-v="' + (Math.random() < 0.8 ? 1 : 0) + '"]'); break;
      }
      case 'voteres': if (!shots.vr) { shots.vr = 1; await page.screenshot({ path: SHOT + '/07_voteres.png' }); } await page.click('[data-act=next]'); break;
      case 'qres': if (!shots.qr) { shots.qr = 1; await page.screenshot({ path: SHOT + '/08_qres.png' }); } await page.click('[data-act=next]'); break;
      case 'quest': {
        const who = info.team.find(x => !info.cards.includes(x));
        await as(who);
        if (!shots.qshot) { shots.qshot = 1; await page.screenshot({ path: SHOT + '/09_quest.png' }); }
        const btn = await page.$('[data-act=card]');
        await btn.click(); break;
      }
      case 'pre': {
        if (!info.pre.excalDone) { await as(info.excal); await page.click('[data-act=pickp]:not([disabled])'); await page.click('[data-act=excalgo]'); break; }
        if (!info.pre.witchDone) { await as(info.witch); await page.click('[data-act=witch][data-v="' + (Math.random() < 0.5 ? 1 : 0) + '"]'); break; }
        break;
      }
      case 'wcheck': {
        await as(info.wc.checker);
        if (!shots.wc) { shots.wc = 1; await page.screenshot({ path: SHOT + '/10_wcheck.png', fullPage: true }); }
        await page.click('[data-act=pickp]:not([disabled])'); await page.click('[data-act=wchk]'); break;
      }
      case 'lady': {
        await as(info.lady);
        await page.click('[data-act=pickp]:not([disabled])'); await page.click('[data-act=ladygo]'); break;
      }
      case 'assassin': {
        const asn = info.order.find(x => info.roles[x] === 'assassin');
        await as(asn);
        await page.screenshot({ path: SHOT + '/11_assassin.png', fullPage: true });
        await page.click('[data-act=pickp]:not([disabled])'); await page.click('[data-act=kill]'); break;
      }
      default: throw new Error('unhandled ' + info.phase);
    }
    await page.waitForTimeout(10);
  }
  await page.screenshot({ path: SHOT + '/12_over.png', fullPage: true });
  // 我的身分頁 + 按住
  await page.click('[data-act=tab][data-v=me]');
  const box = await page.locator('.reveal').boundingBox();
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down();
  await page.screenshot({ path: SHOT + '/13_hold.png', fullPage: true });
  const onWhileHold = await page.evaluate(() => document.querySelector('.reveal').classList.contains('on'));
  await page.mouse.up();
  const offAfter = await page.evaluate(() => !document.querySelector('.reveal').classList.contains('on'));
  await page.click('[data-act=tab][data-v=log]');
  await page.screenshot({ path: SHOT + '/14_log.png', fullPage: true });
  await page.click('[data-act=tab][data-v=game]');
  await page.click('[data-act=again]');
  await page.waitForSelector('text=等人加入');
  console.log('steps', steps, 'hold on/off', onWhileHold, offAfter, 'errors', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
