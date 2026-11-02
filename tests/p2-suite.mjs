// Phase 2 suite: ESP32 regression (20 lessons) + all pages x light/dark x desktop/mobile, credit, theme persistence, overflow, console errors.
import { chromium } from 'playwright'; import fs from 'fs';
const BASE=process.env.BASE||'http://127.0.0.1:8080'; const LOCAL=BASE.includes('127.0.0.1');
const O='/workspace/learn-esp32-local/_compare/phase2/'+(process.env.TAG||''); fs.mkdirSync(O+'theme',{recursive:true});
const RES=O+'results.json'; const R=fs.existsSync(RES)?JSON.parse(fs.readFileSync(RES)):{}; const save=()=>fs.writeFileSync(RES,JSON.stringify(R,null,1));
const PART=process.argv[2]||'all';
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
const errs=[];
async function ctx(vp,mobile=false){const c=await b.newContext({viewport:vp,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1}); c.setDefaultTimeout(90000);
  if(LOCAL) await c.route(()=>true,r=>{const u=r.request().url(); if(u.startsWith(BASE)||/^(blob|data):/.test(u)) return r.continue(); errs.push('blocked '+u); return r.abort();}); return c;}
function hook(p,tag){p.on('pageerror',e=>errs.push(tag+' pageerror '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(tag+' console '+m.text())}); p.on('response',r=>{if(r.status()>=400)errs.push(tag+' '+r.status()+' '+r.url())});}
const ready=async p=>{await p.waitForFunction(()=>!document.documentElement.classList.contains('is-loading'),null,{timeout:120000}); await p.waitForTimeout(2000);};
const lessons=JSON.parse(fs.readFileSync('/workspace/p2/esp-lessons.json'));
if(PART==='all'||PART==='esp'){
  R.esp32=R.esp32||{}; const c=await ctx({width:1280,height:800});
  const ids=lessons.map(l=>l.id||l[0]); const from=+(process.argv[3]||0), to=+(process.argv[4]||ids.length);
  for(const id of ids.slice(from,to)){const p=await c.newPage(); hook(p,'esp32#'+id); const t0=Date.now();
    try{await p.goto(BASE+'/#'+id); await ready(p);
      const r=await p.evaluate(()=>({title:document.title, active:document.querySelector('.lesson.is-active')?.getAttribute('aria-label'), canvas:!!document.querySelector('#board-canvas'), hash:location.hash, credit:[...document.querySelectorAll('a[href*="DilumSanjaya"]')].filter(a=>a.offsetParent&&a.getBoundingClientRect().width>0).length, switcher:document.querySelectorAll('.cd-tracks a').length}));
      if(['blink','servo','radar'].includes(id)){const tabs={}; for(const t of ['Overview','Pinout','Example','Specifications']){await p.locator('[role=tab]',{hasText:t}).click(); await p.waitForTimeout(300); tabs[t]=(await p.locator('[role=tabpanel]').first().innerText()).trim().length;} r.tabs=tabs; await p.locator('[role=tab]',{hasText:'Overview'}).click();}
      await p.locator('.btn-run').click(); await p.waitForTimeout(3500);
      r.status=(await p.locator('.console-status').innerText()).trim(); r.serial=(await p.locator('.console-lines').innerText()).trim().slice(-80).replace(/\s+/g,' ');
      if(['board','blink','radar'].includes(id)) await p.screenshot({path:O+`esp32-${id}.png`});
      r.pass=r.title.includes('CircuitDeck')&&!!r.active&&r.canvas&&r.hash==='#'+id&&/run/i.test(r.status)&&r.serial.length>0&&r.credit===1&&(!r.tabs||Object.values(r.tabs).every(n=>n>20));
      r.ms=Date.now()-t0; R.esp32[id]=r;}catch(e){R.esp32[id]={pass:false,error:String(e.message).slice(0,200)};}
    save(); console.log(id,R.esp32[id].pass,R.esp32[id].ms); await p.close();}
  await c.close();
}
const PAGES={home:'/#blink',pi5:'/pi5/#traffic',sandbox:'/sandbox/#t=weather-station',gallery:'/gallery/'};
async function pageCheck(p){return p.evaluate(()=>({theme:document.documentElement.dataset.theme||'light', title:document.title,
  credits:[...document.querySelectorAll('a[href*="DilumSanjaya"]')].filter(a=>{const r=a.getBoundingClientRect(); const s=getComputedStyle(a); return r.width>0&&r.height>0&&s.visibility!=='hidden'&&a.offsetParent}).map(a=>a.textContent.replace(/\s+/g,' ').trim()),
  overflowX:document.documentElement.scrollWidth-document.documentElement.clientWidth, bodyText:/william/i.test(document.body.innerText), learnEsp32Visible:/Learn ESP32/.test(document.body.innerText.replace(/Based on Learn ESP32 by Dilum Sanjaya/g,'')), bg:getComputedStyle(document.body).backgroundColor}));}
