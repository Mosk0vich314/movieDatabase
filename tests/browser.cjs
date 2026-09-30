// Run with Node and Playwright available on NODE_PATH. Uses an isolated Edge profile.
const fs = require('fs'), http = require('http'), path = require('path'), assert = require('assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res) => {
  const pathname = new URL(req.url,'http://localhost').pathname;
  const file = path.join(root,pathname==='/'?'index.html':pathname);
  try {
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.woff2':'font/woff2'})[path.extname(file)] || 'application/octet-stream');
    res.end(fs.readFileSync(file));
  } catch (_) {res.writeHead(404);res.end();}
});
let browser;
async function main() {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Europe/Zurich',viewport:{width:390,height:844}});
  const errors=[];
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const films=[{id:100,title:'First film',release_date:'2000-01-01'},{id:101,title:'Second film',release_date:'2001-01-01'},
    {id:102,title:'Rare short',release_date:'2002-01-01',vote_count:2},{id:103,title:'Future film',release_date:'2099-01-01'},
    {id:104,title:'Undated film',release_date:''}].map(f=>({...f,job:'Director'}));
  await context.route('**/*',async route=>{
    const u=new URL(route.request().url());
    if(u.origin===origin)return route.continue();
    if(u.hostname==='api.themoviedb.org') {
      if(/\/person\/50$/.test(u.pathname))return route.fulfill({json:{id:50,name:'Test Director',biography:'A filmmaker.',place_of_birth:'Rome',movie_credits:{crew:[...films,films[0]]}}});
      if(u.pathname.endsWith('/search/person'))return route.fulfill({json:{results:[{id:50,name:'Test Director',known_for_department:'Directing'}]}});
      if(/\/movie\/\d+$/.test(u.pathname)) {
        const id=Number(u.pathname.split('/').pop());if(id===9001 || id===9003)await new Promise(r=>setTimeout(r,240));
        return route.fulfill({json:{id,title:films.find(f=>f.id===id)?.title || 'Film '+id,release_date:'2000-01-01',overview:'Synopsis',vote_average:7,genres:[],credits:{cast:Array.from({length:14},(_,i)=>({id:i+1,name:'Actor '+i})),crew:[{id:50,name:'Test Director',job:'Director'}]}}});
      }
      if(u.pathname.endsWith('/videos'))return route.fulfill({json:{results:[]}});
    }
    return route.abort();
  });
  await page.addInitScript(()=>localStorage.setItem('ratingMigrated10','1'));
  await page.goto(origin);await page.waitForSelector('.custom-select-trigger',{state:'attached'});
  assert.deepEqual(errors,[],'Startup errors');
  for(const width of [320,390,1280]) {
    await page.setViewportSize({width,height:844});await page.evaluate(()=>location.hash='#catalogue');
    await page.waitForSelector('#view-catalogue',{state:'visible'});
    const header=await page.evaluate(()=>{
      const title=document.querySelector('.app-title').getBoundingClientRect(),add=document.querySelector('.header-add').getBoundingClientRect();
      const hit=document.elementFromPoint(add.left+add.width/2,add.top+add.height/2);
      const links=document.querySelectorAll('.nav-link'),first=links[0].getBoundingClientRect(),last=links[links.length-1].getBoundingClientRect();
      return {vertical:Math.abs((title.top+title.height/2)-(add.top+add.height/2)),titleCentre:Math.abs((title.left+title.width/2)-innerWidth/2),hit:!!hit.closest('.header-add'),navFits:first.left>=0 && last.right<=innerWidth};
    });
    assert.equal(header.hit,true,`Add control receives taps at ${width}px`);assert.ok(header.vertical<2,`Add alignment at ${width}px`);assert.ok(header.titleCentre<2,`Title centring at ${width}px`);assert.equal(header.navFits,true,`Navigation fits at ${width}px`);
    await page.click('.header-add');await page.waitForSelector('#view-add',{state:'visible'});assert.equal(await page.evaluate(()=>location.hash),'#add');
  }
  console.log('PASS: header Add control alignment, hit target and routing');
  const dataChecks=await page.evaluate(async()=>{
    const checks={};
    await MovieDB.importData(JSON.stringify([{title:'Original',tmdbId:100,year:'2000',genres:['Drama'],directors:['Test Director'],rating:8,
      rewatches:3,crew:[{name:'Test Director',personId:50,roles:['Director']}],directorCredits:[{name:'Test Director',personId:50}],creditsFetchedAt:new Date().toISOString(),
      cast:Array.from({length:14},(_,i)=>({name:'Actor '+i})),voteCount:3000,imdbId:'tt1234567',overview:'Synopsis',backdrop:'https://example.invalid/plate',voteAverage:7}]));
    let [m]=await MovieDB.getAllMovies();
    await MovieDB.updateMovie({id:m.id,notes:'Updated'});m=await MovieDB.getMovie(m.id);
    checks.partialEdit=m.rewatches===3 && m.crew.length===1 && m.voteCount===3000;
    localStorage.setItem('manualTop10',JSON.stringify([m.id]));MovieDB.preferenceChanged('manualTop10');
    localStorage.setItem('manualTop25',JSON.stringify([m.id]));MovieDB.preferenceChanged('manualTop25');
    await MovieDB.setDirectorFavourite(50,true);UI.setRatingScale('five');
    const backup=await MovieDB.exportData();
    await MovieDB.clearData();await MovieDB.importData(backup);
    [m]=await MovieDB.getAllMovies();
    checks.backup=JSON.parse(localStorage.manualTop10)[0]===m.id && JSON.parse(localStorage.manualTop25)[0]===m.id && UI.isFiveStar() && (await MovieDB.getDirectorFavourites())[50].favourite;
    checks.credentialsAbsent=!backup.includes('gh_sync_token');
    try {await MovieDB.importData('[null]');checks.validation=false;}catch(_){checks.validation=(await MovieDB.getAllMovies()).length===1;}
    await MovieDB.updateMovie({id:m.id,rating:9});
    const old=JSON.parse(backup);old.movies[0].rating=2;old.movies[0].updatedAt='2001-01-01';
    await MovieDB.addMovie({title:'Local only',rating:7});
    await MovieDB.mergeData(old);
    checks.mergeLatest=(await MovieDB.getAllMovies()).some(m=>m.tmdbId==='100' && m.rating===9) && (await MovieDB.getAllMovies()).some(m=>m.title==='Local only');
    m=(await MovieDB.getAllMovies()).find(m=>m.tmdbId==='100');await MovieDB.deleteMovie(m.id);await MovieDB.mergeData(old);
    checks.deletion=!(await MovieDB.getAllMovies()).some(m=>m.tmdbId==='100');
    const oldAdd=IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add=function(...args){const req=oldAdd.apply(this,args),tx=this.transaction;req.addEventListener('success',()=>tx.abort());return req;};
    try {await MovieDB.addMovie({title:'Aborted'});checks.commit=false;}catch(_){checks.commit=!(await MovieDB.getAllMovies()).some(m=>m.title==='Aborted');}finally{IDBObjectStore.prototype.add=oldAdd;}
    await MovieDB.importData(backup);
    checks.recovery=(await MovieDB.restoreRecovery())===1;
    await MovieDB.importData(backup);UI.setRatingScale('ten');
    return checks;
  });
  for(const [name,ok] of Object.entries(dataChecks))assert.equal(ok,true,name);
  await page.evaluate(()=>location.hash='#stats');await page.waitForSelector('#view-stats',{state:'visible'});
  assert.equal(await page.locator('#director-marathons-wrap, .director-marathons').count(),0);
  assert.doesNotMatch(await page.locator('#stats-container').innerText(),/Complete the Director/i);
  console.log('PASS: Stats no longer renders Complete the Director');
  assert.equal(await page.evaluate(async()=>{
    const backup=await MovieDB.exportData();
    const results=await Promise.allSettled([MovieDB.mergeData(backup),MovieDB.addMovie({title:'Concurrent addition'})]);
    const preserved=(await MovieDB.getAllMovies()).some(m=>m.title==='Concurrent addition');
    const concurrent=(await MovieDB.getAllMovies()).find(m=>m.title==='Concurrent addition');if(concurrent)await MovieDB.deleteMovie(concurrent.id);
    return preserved && results[1].status==='fulfilled';
  }),true,'Concurrent changes preserved');
  console.log('PASS: atomic writes, validation, metadata edits, rankings/favourites backup, latest edits, deletions and recovery');

  await page.evaluate(async()=>{const [m]=await MovieDB.getAllMovies();location.hash='#detail/'+m.id;});
  await page.waitForSelector('#detail-edit');await page.click('#detail-edit');await page.fill('#form-notes','Edited from form');
  await page.locator('#movie-form').evaluate(f=>f.requestSubmit());await page.waitForFunction(()=>location.hash==='#catalogue');
  assert.equal(await page.evaluate(async()=>{const [m]=await MovieDB.getAllMovies();return m.notes==='Edited from form' && m.rewatches===3 && m.crew.length===1 && m.voteCount===3000;}),true);
  console.log('PASS: actual edit form preserves metadata');

  await page.evaluate(()=>location.hash='#directors');await page.waitForSelector('.director-card');
  await page.click('.director-card-main');await page.waitForSelector('#director-progress');
  assert.equal(await page.locator('#director-progress').getAttribute('max'),'3');
  assert.equal(await page.locator('#director-progress').getAttribute('value'),'1');
  assert.equal(await page.locator('#director-filmography-list .director-film-row').count(),5);
  await page.click('[data-director-filter="upcoming"]');assert.match(await page.locator('#director-filmography-list').innerText(),/Future film/);
  await page.click('[data-director-filter="undated"]');assert.match(await page.locator('#director-filmography-list').innerText(),/Undated film/);
  await page.click('[data-director-filter="unseen"]');assert.equal(await page.locator('#director-filmography-list .director-film-row').count(),2);
  await page.locator('#director-filmography-list [data-director-add="102"]').click();
  await page.waitForSelector('[data-director-filter="watchlist"]');await page.click('[data-director-filter="watchlist"]');
  assert.match(await page.locator('#director-filmography-list').innerText(),/Rare short/);
  await page.click('[data-director-filter="watched"]');await page.locator('#director-filmography-list a').click();
  await page.waitForSelector('#detail-back');await page.click('#detail-back');await page.waitForSelector('#director-progress');
  await page.evaluate(()=>location.hash='#directors');await page.waitForSelector('.director-card');
  await context.setOffline(true);await page.click('.director-card-main');await page.waitForSelector('#director-progress');
  await context.setOffline(false);
  console.log('PASS: Directors statistics, complete rare-film credits, filters, quick add, return navigation and offline cache');
  if(process.env.SCREENSHOT_DIR){fs.mkdirSync(process.env.SCREENSHOT_DIR,{recursive:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(process.env.SCREENSHOT_DIR,'directors-mobile.png'),fullPage:true});}

  assert.equal(await page.evaluate(()=>{
    const node=document.createElement('div');node.innerHTML=Stats.render(Stats.compute([{title:'Test',year:'2000',genres:['<img src=x onerror="window.xss=1">'],directors:['<img src=x onerror="window.xss=1">'],rating:8}]));
    return !node.querySelector('img[src="x"]');
  }),true);
  await page.locator('.nav-link[data-view="directors"]').focus();
  await page.evaluate(async()=>{
    await Posters.openBoard([{title:'"><img src=x onerror="window.xss=1">',directors:[],genres:[]},{title:'Second'},{title:'Third'}]);
  });
  assert.equal(await page.locator('#poster-deck img[src="x"]').count(),0);
  assert.equal(await page.locator('#poster-deck .pd-slide img').count(),1);
  assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('pd-close')),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#poster-deck')),true);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.dataset.view),'directors');
  assert.equal(await page.evaluate(()=>Number(Stats.compute([{rating:10,genres:[],directors:[]},{rating:0,genres:[],directors:[]}]).avgRating)),10);
  await page.clock.setFixedTime(new Date('2026-09-29T12:00:00+02:00'));
  assert.equal(await page.evaluate(()=>Stats.compute([{title:'Sunday',genres:[],directors:[],rating:8,dateAdded:'2026-09-27T10:00:00Z'}]).recent.weekCount),0);
  const ids=await page.evaluate(async()=>{
    await MovieDB.importData(JSON.stringify([9001,9002].map(id=>({title:'Film '+id,tmdbId:id,genres:[],directors:[]}))));return (await MovieDB.getAllMovies()).map(m=>m.id);
  });
  await page.evaluate(id=>location.hash='#detail/'+id,ids[0]);await page.waitForTimeout(50);
  await page.evaluate(id=>location.hash='#detail/'+id,ids[1]);await page.waitForTimeout(400);
  assert.equal((await page.locator('.dt-title').textContent()).trim(),'Film 9002');
  await page.evaluate(async()=>{await MovieDB.clearData();location.hash='#add';});await page.waitForSelector('#view-add',{state:'visible'});
  await page.evaluate(()=>{document.getElementById('search-results').innerHTML=UI.renderSearchResult({id:9003,title:'Duplicate'});const b=document.querySelector('.search-result-watchlist-btn');b.click();b.click();});
  await page.waitForTimeout(600);assert.equal(await page.evaluate(async()=>(await MovieDB.getAllMovies()).length),1);
  console.log('PASS: safe text, unrated average, local week boundary, detail navigation race and duplicate prevention');

  await page.evaluate(async()=>{await MovieDB.importData(JSON.stringify([{title:'A',rating:8},{title:'B',rating:7}]));location.hash='#chart';});
  await page.waitForSelector('#view-chart',{state:'visible'});await page.click('.chart-tab[data-tab="ranked"]');await page.click('#launch-tournament');
  await page.locator('#chart-list .tournament-card').first().click();await page.evaluate(()=>location.hash='#stats');await page.waitForTimeout(800);
  for(const width of [320,390,1280]){
    await page.setViewportSize({width,height:844});
    for(const view of ['catalogue','watchlist','chart','inventory','add','stats','directors']){
      await page.evaluate(v=>location.hash='#'+v,view);await page.waitForSelector('#view-'+view,{state:'visible'});await page.waitForTimeout(60);
      const overflow=await page.evaluate(()=>({over:document.documentElement.scrollWidth>innerWidth,elements:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1 && e.getBoundingClientRect().width).slice(0,12).map(e=>e.className)}));
      assert.equal(overflow.over,false,`${view} overflow at ${width}: ${overflow.elements.join(', ')}`);
    }
  }
  await page.evaluate(()=>localStorage.setItem('savedSuggestions','{'));await page.reload();await page.waitForSelector('.custom-select-trigger',{state:'attached'});
  assert.deepEqual(errors,[],'Browser errors');
  console.log('PASS: leaving tournament, mobile/desktop navigation and corrupt cache startup');
  const migration=await browser.newContext({serviceWorkers:'block'}), old=await migration.newPage();
  await migration.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await old.goto(origin+'/manifest.json');
  await old.evaluate(()=>new Promise((resolve,reject)=>{
    const req=indexedDB.open('movieCatalogue',1);
    req.onupgradeneeded=()=>{const s=req.result.createObjectStore('movies',{keyPath:'id',autoIncrement:true});for(const k of ['tmdbId','title','rating','dateAdded','year'])s.createIndex(k,k);s.add({id:42,title:'Legacy film',tmdbId:777,rating:8});};
    req.onsuccess=()=>{req.result.close();localStorage.setItem('manualTop10','[42]');localStorage.setItem('ratingMigrated10','1');resolve();};req.onerror=()=>reject(req.error);
  }));
  await old.goto(origin);await old.waitForSelector('.custom-select-trigger',{state:'attached'});
  assert.equal(await old.evaluate(async()=>{const [m]=await MovieDB.getAllMovies();return m.id===42 && m.tmdbId==='777' && JSON.parse(localStorage.manualTop10)[0]===42 && !!m.uid;}),true);
  await migration.close();console.log('PASS: original database migration preserves movie IDs and rankings');
  const offline=await browser.newContext(), offlinePage=await offline.newPage();
  await offline.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await offlinePage.goto(origin);await offlinePage.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await offlinePage.evaluate(async()=>{await MovieDB.addMovie({title:'Offline film',directors:['Offline Director'],rating:8});});
  await offline.setOffline(true);await offlinePage.reload();await offlinePage.waitForSelector('.custom-select-trigger',{state:'attached'});
  await offlinePage.locator('.nav-link[data-view="directors"]').click();await offlinePage.waitForSelector('.director-card');
  assert.match(await offlinePage.locator('.director-card').innerText(),/Offline Director/i);
  await offline.close();console.log('PASS: service worker reloads the complete app and new Directors script offline');
}
main().then(async()=>{await browser?.close();server.close();}).catch(async error=>{console.error(error);await browser?.close();server.close();process.exitCode=1;});
