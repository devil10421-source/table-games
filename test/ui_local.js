const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const path=require('path');
const URL='file://'+path.join(__dirname,'..','dist','index.html')+'?local=1';
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const ctx=await b.newContext({viewport:{width:390,height:800}});
 const errs=[];
 const mk=async(name)=>{const p=await ctx.newPage();p.on('pageerror',e=>errs.push(e.message));await p.goto(URL);await p.fill('#nm',name);return p;};
 const host=await mk('房主');
 await host.click('[data-act=create]');
 await host.waitForSelector('text=等人加入');
 const code=(await host.textContent('.codechip')).trim();
 const ps=[host];
 for(let i=1;i<5;i++){const p=await mk('玩家'+i);await p.fill('#jc',code);await p.click('[data-act=join]');await p.waitForSelector('text=等房主開始');ps.push(p);}
 await host.waitForFunction(()=>window.__table.room.players.length===5);
 await host.click('[data-act=start]');
 for(const p of ps)await p.waitForSelector('.tabs-in');
 const roles=[];
 for(const p of ps){roles.push(await p.evaluate(()=>{const S=window.__table;return S.room.game.roles[S.meId]}));}
 console.log(code,roles.join(','),'errors',JSON.stringify(errs));
 await b.close();
})().catch(e=>{console.error('FAIL',e);process.exit(1)});
