const {test}=require('node:test'),assert=require('node:assert/strict');
let reader={};try{reader=require('../extension/reader.js');}catch{}
const core=require('../extension/core.js');
const html=(email='alice@example.com',balance=100)=>'<script>var dashboard = '+JSON.stringify({userStatus:{email,availablePoints:balance},dailySetPromotions:{[core.dayKey()]:[{offerId:'daily',title:'Daily',points:10,complete:false}]}})+';</script>';
function fixture(){const store={},created=[],updated=[],executed=[],tabs=[];const browser={storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,store[k]])),set:async data=>Object.assign(store,data)}},tabs:{query:async()=>tabs,get:async id=>{const t=tabs.find(t=>t.id===id);if(!t)throw Error('Closed');return t;},create:async props=>{created.push(props);const t={id:77,url:props.url,status:'complete'};tabs.push(t);return t;},update:async(id,props)=>{updated.push({id,...props});}},scripting:{executeScript:async options=>{executed.push(options);return [{result:{html:html(),url:'https://rewards.bing.com/'}}];}}};return {browser,store,tabs,created,updated,executed};}
const response=(body,url='https://rewards.bing.com/')=>({ok:true,url,text:async()=>body});

test('worker reads new authenticated data without relying on any Rewards tab timer',async()=>{
 assert.equal(typeof reader.createReader,'function');const f=fixture(),calls=[];
 const r=reader.createReader(f.browser,async(url,options)=>{calls.push({url,options});return response(html());});
 const result=await r.read('alice@example.com');assert.equal(result.snapshot.balance,100);assert.equal(result.transport,'worker');assert.equal(result.snapshot.activities[0].total,10);
 assert.equal(calls[0].options.credentials,'include');assert.equal(calls[0].options.cache,'no-store');assert.equal(f.created.length,0);assert.equal(f.executed.length,0);
});
test('anonymous worker response uses a fresh same-origin request in an existing background tab',async()=>{
 const f=fixture();f.tabs.push({id:5,url:'https://rewards.bing.com/',status:'complete',active:false});
 const r=reader.createReader(f.browser,async()=>response('<h1>Sign in</h1>'));const result=await r.read('alice@example.com');
 assert.equal(result.snapshot.balance,100);assert.equal(result.transport,'tab');assert.equal(f.executed[0].target.tabId,5);assert.equal(f.created.length,0);assert.ok(!f.updated.some(x=>x.active));
});
test('frozen and discarded user tabs recover through a single inactive helper without focus theft',async()=>{
 const f=fixture();f.tabs.push({id:5,url:'https://rewards.bing.com/',status:'complete',frozen:true},{id:6,url:'https://rewards.bing.com/',status:'complete',discarded:true});
 const r=reader.createReader(f.browser,async()=>response('<h1>Sign in</h1>'));
 assert.equal((await r.read('alice@example.com')).snapshot.balance,100);assert.equal((await r.read('alice@example.com')).snapshot.balance,100);
 assert.equal(f.created.length,1);assert.equal(f.created[0].active,false);assert.ok(f.executed.every(x=>x.target.tabId===77));assert.ok(!f.updated.some(x=>x.active));
});
test('unknown frozen flag on older Chromium still allows a background tab request',async()=>{
 const f=fixture();f.tabs.push({id:5,url:'https://rewards.bing.com/',status:'complete'});const result=await reader.createReader(f.browser,async()=>{throw Error('Offline');}).read('alice@example.com');
 assert.equal(result.transport,'tab');assert.equal(f.created.length,0);
});
test('a suspended script injection times out so recovery can continue in an inactive helper',{timeout:12000},async()=>{
 const f=fixture();f.tabs.push({id:5,url:'https://rewards.bing.com/',status:'complete'});
 f.browser.scripting.executeScript=async options=>options.target.tabId===5?new Promise(()=>{}):[{result:{html:html(),url:'https://rewards.bing.com/'}}];
 let timer;try{const result=await Promise.race([reader.createReader(f.browser,async()=>{throw Error('Unavailable');}).read('alice@example.com'),new Promise(resolve=>{timer=setTimeout(()=>resolve('stuck'),9500);})]);
  assert.notEqual(result,'stuck');assert.equal(result.transport,'tab');assert.equal(f.created.length,1);assert.equal(f.created[0].active,false);
 }finally{clearTimeout(timer);}
});
test('login redirects and mismatched identities cannot replace the associated account',async()=>{
 for(const primary of [response(html(),'https://login.live.com/'),response(html('other@example.com'))]){
  const f=fixture();f.browser.scripting.executeScript=async()=>[{result:{html:html('other@example.com'),url:'https://rewards.bing.com/'}}];
  assert.equal(await reader.createReader(f.browser,async()=>primary).read('alice@example.com'),null);
 }
});
test('late responses are ignored after account or refresh generation changes',async()=>{
 const f=fixture();let valid=true,release;const pending=new Promise(resolve=>{release=resolve;});
 const request=reader.createReader(f.browser,async()=>{await pending;return response(html());}).read('alice@example.com',()=>valid);
 valid=false;release();assert.equal(await request,null);assert.equal(f.created.length,0);
});
test('failed helper requests do not create another helper on the next alarm or worker restart',async()=>{
 const f=fixture();f.browser.scripting.executeScript=async()=>{throw Error('Unavailable');};
 const request=()=>reader.createReader(f.browser,async()=>{throw Error('Unavailable');}).read('alice@example.com');
 assert.equal(await request(),null);assert.equal(await request(),null);assert.equal(f.created.length,1);
 f.tabs.length=0;assert.equal(await request(),null);assert.equal(f.created.length,1);
});
test('oversized and identity-free data remain unavailable rather than zero',async()=>{
 for(const body of ['x'.repeat(6000001),html(''),'<script>var dashboard={"userStatus":{"availablePoints":0}};</script>']){
  const f=fixture();delete f.browser.scripting;const result=await reader.createReader(f.browser,async()=>response(body)).read('alice@example.com');assert.equal(result,null);
 }
});
test('page fallback uses only a fixed same-origin GET and rejects navigation during the request',async()=>{
 const vm=require('node:vm'),location={origin:'https://rewards.bing.com'},calls=[];
 const scope={location,URL,AbortSignal,fetch:async(url,options)=>{calls.push({url,options});return response(html());}};
 const run=()=>vm.runInNewContext('('+reader.rewardsPageRead.toString()+')()',scope);
 assert.equal((await run()).url,'https://rewards.bing.com/');assert.equal(calls[0].url,'https://rewards.bing.com/?ref=rewardspanel');
 assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'same-origin');assert.equal(calls[0].options.cache,'no-store');
 scope.fetch=async()=>{location.origin='https://example.com';return response(html());};assert.equal(await run(),null);
 const before=calls.length;assert.equal(await run(),null);assert.equal(calls.length,before);
});
