const {test}=require('node:test');
const assert=require('node:assert/strict');
let core={}; try {core=require('../extension/core.js');}catch{}
const now=Date.parse('2026-10-14T10:00:00Z');
function account(activities, extra={}) {return {snapshot:{date:'2026-10-14',observedAt:now,balance:12345,coverage:{daily:true,extra:true,search:true,mobile:true},activities},manual:[],...extra};}
const todo={id:'a',title:'Quiz',category:'daily',total:20,earned:0,status:'incomplete',source:'page'};
test('residuals count offers once and never count account balance',()=>{
 assert.equal(typeof core.summarize,'function');
 const s=core.summarize(account([todo,{...todo}, {id:'pc',category:'desktop',total:90,earned:30,status:'incomplete'}, {id:'m',category:'mobile',total:60,earned:15,status:'incomplete'}]),now,'Europe/Rome');
 assert.equal(s.remaining,125); assert.equal(s.incomplete,3);
});

test('already earned claimable credit is shown separately from points still to earn',()=>{
 const claim={id:'pointsclaim',title:'Punti bonus pronti da richiedere',category:'claim',total:1162,earned:0,status:'incomplete',source:'page'};
 for(const category of ['claim','extra']){
  const s=core.summarize(account([todo,{...claim,category}]),now,'Europe/Rome');
  assert.equal(s.remaining,20);assert.equal(s.claimable,1162);
  assert.equal(s.groups.claim.length,1);assert.equal(s.groups.extra.length,0);
  assert.equal(s.actionable.length,1);assert.equal(s.incomplete,1);
 }
 const onlyClaim=core.summarize(account([claim]),now,'Europe/Rome');
 assert.equal(onlyClaim.remaining,0);assert.equal(onlyClaim.claimable,1162);
 assert.equal(core.reminderAccounts([account([claim])],now,'Europe/Rome').length,0);
 const stale=core.summarize(account([claim]),now+3600000,'Europe/Rome');assert.equal(stale.claimable,0);
});
test('unknown counters remain unknown and make total partial',()=>{
 assert.equal(typeof core.summarize,'function');
 const s=core.summarize(account([{...todo,total:null,earned:null,status:'unknown'}]),now,'Europe/Rome');
 assert.equal(s.partial,true); assert.equal(s.unknown,1); assert.equal(s.completed,false);
});
test('old and yesterday snapshots cannot trigger reminders',()=>{
 assert.equal(typeof core.reminderAccounts,'function');
 assert.equal(core.reminderAccounts([account([todo],{snapshot:{date:'2026-10-13',observedAt:now,activities:[todo]}})],now,'Europe/Rome').length,0);
 assert.equal(core.reminderAccounts([account([todo])],now+6*60000,'Europe/Rome').length,0);
});
test('manual phone tasks expire when the local day changes',()=>{
 assert.equal(typeof core.summarize,'function');
 const a={manual:[{...todo,category:'phone',date:'2026-10-14',source:'manual'}]};
 assert.equal(core.summarize(a,now,'Europe/Rome').remaining,20);
 assert.equal(core.summarize(a,Date.parse('2026-10-14T22:01:00Z'),'Europe/Rome').remaining,0);
});
test('dump removes email, arbitrary properties and URL query',()=>{
 assert.equal(typeof core.sanitizeDump,'function');
 const d=core.sanitizeDump({date:'2026-10-14',account:{email:'secret@example.com'},token:'secret-token',activities:[{...todo,url:'https://bing.com/?secret=abc',cookie:'auth'}]});
 const text=JSON.stringify(d); assert.ok(!text.includes('secret')); assert.ok(!text.includes('cookie'));
});
test('Italian timezone uses next day at midnight even before UTC midnight',()=>{
 assert.equal(typeof core.dayKey,'function');
 assert.equal(core.dayKey(Date.parse('2026-10-14T22:01:00Z'),'Europe/Rome'),'2026-10-15');
});
test('unknown or negative values never increase residual totals',()=>{
 assert.equal(typeof core.summarize,'function');
 const s=core.summarize(account([{...todo,total:-10},{...todo,id:'b',total:10,earned:15},{...todo,id:'c',total:10,earned:null}]),now,'Europe/Rome');
 assert.equal(s.remaining,0); assert.equal(s.partial,true);
});
test('a logout or identity conflict immediately suspends automatic reminders',()=>{
 assert.equal(core.reminderAccounts([account([todo],{error:'account-change'})],now,'Europe/Rome').length,0);
 assert.equal(core.reminderAccounts([account([todo],{error:'page-unrecognized'})],now,'Europe/Rome').length,0);
});
test('stale and erroneous readings are excluded from current totals but keep details',()=>{
 const stale=core.summarize(account([todo]),now+3600000,'Europe/Rome');
 assert.equal(stale.remaining,0);assert.equal(stale.hasProgress,false);assert.equal(stale.items[0].remaining,20);
 const conflict=core.summarize(account([todo],{error:'account-change'}),now,'Europe/Rome');assert.equal(conflict.remaining,0);assert.equal(conflict.hasProgress,false);
});
test('a balance alone cannot be mistaken for measured zero residual points',()=>{
 const s=core.summarize({snapshot:{date:'2026-10-14',observedAt:now,balance:100,activities:[],coverage:{}}},now,'Europe/Rome');
 assert.equal(s.hasProgress,false);assert.equal(s.partial,true);
 const zero=core.summarize(account([{...todo,status:'complete',total:20,earned:20}]),now,'Europe/Rome');assert.equal(zero.hasProgress,true);assert.equal(zero.remaining,0);
});
const combinedSearch={id:'bing-combined',category:'search',title:'Ricerche Bing',total:60,earned:20,status:'incomplete',source:'page'};
function combinedAccount(activities,coverage={daily:true,extra:true,search:true,mobile:false}) {
 const value=account(activities);value.snapshot.searchMode='combined';value.snapshot.coverage=coverage;return value;
}
test('combined search is counted once while legacy PC and phone duplicates are ignored',()=>{
 const s=core.summarize(combinedAccount([todo,combinedSearch,{...combinedSearch,id:'pc',category:'desktop'},{...combinedSearch,id:'mobile',category:'mobile'}]),now,'Europe/Rome');
 assert.equal(s.remaining,60);assert.equal(s.incomplete,2);assert.equal(s.groups.search.length,1);
 assert.equal(s.groups.desktop.length,0);assert.equal(s.groups.mobile.length,0);assert.equal(s.partial,false);
});
test('combined search completion does not require a second mobile quota',()=>{
 const s=core.summarize(combinedAccount([{...combinedSearch,earned:60,status:'complete'}]),now,'Europe/Rome');
 assert.equal(s.completed,true);assert.equal(s.partial,false);assert.equal(s.remaining,0);
 const missing=core.summarize(combinedAccount([todo],{daily:true,extra:true,search:false,mobile:true}),now,'Europe/Rome');
 assert.equal(missing.partial,true);assert.equal(missing.hasProgress,true);assert.equal(missing.remaining,20);
});
test('unknown search mode never guesses a shared quota from its points cap',()=>{
 const s=core.summarize(account([combinedSearch,{...combinedSearch,id:'pc',category:'desktop'},{...combinedSearch,id:'mobile',category:'mobile'}]),now,'Europe/Rome');
 assert.equal(s.remaining,80);assert.deepEqual(s.groups.search,[]);assert.equal(s.groups.desktop.length,1);assert.equal(s.groups.mobile.length,1);
});
test('dump retains only safe search metadata',()=>{
 const dump=core.sanitizeDump({searchMode:'combined',diagnostics:{searchStatus:'account-mismatch',source:'secret-cookie',error:'https://secret.example/?token=secret'},activities:[combinedSearch]});
 assert.equal(dump.searchMode,'combined');assert.equal(dump.diagnostics.searchStatus,'account-mismatch');assert.equal(dump.activities[0].category,'search');assert.ok(!JSON.stringify(dump).includes('secret'));
 const invalid=core.sanitizeDump({searchMode:'secret-mode',diagnostics:{searchStatus:'secret-error'}});assert.ok(!JSON.stringify(invalid).includes('secret'));
});
function renderUi(value) {
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){}},contains(){return false;}});return elements.get(id);};
 class FixedDate extends Date {static now(){return now;}}
 const state={accounts:[{slot:1,clientId:'reader-one',alias:'Test',...value}],settings:{timezone:'Europe/Rome'}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/ui/ui.js'),'utf8'),{RewardsCore:core,RewardsDemo:{view:()=>({state})},document:{getElementById:element,body:{classList:{add(){}}},querySelectorAll:()=>[],activeElement:null},location:{search:''},Date:FixedDate,Intl});
 return element('accounts').innerHTML;
}

