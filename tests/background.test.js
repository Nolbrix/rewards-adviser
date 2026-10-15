const {test}=require('node:test');const assert=require('node:assert/strict');
let factory,senderAllowed,bingPageRead;try{({createAdviser:factory,senderAllowed,bingPageRead}=require('../extension/background.js'));}catch{}
function boundary(){let store={},notifications=[],tabs=[{id:1,url:'https://rewards.bing.com/'},{id:2,url:'https://www.bing.com/search?q=existing'}],reloaded=[],created=[];
 const browser={storage:{local:{get:async keys=>Object.fromEntries(keys.map(k=>[k,store[k]])),set:async x=>Object.assign(store,x)}},tabs:{query:async()=>tabs,reload:async id=>reloaded.push(id),create:async props=>{created.push(props);return {id:3}},sendMessage:async()=>({ok:true})},notifications:{create:async(id,data)=>notifications.push({id,...data})},runtime:{getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
 return {browser,store,notifications,tabs,reloaded,created};
}
test('English browser notifications preserve the account name and translate reminder actions',async()=>{
 const b=boundary();b.browser.i18n={getUILanguage:()=> 'en-GB'};b.store.config={clientId:'coordinator',coordinator:true,token:'a'.repeat(48)};
 const now=Date.now(),core=require('../extension/core.js');const a=factory(b.browser);
 await a.remind({coordinatorId:'coordinator',settings:{notifications:true,timezone:'Europe/Rome'},accounts:[{alias:'Da fare',snapshot:{date:core.dayKey(now),observedAt:now,coverage:{},activities:[{id:'task',category:'daily',total:10,earned:0,status:'incomplete'}]}}]},now);
 assert.equal(b.notifications[0].title,'Rewards: activities still to complete');assert.match(b.notifications[0].message,/^Da fare: 1 activities to do, 10 known points$/);assert.equal(b.notifications[0].buttons[0].title,'Open overview');
});
test('refresh reloads only Rewards dashboard, preserving Bing searches',async()=>{
 assert.equal(typeof factory,'function');const b=boundary();const a=factory(b.browser);await a.performCommand({action:'refresh'});
 assert.deepEqual(b.reloaded,[1]);assert.equal(b.created.length,0);
});
test('missing dashboard opens one inactive Rewards page rather than searching',async()=>{
 assert.equal(typeof factory,'function');const b=boundary();b.tabs.splice(0,1);const a=factory(b.browser);await a.performCommand({action:'refresh'});
 assert.equal(b.created[0].url,'https://rewards.bing.com/?ref=rewardspanel');assert.equal(b.created[0].active,false);
});
test('automatic refresh reopens a missing Rewards dashboard and does not repeatedly open it',async()=>{
 const b=boundary();b.tabs.splice(0,1);b.store.config={clientId:'reader-one',token:'a'.repeat(48),slot:2,browser:'Chrome',autoRefresh:true};
 const a=factory(b.browser,async()=>({ok:true,json:async()=>({state:{accounts:[]},commands:[]})}));await a.alarm('rewards-sync');await a.alarm('rewards-sync');
 assert.deepEqual(b.created,[{url:'https://rewards.bing.com/?ref=rewardspanel',active:false}]);assert.equal(b.reloaded.length,0);
});
test('a requested refresh prevents the same alarm from immediately reloading the dashboard twice',async()=>{
 const b=boundary();b.store.config={clientId:'reader-one',token:'a'.repeat(48),slot:2,browser:'Chrome',autoRefresh:true};let delivered=false;
 const a=factory(b.browser,async url=>({ok:true,json:async()=>{if(url.endsWith('/api/heartbeat')&&!delivered){delivered=true;return {state:{accounts:[]},commands:[{id:'refresh-one',action:'refresh'}]};}return {state:{accounts:[]},commands:[]};}}));
 await a.alarm('rewards-sync');assert.deepEqual(b.reloaded,[1]);
});
test('a refresh delivered during capture discards the previous dashboard snapshot',async()=>{
 const b=boundary(),sent=[];b.store.config={clientId:'reader-one',token:'a'.repeat(48),slot:1,email:'',browser:'Chrome'};
 const a=factory(b.browser,async(url,options)=>{if(url.endsWith('/api/snapshot'))sent.push(JSON.parse(options.body));return {ok:true,json:async()=>url.endsWith('/api/heartbeat')?{state:{accounts:[]},commands:[{id:'refresh-during-capture',action:'refresh'}]}:{state:{accounts:[]},accepted:true}};});
 const observedAt=Date.now()-1000;const result=await a.capture({date:require('../extension/core.js').dayKey(observedAt),observedAt,account:{email:null},balance:100,activities:[],coverage:{},diagnostics:{recognized:true}});
 assert.deepEqual(b.reloaded,[1]);assert.equal(result.accepted,false);assert.equal(sent.length,0);assert.equal(b.store.localSnapshot,undefined);
});
test('a delayed old document cannot post after a refresh in the same worker',async()=>{
 const f=searchCaptureFixture();await f.adviser.performCommand({action:'refresh'});
 f.snapshot.observedAt=Date.now()-20000;const result=await f.adviser.capture(f.snapshot);
 assert.equal(result.accepted,false);assert.equal(f.sent.length,0);assert.ok(!f.b.store.searchBinding);
});
test('a reader with automatic refresh disabled does not reopen its dashboard',async()=>{
 const b=boundary();b.tabs.splice(0,1);b.store.config={clientId:'reader-one',token:'a'.repeat(48),slot:2,browser:'Chrome',autoRefresh:false};
 const a=factory(b.browser,async()=>({ok:true,json:async()=>({state:{accounts:[]},commands:[]})}));await a.alarm('rewards-sync');assert.equal(b.created.length,0);
});
test('bad configuration cannot be saved to browser storage',async()=>{
 assert.equal(typeof factory,'function');const b=boundary();const a=factory(b.browser);
 await assert.rejects(()=>a.saveConfig({token:'abc',slot:9,browser:'Chrome',alias:'Alice',email:'a@example.com'}));assert.equal(b.store.config,undefined);
});
test('only chosen coordinator can notify and notifications are throttled',async()=>{
 assert.equal(typeof factory,'function');const b=boundary();b.store.config={clientId:'edge-one',coordinator:true,token:'a'.repeat(48)};
 const now=Date.now(),core=require('../extension/core.js');const state={coordinatorId:'other-edge',settings:{timezone:'Europe/Rome',notifications:true,snoozeUntil:0},accounts:[{alias:'Alice',snapshot:{date:core.dayKey(now),observedAt:now,coverage:{daily:true,extra:true,search:true,mobile:true},activities:[{id:'q',title:'Quiz',category:'daily',total:20,earned:0,status:'incomplete'}]}}]};
 const a=factory(b.browser);await a.remind(state,now);assert.equal(b.notifications.length,0);
 state.coordinatorId='edge-one';await a.remind(state,now);await a.remind(state,now+1000);
 assert.equal(b.notifications.length,1);assert.match(b.notifications[0].message,/Alice/);assert.match(b.notifications[0].message,/20/);
});
test('unknown counters and snooze never produce an automatic reminder',async()=>{
 assert.equal(typeof factory,'function');const b=boundary();b.store.config={clientId:'edge-one',coordinator:true};const a=factory(b.browser);
 const now=Date.now(),core=require('../extension/core.js');const state={coordinatorId:'edge-one',settings:{notifications:true,timezone:'Europe/Rome',snoozeUntil:now+3600000},accounts:[{snapshot:{date:core.dayKey(now),observedAt:now,activities:[{id:'q',category:'daily',status:'incomplete',total:10,earned:0}]}}]};
 await a.remind(state,now);state.settings.snoozeUntil=0;state.accounts[0].snapshot.activities[0].status='unknown';await a.remind(state,now);
 assert.equal(b.notifications.length,0);
});
test('extension panel opened in a tab can configure, content pages cannot configure',()=>{
 assert.equal(typeof senderAllowed,'function');const id='a'.repeat(32);
 assert.equal(senderAllowed({id,url:`chrome-extension://${id}/ui/index.html`,tab:{id:1}},'CONFIG',id),true);
 assert.equal(senderAllowed({id,url:`chrome-extension://${id}/extension/ui/index.html`,tab:{id:1}},'CONFIG',id),true);
 assert.equal(senderAllowed({id,url:'https://rewards.bing.com/',tab:{id:1}},'CONFIG',id),false);
 assert.equal(senderAllowed({id,url:'https://rewards.bing.com/',tab:{id:1}},'CAPTURE',id),true);
 assert.equal(senderAllowed({id:'b'.repeat(32),url:`chrome-extension://${id}/ui/index.html`},'GET',id),false);
});
test('phone reader settings reach the authenticated relay and refresh the panel cache',async()=>{
 const b=boundary();b.store.config={clientId:'panel',token:'a'.repeat(48),slot:null};const calls=[];
 const state={accounts:[],phoneReader:{enabled:true,status:'calibration-needed'}};
 const a=factory(b.browser,async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>({state})};});
 await a.handle({type:'PHONE_SETTINGS',settings:{enabled:true}});
 assert.equal(calls.length,1);assert.equal(calls[0].url,'http://127.0.0.1:18743/api/phone/settings');
 assert.deepEqual(JSON.parse(calls[0].options.body),{enabled:true});assert.equal(calls[0].options.headers.Authorization,'Bearer '+'a'.repeat(48));
 assert.deepEqual(b.store.state,state);
 const id='a'.repeat(32);assert.equal(senderAllowed({id,url:'https://rewards.bing.com/',tab:{id:1}},'PHONE_SETTINGS',id),false);
});
test('root-folder installation resolves notification icons and panel inside extension subfolder',async()=>{
 const b=boundary();const a=factory(b.browser,globalThis.fetch,'extension/');
 await a.handle({type:'TEST_NOTIFICATION'});assert.equal(b.notifications[0].iconUrl,'chrome-extension://'+'a'.repeat(32)+'/extension/icons/icon128.png');
 await a.handle({type:'EXPAND'});assert.equal(b.created[0].url,'chrome-extension://'+'a'.repeat(32)+'/extension/ui/index.html?expanded=1');
});
test('a missing connection key is loaded from the private local setup file without changing reader identity',async()=>{
 const b=boundary();b.store.config={clientId:'existing-client',token:'',slot:2,alias:'Saved name',email:'saved@example.com'};
 const a=factory(b.browser,async url=>{assert.equal(url,'chrome-extension://'+'a'.repeat(32)+'/extension/local-link.json');return {ok:true,json:async()=>({app:'rewards-realtime-adviser',token:'c'.repeat(48)})};},'extension/');
 const c=await a.config();assert.equal(c.token,'c'.repeat(48));assert.equal(c.slot,2);assert.equal(c.email,'saved@example.com');assert.equal(c.clientId,'existing-client');
});
test('automatic linking rejects a different app and preserves an existing connection key',async()=>{
 const b=boundary();b.store.config={clientId:'existing-client',token:'',slot:null};
 const a=factory(b.browser,async()=>({ok:true,json:async()=>({app:'other-app',token:'c'.repeat(48)})}));
 assert.equal((await a.config()).token,'');
 b.store.config.token='a'.repeat(48);assert.equal((await a.config()).token,'a'.repeat(48));
});
function searchCaptureFixture({email='alice@example.com',authenticated=true,subject='fake-bing-user',homeEmails,pauseHome,pauseConfig}={}){
 const b=boundary(),calls=[],sent=[];b.store.config={clientId:'reader-one',token:'a'.repeat(48),slot:1,browser:'Chrome',email:'alice@example.com'};
 const fetcher=async(url,options)=>{calls.push({url,options});
  if(url.includes('/rewardsapp/flyoutdata'))return {ok:true,url,text:async()=>JSON.stringify({IsAuthenticated:authenticated,UserId:subject,FlyoutResult:{UserStatus:{AvailablePoints:40590,Counters:{PCSearch:[{OfferId:'pc',PointProgress:21,PointProgressMax:60}]}},Layout:{Controls:{body:[{CustomProperties:{Counter:'PcCombined'}}]}}}})};
  if(url==='https://www.bing.com/')return {ok:true,url,text:async()=>{if(pauseHome)await pauseHome();return '<script>var _model = '+JSON.stringify({UserEmail:homeEmails?.length?homeEmails.shift():email})+';</script>';}};
  const body=options?.body?JSON.parse(options.body):null;if(pauseConfig&&url.endsWith('/api/heartbeat')&&body?.config?.slot===2)await pauseConfig();if(url.endsWith('/api/snapshot'))sent.push(body.snapshot);
  return {ok:true,json:async()=>({state:{accounts:[]},accepted:true})};
 };
 const now=Date.now(),core=require('../extension/core.js'),snapshot={date:core.dayKey(now),observedAt:now,account:{email:'alice@example.com'},balance:40590,activities:[],coverage:{},diagnostics:{recognized:true,method:'next-flight'}};
 return {b,calls,sent,snapshot,adviser:factory(b.browser,fetcher)};
}
test('a reader fetches its authenticated Bing counters and validates the header email before merging',async()=>{
 const f=searchCaptureFixture();await f.adviser.capture(f.snapshot);const snapshot=f.sent[0];assert.equal(snapshot.searchMode,'combined');assert.equal(snapshot.activities[0].earned,21);assert.equal(snapshot.balance,40590);
 assert.equal(f.calls.find(c=>c.url.includes('/rewardsapp/flyoutdata')).options.credentials,'include');assert.equal(f.calls.find(c=>c.url==='https://www.bing.com/').options.credentials,'include');
 assert.equal(f.b.store.searchBinding.email,'alice@example.com');assert.match(f.b.store.searchBinding.subject,/^[a-f0-9]{64}$/);assert.ok(!JSON.stringify(f.b.store).includes('fake-bing-user'));
 await f.adviser.capture(f.snapshot);assert.equal(f.calls.filter(c=>c.url.includes('/rewardsapp/flyoutdata')).length,1);
});
test('anonymous or other-account Bing data never supplies the configured account search progress',async()=>{
 for(const options of [{authenticated:false},{email:'other@example.com'},{email:''}]){const f=searchCaptureFixture(options);await f.adviser.capture(f.snapshot);assert.equal(f.sent[0].activities.length,0);assert.notEqual(f.sent[0].diagnostics.searchStatus,'ok');assert.ok(!f.b.store.searchBinding);}
});
test('a pinned Bing account change is rejected even if the account balances happen to match',async()=>{
 const f=searchCaptureFixture();f.b.store.searchBinding={email:'alice@example.com',subject:'b'.repeat(64)};await f.adviser.capture(f.snapshot);assert.equal(f.sent[0].activities.length,0);assert.equal(f.sent[0].diagnostics.searchStatus,'account-mismatch');
});
test('a Bing account transition between requests cannot bind previous account counters to the new email',async()=>{
 const f=searchCaptureFixture({homeEmails:['alice@example.com','bob@example.com']});await f.adviser.capture(f.snapshot);assert.equal(f.sent[0].activities.length,0);assert.equal(f.sent[0].diagnostics.searchStatus,'account-mismatch');assert.ok(!f.b.store.searchBinding);
});
test('reconfiguring a reader cancels an in-flight counter capture before it can bind or post old account data',async()=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),unblock=new Promise(resolve=>release=resolve);
 const f=searchCaptureFixture({pauseHome:async()=>{entered();await unblock;}}),pending=f.adviser.capture(f.snapshot);
 await started;await f.adviser.saveConfig({slot:2,email:'bob@example.com',browser:'Chrome',token:'a'.repeat(48),alias:'Bob',coordinator:false,autoRefresh:true});release();await pending;
 assert.equal(f.sent.length,0);assert.ok(!f.b.store.searchBinding);assert.equal(f.b.store.config.email,'bob@example.com');
});
test('a newer concurrent dashboard capture cannot be overwritten by a slower old capture',async()=>{
 let entered,release,homeReads=0;const started=new Promise(resolve=>entered=resolve),unblock=new Promise(resolve=>release=resolve);
 const f=searchCaptureFixture({pauseHome:async()=>{if(++homeReads===1){entered();await unblock;}}});
 const now=Date.now();f.snapshot.observedAt=now-1000;f.snapshot.activities=[{id:'daily',category:'daily',earned:0,total:10,status:'incomplete'}];
 const old=f.adviser.capture(f.snapshot);await started;
 await f.adviser.capture({...f.snapshot,observedAt:now,activities:[{...f.snapshot.activities[0],earned:10,status:'complete'}]});release();await old;
 assert.deepEqual(f.sent.map(s=>s.activities.find(a=>a.category==='daily').earned),[10]);assert.equal(f.b.store.localSnapshot.activities.find(a=>a.category==='daily').earned,10);
});
test('a cancelled old Bing response cannot poison the cache reused by the next current capture',async()=>{
 let entered,release,flyouts=0;const started=new Promise(resolve=>entered=resolve),unblock=new Promise(resolve=>release=resolve),b=boundary(),sent=[];
 b.store.config={clientId:'reader-one',token:'a'.repeat(48),slot:1,browser:'Chrome',email:'alice@example.com'};
 const a=factory(b.browser,async(url,options)=>{
  if(url==='https://www.bing.com/')return {ok:true,url,text:async()=>'<script>var _model = {"UserEmail":"alice@example.com"};</script>'};
  if(url.includes('/rewardsapp/flyoutdata')){const older=++flyouts===1;return {ok:true,url,text:async()=>{if(older){entered();await unblock;}return JSON.stringify({IsAuthenticated:true,UserId:older?'stale-subject':'current-subject',FlyoutResult:{UserStatus:{AvailablePoints:older?100:200,Counters:{PCSearch:[{OfferId:'pc',PointProgress:older?0:30,PointProgressMax:60}]}},Layout:{Controls:{body:[{CustomProperties:{Counter:'PcCombined'}}]}}}});}};}
  if(url.endsWith('/api/snapshot'))sent.push(JSON.parse(options.body).snapshot);
  return {ok:true,json:async()=>({state:{accounts:[]},accepted:true})};
 });
 const now=Date.now(),snapshot={date:require('../extension/core.js').dayKey(now),observedAt:now-1000,account:{email:'alice@example.com'},balance:100,activities:[],coverage:{},diagnostics:{recognized:true}};
 const older=a.capture(snapshot);await started;const current={...snapshot,observedAt:now,balance:200};await a.capture(current);const binding=JSON.stringify(b.store.searchBinding);release();await older;
 await a.capture(current);
 assert.deepEqual(sent.map(s=>s.activities.find(item=>item.category==='search').earned),[30,30]);assert.deepEqual(sent.map(s=>s.balance),[200,200]);assert.equal(b.store.searchCache.reading.activities[0].earned,30);assert.equal(JSON.stringify(b.store.searchBinding),binding);assert.equal(flyouts,2);
});
test('a refresh cancels an in-flight Bing capture before it restores the cleared search cache',async()=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),unblock=new Promise(resolve=>release=resolve);
 const f=searchCaptureFixture({pauseHome:async()=>{entered();await unblock;}}),old=f.adviser.capture(f.snapshot);
 await started;await f.adviser.performCommand({action:'refresh'});release();await old;
 assert.equal(f.sent.length,0);assert.equal(f.b.store.searchCache,null);assert.ok(!f.b.store.searchBinding);
});
test('a capture starting during a configuration change cannot read the previous profile into the new slot',async()=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),unblock=new Promise(resolve=>release=resolve);
 const f=searchCaptureFixture({pauseConfig:async()=>{entered();await unblock;}});await f.adviser.tick(true);
 const change=f.adviser.saveConfig({slot:2,email:'',browser:'Chrome',token:'a'.repeat(48),alias:'New profile',coordinator:false,autoRefresh:true});
 await started;const result=await f.adviser.capture(f.snapshot);release();await change;
 assert.equal(result.accepted,false);assert.equal(f.sent.length,0);assert.ok(!f.b.store.searchBinding);
});
function pageReading(email='alice@example.com',authenticated=true){return {beforeHtml:'<script>var _model = '+JSON.stringify({UserEmail:email})+';</script>',afterHtml:'<script>var _model = '+JSON.stringify({UserEmail:email})+';</script>',flyoutText:JSON.stringify({IsAuthenticated:authenticated,UserId:'fake-bing-user',FlyoutResult:{UserStatus:{AvailablePoints:40590,Counters:{PCSearch:[{OfferId:'pc',PointProgress:21,PointProgressMax:60}]}},Layout:{Controls:{body:[{CustomProperties:{Counter:'PcCombined'}}]}}}})};}
test('an anonymous worker can read signed-in counters through an existing Bing tab without navigating it',async()=>{
 const f=searchCaptureFixture({authenticated:false});let executions=0;
 f.b.browser.scripting={executeScript:async options=>{executions++;assert.deepEqual(options.target,{tabId:2,frameIds:[0]});assert.equal(options.world,'ISOLATED');assert.equal(options.func,bingPageRead);assert.equal(options.args,undefined);return [{result:pageReading()}];}};
 await f.adviser.capture(f.snapshot);assert.equal(f.sent[0].diagnostics.searchStatus,'ok');assert.equal(f.sent[0].activities[0].earned,21);assert.equal(executions,1);assert.equal(f.b.created.length,0);assert.equal(f.b.reloaded.length,0);
});
test('an anonymous or different-account page fallback cannot supply the configured account counters',async()=>{
 for(const reading of [pageReading('other@example.com'),pageReading('alice@example.com',false)]){const f=searchCaptureFixture({authenticated:false});f.b.browser.scripting={executeScript:async()=>[{result:reading}]};await f.adviser.capture(f.snapshot);assert.equal(f.sent[0].activities.length,0);assert.notEqual(f.sent[0].diagnostics.searchStatus,'ok');assert.ok(!f.b.store.searchBinding);}
});
test('page fallback can verify an identity missing from worker homepage responses but never bypasses a different email',async()=>{
 const f=searchCaptureFixture({homeEmails:['','']});let executions=0;f.b.browser.scripting={executeScript:async()=>{executions++;return [{result:pageReading()}];}};
 await f.adviser.capture(f.snapshot);assert.equal(f.sent[0].diagnostics.searchStatus,'ok');assert.equal(executions,1);
 const mismatch=searchCaptureFixture({email:'other@example.com'});mismatch.b.browser.scripting={executeScript:async()=>{throw new Error('must not override a verified mismatch');}};
 await mismatch.adviser.capture(mismatch.snapshot);assert.equal(mismatch.sent[0].diagnostics.searchStatus,'account-mismatch');assert.equal(mismatch.sent[0].activities.length,0);
});
test('concurrent fallback reads open at most one inactive Bing page and configuration changes cancel their captures',{timeout:2000},async()=>{
 let entered,release;const started=new Promise(resolve=>entered=resolve),unblock=new Promise(resolve=>release=resolve),f=searchCaptureFixture({authenticated:false});f.b.tabs.splice(1,1);let executions=0;
 f.b.browser.tabs.create=async props=>{f.b.created.push(props);return {id:3,url:props.url,status:'complete'};};f.b.browser.scripting={executeScript:async()=>{executions++;entered();await unblock;return [{result:pageReading()}];}};
 const first=f.adviser.capture(f.snapshot),second=f.adviser.capture(f.snapshot);await started;await f.adviser.saveConfig({slot:2,email:'bob@example.com',browser:'Chrome',token:'a'.repeat(48),alias:'Bob'});release();await Promise.all([first,second]);
 assert.equal(executions,1);assert.equal(f.b.created.length,1);assert.deepEqual(f.b.created[0],{url:'https://www.bing.com/',active:false});assert.equal(f.sent.length,0);assert.ok(!f.b.store.searchBinding);
});
test('a newly opened Bing tab may finish its own pending navigation before reading',{timeout:2000},async()=>{
 const f=searchCaptureFixture({authenticated:false});f.b.tabs.splice(1,1);let checks=0;
 f.b.browser.tabs.create=async props=>{f.b.created.push(props);return {id:3,url:'about:blank',pendingUrl:props.url,status:'loading'};};
 f.b.browser.tabs.get=async()=>++checks===1?{id:3,url:'about:blank',pendingUrl:'https://www.bing.com/',status:'loading'}:{id:3,url:'https://www.bing.com/',status:'complete'};
 f.b.browser.scripting={executeScript:async()=>[{result:pageReading()}]};await f.adviser.capture(f.snapshot);
 assert.equal(f.sent[0].diagnostics.searchStatus,'ok');assert.equal(f.sent[0].activities[0].earned,21);assert.equal(checks,2);
});
test('page transport uses fixed same-origin GETs and fails closed if its tab navigates',async()=>{
 assert.equal(typeof bingPageRead,'function');const vm=require('node:vm'),location={origin:'https://www.bing.com'},calls=[],fixture=pageReading();
 const run=()=>vm.runInNewContext('('+bingPageRead.toString()+')()',{location,AbortSignal,URL,fetch:async(url,options)=>{calls.push({url,options});return {ok:true,url,text:async()=>url.includes('flyoutdata')?fixture.flyoutText:fixture.beforeHtml};}});
 const result=await run();assert.equal(result.flyoutText,fixture.flyoutText);assert.equal(calls.length,3);assert.ok(calls.every(c=>c.options.method==='GET'&&c.options.credentials==='same-origin'&&new URL(c.url).origin==='https://www.bing.com'));
 const stopped=await vm.runInNewContext('('+bingPageRead.toString()+')()',{location:{origin:'https://other.example'},AbortSignal,fetch:async()=>{throw new Error('unexpected request');}});assert.equal(stopped.status,'unavailable');
 const moved={origin:'https://www.bing.com'};const navigated=await vm.runInNewContext('('+bingPageRead.toString()+')()',{location:moved,AbortSignal,fetch:async url=>{moved.origin='https://other.example';return {ok:true,url,text:async()=>fixture.beforeHtml};}});assert.equal(navigated.status,'unavailable');
});
