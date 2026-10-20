'use strict';
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path = require('path');
const URL = 'file://' + path.join(__dirname, '..', 'dist', 'index.html');
const SHOT = path.join(__dirname, '..', 'shots'); require('fs').mkdirSync(SHOT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push('pageerror ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errs.push('console ' + m.text()); });
  await page.goto(URL);
  await page.click('[data-act=sim]'); await page.waitForSelector('text=等人加入');
  await page.click('[data-act=game][data-k=onuw]');
  await page.click('[data-act=owpreset][data-v=full]');
  await page.screenshot({ path: SHOT + '/20_ow_lobby.png', fullPage: true });
  await page.click('[data-act=start]'); await page.waitForSelector('.tabs-in');
  const as = id => page.selectOption('select.sel', id);
  const S = () => page.evaluate(() => { const g = window.__table.room.game; return { phase: g.phase, order: g.order, roles: g.roles, acts: Object.keys(g.acts), votes: Object.keys(g.votes) }; });
  let s = await S();
  await page.screenshot({ path: SHOT + '/21_ow_night.png' });
  for (const id of s.order) {
    await as(id);
    const k = s.roles[id];
    const first = async sel => { await page.click(sel + ':not([disabled])'); };
    if (k === 'werewolf' && await page.$('[data-act=n_peek]')) { await first('[data-act=pickc]'); await first('[data-act=n_peek]'); }
    else if (k === 'seer') { await first('[data-act=pickp]'); await first('[data-act=n_seer]'); }
    else if (k === 'robber') { await first('[data-act=pickp]'); await first('[data-act=n_rob]'); }
    else if (k === 'troublemaker') { await page.locator('[data-act=pickp]').nth(0).click(); await page.locator('[data-act=pickp]').nth(1).click(); await first('[data-act=n_tm]'); }
    else if (k === 'drunk') { await first('[data-act=pickc]'); await first('[data-act=n_drunk]'); }
    else await first('[data-act=n_ok]');
  }
  s = await S();
  if (s.phase !== 'day') throw new Error('expected day, got ' + s.phase);
  await as(s.order[0]);
  await page.screenshot({ path: SHOT + '/22_ow_day.png', fullPage: true });
  for (const id of s.order.slice(0, 4)) { await as(id); await page.click('[data-act=owcall]'); }
  s = await S(); if (s.phase !== 'vote') throw new Error('expected vote ' + s.phase);
  for (let i = 0; i < s.order.length; i++) { const id = s.order[i]; await as(id); const cnt = await page.locator('[data-act=pickp]').count(); await page.locator('[data-act=pickp]').nth(i % cnt).click(); await page.click('[data-act=owvote]'); }
  s = await S(); if (s.phase !== 'over') throw new Error('expected over ' + s.phase);
  await page.screenshot({ path: SHOT + '/23_ow_over.png', fullPage: true });
  await page.click('[data-act=tab][data-v=log]'); await page.screenshot({ path: SHOT + '/24_ow_help.png', fullPage: true });
  console.log('onuw ui ok, errors', JSON.stringify(errs));
  await browser.close();
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