test('claimable credit has a dedicated row and is excluded from the daily earning headline',()=>{
 const html=renderUi(account([todo,{id:'pointsclaim',category:'extra',total:1162,earned:0,status:'incomplete',source:'page'}]));
 assert.match(html,/data-detail="1-claim"/);assert.match(html,/Punti da riscuotere/);
 assert.match(html,/già guadagnati/);assert.match(html,/>20<\/strong>/);
 assert.doesNotMatch(html,/>1[.,]182<\/strong>/);
});
test('combined panel renders one shared Bing row with points and retains manual phone tasks',()=>{
 const html=renderUi(combinedAccount([combinedSearch,{...combinedSearch,id:'pc',category:'desktop'},{...combinedSearch,id:'mobile',category:'mobile'}]));
 assert.equal((html.match(/data-detail="1-search"/g)||[]).length,1);assert.match(html,/Ricerche Bing.*PC \+ telefono/);assert.match(html,/20 \/ 60/);
 assert.doesNotMatch(html,/data-detail="1-(?:desktop|mobile)"/);assert.match(html,/data-detail="1-phone"/);assert.match(html,/Check-in Bing/);
});
test('unknown and separate mode panels keep their original PC and phone rows',()=>{
 for(const mode of [undefined,'separate']){const a=account([]);if(mode)a.snapshot.searchMode=mode;const html=renderUi(a);assert.match(html,/data-detail="1-desktop"/);assert.match(html,/data-detail="1-mobile"/);assert.doesNotMatch(html,/data-detail="1-search"/);}
});
test('unavailable shared search counter gives status-specific recovery without hiding daily progress',()=>{
 for(const [searchStatus,expected] of [['not-signed-in',/accedi|accesso/i],['account-mismatch',/account.*profilo|profilo.*account/i],['identity-unverified',/identit|account/i],['unavailable',/Bing/]]){
  for(const activities of [[todo],[todo,{...combinedSearch,total:null,earned:null,status:'unknown'}]]){
   const a=combinedAccount(activities,{daily:true,extra:true,search:false,mobile:false});a.snapshot.diagnostics={searchStatus};const html=renderUi(a);
   assert.match(html,expected);assert.match(html,/Bing/);assert.match(html,/profilo/i);assert.match(html,/>20<\/strong>/);assert.match(html,/Quiz/);
  }
 }
});
test('a heartbeat alone keeps account controls in place while the panel refreshes',async()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),elements=new Map();let writes=0,poll,seen=now;
 const element=id=>{if(!elements.has(id)){let html='';elements.set(id,{get innerHTML(){return html;},set innerHTML(value){html=value;if(id==='accounts')writes++;},textContent:'',value:'',classList:{add(){}},contains(){return false;}});}return elements.get(id);};
 class FixedDate extends Date {static now(){return now;}}
 const value=combinedAccount([combinedSearch]);
 const runtime={id:'test',sendMessage:async()=>({ok:true,data:{state:{accounts:[{slot:1,clientId:'reader-one',alias:'Test',...value,lastSeen:seen}],settings:{timezone:'Europe/Rome'}},connection:{online:true}}})};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/ui/ui.js'),'utf8'),{RewardsCore:core,chrome:{runtime},document:{getElementById:element,body:{classList:{add(){}}},querySelectorAll:()=>[],activeElement:null},location:{search:''},Date:FixedDate,Intl,setInterval:callback=>{poll=callback;}});
 await new Promise(resolve=>setImmediate(resolve));const before=writes;seen+=3000;await poll();
 assert.equal(writes,before,'unchanged controls should not be replaced by a last-seen timestamp update');
});
