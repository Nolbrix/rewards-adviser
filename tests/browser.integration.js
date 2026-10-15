// Real extension + loopback server in disposable test profiles; no Microsoft session used.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process'),readline=require('node:readline');
const core=require('../extension/core.js');
const packages=process.env.REWARDS_TEST_PACKAGES||path.join(require('node:os').homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(packages,'playwright'));
const root=path.resolve(__dirname,'..'),work=path.join(root,'work');fs.mkdirSync(work,{recursive:true});const artifacts=process.env.REWARDS_TEST_OUTPUTS||path.join(work,'test-artifacts');fs.mkdirSync(artifacts,{recursive:true});
const relayPort=Number(process.env.REWARDS_TEST_RELAY_PORT||18744),relayBase=`http://127.0.0.1:${relayPort}`;
test('real MV3 panel and parser sync synthetic progress across three slots and export safe dumps', {timeout:90000},async()=>{
 const temp=fs.mkdtempSync(path.join(work,'integration-'));let context,server;
 try{
  server=spawn(process.env.REWARDS_TEST_PYTHON||'python',[path.join(__dirname,'serve_fixture.py'),path.join(temp,'state')],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const token=await new Promise((resolve,reject)=>{let error='';server.stderr.on('data',s=>error+=s);server.once('exit',code=>reject(new Error(`Test relay failed (${code}): ${error}`)));readline.createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line).token));setTimeout(()=>reject(new Error('Test relay startup timed out')),5000).unref();});
  const api=async(route,body)=>{const r=await fetch(relayBase+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));return data;};
  fs.mkdirSync(path.join(temp,'profile','Default'),{recursive:true});fs.writeFileSync(path.join(temp,'profile','Default','Preferences'),JSON.stringify({extensions:{ui:{developer_mode:true}}}));
  const source=process.env.REWARDS_TEST_EXTENSION_ROOT?path.resolve(process.env.REWARDS_TEST_EXTENSION_ROOT):path.join(root,'extension'),extension=path.join(temp,'package');
  const installedManifest=JSON.parse(fs.readFileSync(path.join(source,'manifest.json'),'utf8')),popup=installedManifest.action.default_popup,assetPrefix=installedManifest.background.service_worker.startsWith('extension/')?'extension/':'';
  const safeCopy={recursive:true,filter:file=>!['local-link.json','local-link.tmp'].includes(path.basename(file))};
  if(assetPrefix){fs.mkdirSync(extension);fs.copyFileSync(path.join(source,'manifest.json'),path.join(extension,'manifest.json'));fs.cpSync(path.join(source,'extension'),path.join(extension,'extension'),safeCopy);}else fs.cpSync(source,extension,safeCopy);
  for(const relative of ['manifest.json',assetPrefix+'background.js']){const file=path.join(extension,relative);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('http://127.0.0.1:18743',relayBase));}
  fs.writeFileSync(path.join(extension,assetPrefix,'local-link.json'),JSON.stringify({app:'rewards-realtime-adviser',token}));
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{...(process.env.REWARDS_TEST_BROWSER?{executablePath:process.env.REWARDS_TEST_BROWSER}:{channel:'chromium'}),headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:780,height:650}});
  let loadedExtension;
  if(process.env.REWARDS_TEST_CDP_LOAD){const session=await context.browser().newBrowserCDPSession();loadedExtension=await session.send('Extensions.loadUnpacked',{path:extension});const startPage=await context.newPage();await startPage.goto(`chrome-extension://${loadedExtension.id}/${popup}`);}
  let worker=context.serviceWorkers()[0];if(!worker)worker=await context.waitForEvent('serviceworker',{timeout:15000});
  const errors=[],sourceErrors=[],extensionHost=new URL(worker.url()).hostname;context.on('weberror',error=>{const url=error.page()?.url();if(!url||url.startsWith(`chrome-extension://${extensionHost}/`))errors.push(error.error().message);else sourceErrors.push({origin:new URL(url).origin,message:error.error().message});});
  const id=new URL(worker.url()).hostname,page=await context.newPage();await page.goto(`chrome-extension://${id}/${popup}`);
  let searchReady=false;
  await context.route('https://www.bing.com/**',route=>{
   if(!route.request().url().includes('/rewardsapp/flyoutdata'))return route.fulfill({contentType:'text/html',body:'<script>var _model = {"UserEmail":"alice@example.com"};</script>'});
   const data={IsAuthenticated:searchReady&&!route.request().serviceWorker(),UserId:'synthetic-search-user',FlyoutResult:{}};
   data.FlyoutResult.UserStatus={AvailablePoints:40590,Counters:{PCSearch:[{OfferId:'pc',PointProgress:21,PointProgressMax:60}]}};
   data.FlyoutResult.Layout={Controls:{body:[{CustomProperties:{Counter:'PcCombined'}}]}};
   return route.fulfill({json:data});
  });
  await page.getByRole('button',{name:/^(Impostazioni|Settings)$/,exact:true}).click();await page.locator('#config-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#token').inputValue(),token);
  const choices=await page.locator('#profile option').evaluateAll(nodes=>nodes.map(n=>n.value));assert.deepEqual(choices,['','reader1','reader2','reader3','panel','custom']);
  for(const slot of [1,2,3]){await page.locator('#profile').selectOption('reader'+slot);assert.equal(await page.locator('#email').inputValue(),'');assert.equal(await page.locator('#slot').inputValue(),String(slot));assert.equal(await page.locator('#auto-refresh').isChecked(),true);assert.equal(await page.locator('#coordinator').isChecked(),false);}
  await page.locator('#profile').selectOption('panel');assert.equal(await page.locator('#slot').inputValue(),'');assert.equal(await page.locator('#coordinator').isChecked(),true);
  await page.locator('#profile').selectOption('reader1');await page.locator('#browser').selectOption('Chrome');await page.locator('#email').fill('alice@example.com');
  assert.equal(await page.locator('#advanced-config').evaluate(el=>el.open),false);assert.equal(await page.locator('#email').isVisible(),true);assert.equal(await page.locator('#browser').isVisible(),true);assert.equal(await page.locator('#token').inputValue(),token);
  await page.getByRole('button',{name:/^(Salva e collega|Save and connect)$/}).click();
  await page.waitForFunction(()=>!document.querySelector('#config-dialog').open||document.querySelector('#config-error').textContent);
  assert.equal(await page.locator('#config-error').textContent(),'');
  await page.locator('#config-dialog').waitFor({state:'hidden'});
  const now=Date.now(),date=core.dayKey(now),[year,month,day]=date.split('-');
  const data={userStatus:{availablePoints:12345,email:'alice@example.com',counters:{pcSearch:[{pointProgress:30,pointProgressMax:90}],mobileSearch:[{pointProgress:15,pointProgressMax:60}]}},dailySetPromotions:{[`${Number(month)}/${Number(day)}/${year}`]:[{offerId:'today',title:'Quiz del giorno',points:20,complete:false}]},morePromotions:[{offerId:'bonus',title:'Bonus di prova',points:50,complete:false}]};
  await context.route('https://rewards.bing.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Synthetic Rewards fixture</title><h1>Pagina di prova sintetica</h1><script>var dashboard = '+JSON.stringify(data)+';</script>'}));
  const rewards=await context.newPage();await rewards.goto('https://rewards.bing.com/?ref=rewardspanel');
  const probe=await page.evaluate(async()=>{const tabs=await chrome.tabs.query({url:'https://rewards.bing.com/*'});const tab=tabs[0];if(!tab)return {tabs:[]};const result={url:tab.url,permissions:await chrome.permissions.getAll()};try{result.scope=await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({core:typeof RewardsCore,parser:typeof RewardsParser,loaded:!!globalThis.__rewardsAdviserLoaded,parse:typeof RewardsParser==='object'?(()=>{try{return RewardsParser.readDocument(document);}catch(e){return {error:e.message};}})():null})});}catch(e){result.error=e.message;}return result;});
  if(probe.error){
   assert.match(probe.error,/extensions gallery cannot be scripted/);
   console.log('Source-page auto-injection cannot be validated in this Edge test environment; exercising the real parser and relay through the trusted extension page.');
   await page.addScriptTag({url:`chrome-extension://${id}/${assetPrefix}parser.js`});
   const response=await page.evaluate(async html=>chrome.runtime.sendMessage({type:'CAPTURE',snapshot:RewardsParser.readDocument(new DOMParser().parseFromString(html,'text/html'))}),'<!doctype html><script>var dashboard = '+JSON.stringify(data)+';</script>');
   assert.equal(response.ok,true);assert.equal(response.data.accepted,true);
  }
  await page.waitForFunction(()=>document.querySelector('[data-account="1"] .balance strong')?.textContent?.replace(/[.,]/g,'')==='12345',null,{timeout:10000}).catch(async()=>{const s=await api('/api/state');const storage=await page.evaluate(()=>chrome.storage.local.get(['localSnapshot','connection']));throw new Error('Capture diagnostic: '+JSON.stringify({account:s.accounts[0],storage,errors,probe}));});
  assert.equal((await api('/api/state')).accounts[0].snapshot.account.email,'alice@example.com');
  assert.equal(await page.locator('[data-account="1"] .remaining strong').textContent(),'175');
  // Regression for the modern page supplied by the user. The shipped fixture is sanitized.
  await page.addScriptTag({url:`chrome-extension://${id}/${assetPrefix}parser.js`});
  searchReady=true;await page.evaluate(()=>chrome.storage.local.set({searchCache:null,searchAttempt:0}));
  const modernHtml=fs.readFileSync(path.join(root,'tests/fixtures/rewards-next-dashboard.html'),'utf8').replaceAll('reader@example.com','alice@example.com').replaceAll('10/15/2026',`${Number(month)}/${Number(day)}/${year}`);
  const modern=await page.evaluate(async html=>chrome.runtime.sendMessage({type:'CAPTURE',snapshot:RewardsParser.readDocument(new DOMParser().parseFromString(html,'text/html'))}),modernHtml);
  assert.equal(modern.ok,true);assert.equal(modern.data.accepted,true);
  await page.waitForFunction(()=>document.querySelector('[data-account="1"] .balance strong')?.textContent?.replace(/[.,]/g,'')==='40590');
  assert.equal(await page.locator('[data-account="1"] .remaining strong').textContent(),'178');
  assert.match(await page.locator('[data-detail="1-search"] summary').textContent(),/21 \/ 60/);assert.equal(await page.locator('[data-detail="1-desktop"],[data-detail="1-mobile"]').count(),0);
  await page.locator('[data-detail="1-daily"] summary').click();
  assert.equal(await page.locator('[data-detail="1-daily"] .task').count(),3);
  await page.locator('[data-detail="1-extra"] summary').click();
  assert.match(await page.locator('[data-detail="1-extra"]').textContent(),/109 pt/);
  await page.screenshot({path:path.join(artifacts,'Verifica-Saldo-Rewards-Adviser.png'),fullPage:true});
  for(const slot of [2,3])await api('/api/heartbeat',{clientId:'synthetic-reader-'+slot,config:{slot,alias:'Account prova '+slot,browser:slot===2?'Chrome':'Brave',email:'',coordinator:false}});
  await api('/api/snapshot',{clientId:'synthetic-reader-2',snapshot:{date,observedAt:now,account:{email:'bob@example.com'},balance:88,coverage:{daily:true,extra:true,search:true,mobile:true},diagnostics:{recognized:true,method:'synthetic'},activities:[{id:'done',title:'Completato',category:'daily',total:10,earned:10,status:'complete'}]}});
  await page.waitForFunction(()=>document.querySelector('[data-account="2"] .balance strong')?.textContent==='88',{timeout:10000});
  assert.equal(await page.locator('.account-card').count(),3);
  await page.locator('[data-detail="1-phone"] summary').click();await page.locator('#phone-1-manual-checkin').selectOption('incomplete');
  await page.waitForFunction(()=>document.querySelector('#phone-1-manual-checkin')?.value==='incomplete');
  await page.locator('#add-title-1').fill('Attività test mobile');await page.locator('#add-points-1').fill('5');await page.locator('.phone-add:not(.phone-read)[data-slot="1"] button').click();
  await page.waitForFunction(()=>document.querySelector('[data-account="1"] .remaining strong')?.textContent==='183');
  assert.ok((await api('/api/state')).accounts[0].manual.some(a=>a.title==='Attività test mobile'&&a.source==='manual'&&a.earned===0));
  await page.locator('#read-points-1').fill('12');await page.locator('.phone-read[data-slot="1"] button').click();
  await page.waitForFunction(()=>document.querySelector('[data-account="1"] .remaining strong')?.textContent==='201');
  assert.equal((await api('/api/state')).accounts[0].manual.find(a=>a.id==='manual-read').earned,12);
  await page.locator('#phone-1-manual-checkin').selectOption('complete');
  await page.waitForFunction(()=>document.querySelector('#phone-1-manual-checkin')?.value==='complete');assert.equal((await api('/api/state')).accounts[0].manual.find(a=>a.id==='manual-read').earned,12);
  await page.screenshot({path:path.join(artifacts,'Verifica-Letture-Rewards-Adviser.png'),fullPage:true});
  const downloadPromise=page.waitForEvent('download');await page.locator('[data-action="dump"][data-slot="1"]').click();const download=await downloadPromise;
  const dump=fs.readFileSync(await download.path(),'utf8');assert.ok(!dump.includes(token));assert.ok(!dump.includes('alice@example.com'));
  const alarms=await page.evaluate(()=>chrome.alarms.getAll());assert.ok(alarms.some(a=>a.name==='rewards-reminder'&&a.periodInMinutes===10));
  const preview=await context.newPage();await preview.goto(relayBase+'/preview/');
  assert.match(await preview.locator('#mode').textContent(),/ESEMPI|EXAMPLES/);assert.equal(await preview.locator('.account-card').count(),3);
  await preview.addScriptTag({path:path.join(extension,assetPrefix,'parser.js')});
  const domResult=await preview.evaluate(()=>RewardsParser.readDocument(new DOMParser().parseFromString('<span data-rewards-balance="12.345"></span><section><h2>Set giornaliero</h2><article data-offer-id="dom-quiz" data-complete="false" data-points="10"><h3>Quiz italiano</h3></article></section>','text/html')));
  assert.equal(domResult.balance,12345);assert.equal(domResult.activities[0].category,'daily');assert.equal(domResult.activities[0].status,'incomplete');assert.equal(domResult.coverage.daily,false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=780),true);
  await preview.setViewportSize({width:1180,height:850});
  await preview.screenshot({path:path.join(artifacts,'Anteprima-Rewards-Adviser.png'),fullPage:true});
  await page.getByRole('button',{name:/^(Impostazioni|Settings)$/,exact:true}).click();await page.locator('#config-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#profile').inputValue(),'custom');
  await page.screenshot({path:path.join(artifacts,'Configurazione-Semplice-Rewards-Adviser.png'),fullPage:true});
  if(sourceErrors.length)console.log('External browser-page errors (separate from the extension UI): '+JSON.stringify(sourceErrors));
  assert.deepEqual(errors,[]);
 }finally{if(context)await context.close();if(server){server.kill();await new Promise(resolve=>server.once('exit',resolve));}fs.rmSync(temp,{recursive:true,force:true});}
});
