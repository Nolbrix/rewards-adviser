const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {chromium}=process.env.REWARDS_TEST_PACKAGES?require(path.join(process.env.REWARDS_TEST_PACKAGES,'playwright')):require('playwright');
const root=path.resolve(__dirname,'..');
test('the saved modern Rewards HTML is recognized without executing page scripts',{timeout:30000},async()=>{
 const source=process.env.REWARDS_SAVED_HTML||path.join(__dirname,'fixtures','rewards-next-dashboard.html');
 const html=fs.readFileSync(source,'utf8');
 const browser=await chromium.launch({executablePath:process.env.REWARDS_TEST_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 try{
  const context=await browser.newContext({offline:true});await context.route('**/*',route=>route.abort());
  const page=await context.newPage();await page.addScriptTag({path:path.join(root,'extension/core.js')});await page.addScriptTag({path:path.join(root,'extension/parser.js')});
  const result=await page.evaluate(html=>RewardsParser.readDocument(new DOMParser().parseFromString(html,'text/html'),{now:Date.parse('2026-10-15T10:00:00Z'),timezone:'Europe/Rome'}),html);
  assert.equal(result.diagnostics.recognized,true);assert.equal(result.balance,40590);
  if(process.env.REWARDS_SAVED_HTML)assert.equal(result.account.email,'alice@example.com');
  const daily=result.activities.filter(a=>a.category==='daily');assert.equal(daily.length,3);
  assert.deepEqual(daily.map(a=>[a.title,a.total,a.earned,a.status]),[['Prossimi eventi vicino a me',10,0,'incomplete'],['Chicago Foliage Ventoso',10,0,'incomplete'],['Maestà di Borobudur?',10,0,'incomplete']]);
  const claim=result.activities.find(a=>a.id==='pointsclaim');assert.equal(claim.category,'claim');assert.equal(claim.total,109);assert.equal(claim.earned,0);
  assert.ok(!result.activities.some(a=>a.id==='pointsclaim'&&a.category==='extra'));
  assert.equal(result.coverage.search,false);assert.equal(result.coverage.mobile,false);
 }finally{await browser.close();}
});