if(PART==='all'||PART==='pages'){
  R.pages={};
  for(const [vpName,vp,mob] of [['desktop',{width:1440,height:900},false],['mobile',{width:390,height:844},true]]){
    for(const theme of ['light','dark']){const c=await ctx(vp,mob);
      if(theme==='dark') await c.addInitScript(()=>{try{if(!sessionStorage.getItem('seeded')){localStorage.setItem('circuitdeck:theme','dark');sessionStorage.setItem('seeded','1')}}catch{}});
      for(const [name,path] of Object.entries(PAGES)){const p=await c.newPage(); const tag=`${name}/${theme}/${vpName}`; hook(p,tag);
        try{await p.goto(BASE+path); if(name==='home') await ready(p); else await p.waitForTimeout(name==='gallery'?1500:4000);
          const r=await pageCheck(p); const f=O+`theme/${name}-${theme}-${vpName}.png`; await p.screenshot({path:f});
          r.pass=r.theme===theme&&r.title.includes('CircuitDeck')&&r.credits.length===1&&r.credits[0]==='Based on Learn ESP32 by Dilum Sanjaya'&&r.overflowX<=1&&!r.bodyText&&!r.learnEsp32Visible; r.shot=f; R.pages[tag]=r;}catch(e){R.pages[tag]={pass:false,error:String(e.message).slice(0,200)};}
        save(); console.log(tag,R.pages[tag].pass,JSON.stringify(R.pages[tag]).slice(0,220)); await p.close();}
      await c.close();}}
  // persistence: default light, toggle on gallery -> persists across pages and reloads
  const c=await ctx({width:1440,height:900}); const p=await c.newPage(); hook(p,'persist');
  await p.goto(BASE+'/gallery/'); const t0=await p.evaluate(()=>document.documentElement.dataset.theme||'light');
  const toggle=p.locator('[data-cd-theme],.cd-theme,button[aria-label*="theme" i]').first(); await toggle.click(); await p.waitForTimeout(300);
  const seq={defaultTheme:t0, afterToggle:await p.evaluate(()=>document.documentElement.dataset.theme||'light')};
  for(const [n,path] of Object.entries(PAGES)){await p.goto(BASE+path); await p.waitForTimeout(1500); seq[n]=await p.evaluate(()=>document.documentElement.dataset.theme||'light');}
  await p.reload(); await p.waitForTimeout(1000); seq.reload=await p.evaluate(()=>document.documentElement.dataset.theme||'light');
  seq.pass=t0==='light'&&seq.afterToggle==='dark'&&Object.keys(PAGES).every(n=>seq[n]==='dark')&&seq.reload==='dark'; R.persist=seq; save(); console.log('persist',JSON.stringify(seq));
  // track switcher navigation
  await p.goto(BASE+'/pi5/'); await p.waitForTimeout(1500); const sw=await p.evaluate(()=>[...document.querySelectorAll('.cd-tracks a')].map(a=>a.getAttribute('href')+'|'+a.innerText.trim())); R.switcher=sw; save(); console.log('switcher',sw);
  await c.close();
}
R.errors=R.errors||{}; R.errors[PART+(process.argv[3]||'')]=errs; save(); console.log('ERRORS',errs.length,errs.slice(0,15)); await b.close();
