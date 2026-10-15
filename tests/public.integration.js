const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),{spawn,execFileSync}=require('node:child_process');
const {chromium}=process.env.REWARDS_TEST_PACKAGES?require(path.join(process.env.REWARDS_TEST_PACKAGES,'playwright')):require('playwright');
const root=path.resolve(__dirname,'..'),work=path.join(root,'work');
const relayBase=`http://127.0.0.1:${Number(process.env.REWARDS_TEST_RELAY_PORT||18744)}`;
test('a clean shared package loads, configures a generic reader and detects its own Rewards account',{timeout:60000},async()=>{
 const temp=fs.mkdtempSync(path.join(work,'public-integration-')),publicRoot=path.join(temp,'package'),python=process.env.REWARDS_TEST_PYTHON||'python';
 let server,context;
 try{
  fs.mkdirSync(publicRoot);const archive=path.join(temp,'public.zip');
  execFileSync(python,['-c','import sys,zipfile;from pathlib import Path;sys.path.insert(0,str(Path(sys.argv[1])/"companion"));from distribution import build_public_package;build_public_package(Path(sys.argv[1]),Path(sys.argv[2]));zipfile.ZipFile(sys.argv[2]).extractall(sys.argv[3])',root,archive,publicRoot],{windowsHide:true});
  for(const relative of ['manifest.json','extension/background.js']){const file=path.join(publicRoot,relative);fs.writeFileSync(file,fs.readFileSync(file,'utf8').replaceAll('http://127.0.0.1:18743',relayBase));}
  server=spawn(python,[path.join(__dirname,'serve_fixture.py'),path.join(temp,'state'),publicRoot],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const token=await new Promise((resolve,reject)=>{let error='';server.stderr.on('data',s=>error+=s);server.once('exit',code=>reject(new Error('Public relay startup failed: '+code+' '+error)));readline.createInterface({input:server.stdout}).once('line',line=>resolve(JSON.parse(line).token));setTimeout(()=>reject(new Error('Public relay startup timeout')),5000).unref();});
  fs.writeFileSync(path.join(publicRoot,'extension/local-link.json'),JSON.stringify({app:'rewards-realtime-adviser',token}));
  fs.mkdirSync(path.join(temp,'profile/Default'),{recursive:true});fs.writeFileSync(path.join(temp,'profile/Default/Preferences'),JSON.stringify({extensions:{ui:{developer_mode:true}}}));
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{executablePath:process.env.REWARDS_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging',`--disable-extensions-except=${publicRoot}`,`--load-extension=${publicRoot}`],viewport:{width:780,height:720}});
  await context.route('https://www.bing.com/**',route=>{
   if(!route.request().url().includes('/rewardsapp/flyoutdata'))return route.fulfill({contentType:'text/html',body:'<script>var _model = {"UserEmail":"reader@example.com"};</script>'});
   const data={IsAuthenticated:true,UserId:'public-fixture-search-user',FlyoutResult:{}};
   data.FlyoutResult.UserStatus={AvailablePoints:40590,Counters:{PCSearch:[{OfferId:'pc',PointProgress:21,PointProgressMax:60}]}};
   data.FlyoutResult.Layout={Controls:{body:[{CustomProperties:{Counter:'PcCombined'}}]}};
   return route.fulfill({json:data});
  });
  const session=await context.browser().newBrowserCDPSession(),extension=await session.send('Extensions.loadUnpacked',{path:publicRoot});
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`chrome-extension://${extension.id}/extension/ui/index.html`);
  await page.getByRole('button',{name:/^(Impostazioni|Settings)$/,exact:true}).click();await page.locator('#config-dialog').waitFor({state:'visible'});
  assert.equal(await page.locator('#token').inputValue(),token);assert.match(await page.locator('#profile').textContent(),/Lettore 1|Reader 1/);assert.ok(!/PersonalFixture|PrivateFixture/i.test(await page.locator('body').textContent()));
  await page.locator('#profile').selectOption('reader1');assert.equal(await page.locator('#email').inputValue(),'');assert.equal(await page.locator('#slot').inputValue(),'1');assert.equal(await page.locator('#alias').inputValue(),'Account 1');
  await page.getByRole('button',{name:/^(Salva e collega|Save and connect)$/}).click();await page.waitForFunction(()=>!document.querySelector('#config-dialog').open||document.querySelector('#config-error').textContent);assert.equal(await page.locator('#config-error').textContent(),'');
  await page.addScriptTag({url:`chrome-extension://${extension.id}/extension/parser.js`});
  const date=await page.evaluate(()=>RewardsCore.dayKey()),[year,month,day]=date.split('-');
  const html=fs.readFileSync(path.join(root,'tests/fixtures/rewards-next-dashboard.html'),'utf8').replaceAll('10/15/2026',`${Number(month)}/${Number(day)}/${year}`);
  const response=await page.evaluate(async html=>chrome.runtime.sendMessage({type:'CAPTURE',snapshot:RewardsParser.readDocument(new DOMParser().parseFromString(html,'text/html'))}),html);assert.equal(response.ok,true);assert.equal(response.data.accepted,true);
  await page.waitForFunction(()=>document.querySelector('[data-account="1"] .balance strong')?.textContent?.replace(/[.,]/g,'')==='40590');assert.equal(await page.locator('[data-account="1"] .account-email').textContent(),'reader@example.com');assert.equal(await page.locator('[data-account="1"] .remaining strong').textContent(),'178');assert.match(await page.locator('[data-detail="1-search"] summary').textContent(),/21 \/ 60/);
  await page.getByRole('button',{name:/^(Impostazioni|Settings)$/,exact:true}).click();await page.locator('#config-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#profile').inputValue(),'reader1');await page.locator('#profile').selectOption('panel');assert.equal(await page.locator('#slot').inputValue(),'');assert.equal(await page.locator('#coordinator').isChecked(),true);assert.equal(await page.locator('#email').inputValue(),'');
  assert.deepEqual(errors,[]);
 }finally{
  if(context)await context.close();if(server){server.kill();await new Promise(resolve=>server.once('exit',resolve));}
  assert.ok(path.resolve(temp).startsWith(path.resolve(work)+path.sep));fs.rmSync(temp,{recursive:true,force:true});
 }
});
