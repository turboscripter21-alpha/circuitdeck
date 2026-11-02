// M5 smoke: one short scripted pass. Writes _compare/phase2/smoke.json incrementally.
import { chromium } from 'playwright'; import fs from 'fs';
const BASE=process.env.BASE||'http://127.0.0.1:8080'; const LOCAL=BASE.includes('127.0.0.1');
const O=process.env.OUT||'/workspace/learn-esp32-local/_compare/phase2/'; fs.mkdirSync(O,{recursive:true});
const RES=O+(process.env.RES||'smoke.json'); const R=fs.existsSync(RES)?JSON.parse(fs.readFileSync(RES)):{base:BASE}; const save=()=>fs.writeFileSync(RES,JSON.stringify(R,null,1));
const PART=process.argv[2]||'all'; const errs=R.errors||[]; R.errors=errs;
const b=await chromium.launch({args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']});
async function ctx(vp={width:1440,height:900},mobile=false){const c=await b.newContext({viewport:vp,isMobile:mobile,hasTouch:mobile}); c.setDefaultTimeout(60000);
  if(LOCAL) await c.route(()=>true,r=>{const u=r.request().url(); if(u.startsWith(BASE)||/^(blob|data):/.test(u)) return r.continue(); errs.push('blocked '+u); return r.abort();}); return c;}
function hook(p,tag){p.on('pageerror',e=>errs.push(tag+' pageerror '+e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(tag+' console '+m.text())}); p.on('response',r=>{if(r.status()>=400)errs.push(tag+' '+r.status()+' '+r.url())});}
const ready=p=>p.waitForFunction(()=>!document.documentElement.classList.contains('is-loading'),null,{timeout:90000}).then(()=>p.waitForTimeout(1500));
const shotBuf=p=>p.locator('#stage').screenshot();
async function T(k,fn){const t0=Date.now(); try{R[k]=await fn();}catch(e){R[k]={pass:false,error:String(e.message).slice(0,200)};} R[k].ms=Date.now()-t0; save(); console.log(k,R[k].pass,JSON.stringify(R[k]).slice(0,200));}
if(PART==='all'||PART==='esp'){ const c=await ctx(); const p=await c.newPage(); hook(p,'esp32');
  await T('esp32',async()=>{const out={lessons:{}};
    for(const id of ['board','blink','radar']){await p.goto(BASE+'/#'+id); await ready(p); const before=(await p.locator('#progress-count').innerText()).trim();
      await p.locator('.btn-run').click(); await p.waitForTimeout(3000);
      const r=await p.evaluate(()=>({title:document.title,active:document.querySelector('.lesson.is-active')?.getAttribute('aria-label'),serial:document.querySelector('.console-lines')?.innerText.trim().length||0}));
      r.progressBefore=before; r.progressAfter=(await p.locator('#progress-count').innerText()).trim(); await p.screenshot({path:O+`smoke-esp32-${id}.png`});
      r.pass=r.title.includes('CircuitDeck')&&!!r.active&&r.serial>0; out.lessons[id]=r;}
    out.progressStored=await p.evaluate(()=>localStorage.getItem('learn-esp32:done'));
    await p.reload(); await ready(p); out.progressAfterReload=(await p.locator('#progress-count').innerText()).trim();
    // language switch
    const lang0=await p.evaluate(()=>document.documentElement.lang); const t0=await p.locator('.btn-run').innerText().catch(()=>'');
    await p.locator('[data-nav=language]').first().click(); await p.waitForTimeout(800);
    const langs=await p.locator('[data-lang]').evaluateAll(a=>a.map(x=>x.dataset.lang)); const pick=langs.find(l=>!lang0.startsWith(l)&&l!=='en')||langs[1];
    await p.locator(`[data-lang="${pick}"]`).click(); await p.waitForTimeout(2500);
    const lang1=await p.evaluate(()=>document.documentElement.lang); const navTitle=await p.locator('[data-nav=lessons]').first().getAttribute('title');
    await p.screenshot({path:O+'smoke-esp32-language.png'});
    out.language={from:lang0,to:lang1,picked:pick,available:langs.length,lessonsTitle:navTitle};
    await p.locator(`[data-lang="en"]`).click().catch(async()=>{await p.locator('[data-nav=language]').first().click(); await p.waitForTimeout(500); await p.locator('[data-lang="en"]').click();}); await p.waitForTimeout(1500);
    out.language.back=await p.evaluate(()=>document.documentElement.lang);
    out.pass=Object.values(out.lessons).every(l=>l.pass)&&+out.progressAfterReload.split('/')[0]>=3&&lang1!==lang0&&out.language.back===lang0; return out;});
  await c.close();}
if(PART==='all'||PART==='pi5'){ const c=await ctx(); const p=await c.newPage(); hook(p,'pi5');
  await p.goto(BASE+'/pi5/'); await p.waitForFunction(()=>window.__pi5,null,{timeout:60000}); await p.waitForTimeout(1500);
  const ids=await p.evaluate(()=>{const ps=__pi5.PROJECTS.filter(x=>x.parts.length>=2); return [0,.25,.5,.75,.99].map(f=>ps[Math.floor(f*ps.length)].id);});
  R.pi5={projects:{}}; save();
  for(const id of ids){await T('pi5_'+id,async()=>{await p.goto(BASE+'/pi5/#'+id); await p.waitForTimeout(2500); const r={id};
    await p.locator('.btn-run').click(); await p.waitForTimeout(2500); r.consoleLines=await p.evaluate(()=>document.querySelectorAll('.console-lines > *').length);
    await p.locator('.btn-run').click().catch(()=>{}); await p.waitForTimeout(500);
    const a=await shotBuf(p); const bb=await p.locator('#stage').boundingBox(); const x=bb.x+bb.width*0.15,y=bb.y+bb.height*0.75;
    await p.mouse.move(x,y); await p.mouse.down(); await p.mouse.move(x+160,y-40,{steps:10}); await p.mouse.up(); await p.waitForTimeout(800); r.orbitChanged=!a.equals(await shotBuf(p));
    const tag=p.locator('#tags .tag:not(.is-hidden)').nth(1); await tag.click({force:true}); await p.waitForTimeout(800);
    r.inspectorOpen=await p.evaluate(()=>{const d=document.querySelector('#inspector'); return !!d&&getComputedStyle(d).visibility!=='hidden'&&d.getBoundingClientRect().width>0&&!!d.querySelector('[data-remove]')});
    const n0=await p.evaluate(()=>Object.keys(__pi5.insts).length); await p.locator('#inspector [data-remove]').click(); await p.waitForTimeout(800);
    const n1=await p.evaluate(()=>Object.keys(__pi5.insts).length);
    await p.locator('[data-nav=parts]').first().click(); await p.waitForTimeout(600); await p.locator('[data-restore]').click(); await p.waitForTimeout(1000);
    const n2=await p.evaluate(()=>Object.keys(__pi5.insts).length); r.parts={before:n0,afterRemove:n1,afterRestore:n2};
    if(id===ids[0]) await p.screenshot({path:O+`smoke-pi5-${id}.png`});
    await p.keyboard.press('Escape'); r.pass=r.consoleLines>0&&r.orbitChanged&&r.inspectorOpen&&n1===n0-1&&n2===n0; return r;});}
  await c.close();}
if(PART==='all'||PART==='sb'){ const c=await ctx(); const p=await c.newPage(); hook(p,'sandbox');
  await T('sandbox',async()=>{await p.goto(BASE+'/sandbox/#t=traffic-light'); await p.waitForFunction(()=>window.__sb,null,{timeout:60000}); await p.waitForTimeout(2000);
    await p.locator('.btn-run').click(); await p.waitForTimeout(2500); const lines=await p.evaluate(()=>document.querySelectorAll('.console-lines > *').length); await p.screenshot({path:O+'smoke-sandbox-run.png'}); await p.locator('.btn-run').click();
    const {url,json}=await p.evaluate(async()=>{__sb.loadTemplate('weather-station'); return {url:await __sb.share(),json:__sb.exportJSON()};});
    const p2=await c.newPage(); hook(p2,'sandbox-share'); await p2.goto(url); await p2.waitForFunction(()=>window.__sb,null,{timeout:60000}); await p2.waitForTimeout(1500);
    const same=await p2.evaluate(j=>__sb.exportJSON()===j,json); await p2.screenshot({path:O+'smoke-sandbox-share.png'});
    return {pass:lines>0&&same, runLines:lines, shareUrlChars:url.length, roundtripIdentical:same};});
  await c.close();}
if(PART==='all'||PART==='gal'){ const c=await ctx(); const p=await c.newPage(); hook(p,'gallery');
  await T('gallery',async()=>{await p.goto(BASE+'/gallery/'); await p.waitForTimeout(1200); const cnt=()=>p.evaluate(()=>document.querySelectorAll('#g-grid .card:not([hidden])').length);
    const all=await cnt(); await p.click('[data-filter=track] [data-v=pi5]'); await p.waitForTimeout(300); const pi=await cnt();
    await p.click('[data-filter=level] [data-v=Advanced]'); await p.waitForTimeout(300); const piAdv=await cnt(); await p.screenshot({path:O+'smoke-gallery-filter.png'});
    return {pass:all===61&&pi===29&&piAdv>0&&piAdv<pi, all, pi5:pi, pi5Advanced:piAdv, url:p.url()};});
  await c.close();}
if(PART==='all'||PART==='theme'){ R.theme={};
  for(const [name,path] of [['home','/#blink'],['pi5','/pi5/#traffic'],['sandbox','/sandbox/#t=robot-car'],['gallery','/gallery/']]){
    await T('theme_'+name,async()=>{const c=await ctx(); const p=await c.newPage(); hook(p,'theme-'+name); await p.goto(BASE+path); await p.waitForTimeout(name==='home'?6000:3000);
      const th=()=>p.evaluate(()=>[document.documentElement.dataset.theme||'light',getComputedStyle(document.body).backgroundColor]);
      const l=await th(); await p.screenshot({path:O+`theme/${name}-light.png`}); await p.locator('[data-cd-theme]').first().click(); await p.waitForTimeout(600); const d=await th(); await p.screenshot({path:O+`theme/${name}-dark.png`});
      await p.reload(); await p.waitForTimeout(1500); const kept=(await th())[0]; await c.close(); return {pass:l[0]==='light'&&d[0]==='dark'&&l[1]!==d[1]&&kept==='dark',light:l,dark:d,afterReload:kept};});}}
if(PART==='all'||PART==='mob'){ await T('mobile_home',async()=>{const c=await ctx({width:390,height:844},true); const p=await c.newPage(); hook(p,'mobile'); await p.goto(BASE+'/#board'); await ready(p);
  const r=await p.evaluate(()=>({overflowX:document.documentElement.scrollWidth-document.documentElement.clientWidth, credit:[...document.querySelectorAll('a[href*="DilumSanjaya"]')].filter(a=>a.getBoundingClientRect().width>0&&a.offsetParent).length, tracks:document.querySelectorAll('.cd-tracks a').length}));
  await p.screenshot({path:O+'smoke-mobile-home.png'}); await c.close(); r.pass=r.overflowX<=1&&r.credit===0; return r;});}
R.errorCount=errs.length; save(); console.log('ERRORS',errs.length,errs.slice(0,10)); await b.close();
