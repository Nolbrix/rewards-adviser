const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../extension/core.js');
const now=Date.parse('2026-10-15T10:00:00Z'),date='2026-10-15';
const read={date,observedAt:now,earned:12,total:30,status:'incomplete',source:'phone-screen'};
const manual={id:'manual-read',title:'Articoli',date,earned:0,total:30,status:'incomplete',category:'phone',source:'manual'};
const checkin={...manual,id:'manual-checkin',title:'Check-in',earned:0,total:5};

test('a fresh phone reading replaces every manual/page article alias exactly once and preserves check-in',()=>{
 const account={phoneReading:read,manual:[manual,{...manual,id:'phone-articles'},checkin],snapshot:{date,observedAt:now,activities:[{...manual,source:'page'}],coverage:{}}};
 const s=core.summarize(account,now);
 assert.equal(s.remaining,23);assert.equal(s.groups.phone.length,2);
 const article=s.groups.phone.find(a=>a.id==='phone-articles');assert.equal(article.source,'phone-screen');assert.equal(article.earned,12);assert.equal(article.remaining,18);assert.equal(article.active,true);
 assert.equal(account.manual.length,3,'pure calculation must preserve saved manual list');
});
test('phone freshness is independent from missing or stale PC snapshots',()=>{
 for(const snapshot of [null,{date:'2026-10-14',observedAt:now-86400000,activities:[]}]){
  const s=core.summarize({snapshot,phoneReading:read,manual:[manual]},now);assert.equal(s.remaining,18);assert.equal(s.hasProgress,true);
 }
 assert.equal(core.reminderAccounts([{phoneReading:read}],now).length,1);
 assert.equal(core.reminderAccounts([{phoneReading:read,error:'account-change'}],now).length,0);
});
test('stale or cross-day automatic readings keep truthful details and never revive old manual article counters',()=>{
 for(const changed of [{observedAt:now-300001},{date:'2026-10-14',observedAt:now-86400000},{observedAt:now+3001}]){
  const account={phoneReading:{...read,...changed},manual:[manual,checkin]};
  const s=core.summarize(account,now);assert.equal(s.remaining,5);assert.equal(s.partial,true);
  assert.equal(s.groups.phone.filter(a=>a.id==='phone-articles').length,1);assert.equal(s.groups.phone.find(a=>a.id==='phone-articles').active,false);
  assert.equal(core.reminderAccounts([{...account,manual:[manual]}],now).length,0);
 }
});
test('unknown or malformed automatic counters remain unknown instead of being interpreted as 0/30',()=>{
 for(const changed of [{earned:null},{earned:true},{earned:'0'},{earned:31},{total:60},{observedAt:NaN},{source:'manual'}]){
  const s=core.summarize({phoneReading:{...read,...changed},manual:[manual]},now);assert.equal(s.remaining,0);assert.equal(s.hasProgress,false);assert.equal(s.partial,true);
 }
});
test('semantic article duplicates are counted only once even before automatic setup',()=>{
 const s=core.summarize({manual:[manual,{...manual,id:'phone-articles'},checkin]},now);
 assert.equal(s.remaining,35);assert.equal(s.groups.phone.length,2);
});
test('only a newly explicit manual confirmation can replace expired automatic data',()=>{
 const stale={...read,observedAt:now-360000};
 for(const confirmedAt of [undefined,now-400000]){
  const s=core.summarize({phoneReading:stale,manual:[{...manual,confirmedAt}]},now);assert.equal(s.remaining,0);
 }
 const fallback=core.summarize({phoneReading:stale,manual:[{...manual,earned:20,confirmedAt:now}]},now);
 assert.equal(fallback.remaining,10);assert.equal(fallback.groups.phone.length,1);assert.equal(fallback.groups.phone[0].source,'manual');
 const fresh=core.summarize({phoneReading:read,manual:[{...manual,earned:20,confirmedAt:now}]},now);assert.equal(fresh.remaining,18);assert.equal(fresh.groups.phone[0].source,'phone-screen');
});
test('phone observation helper reports day age source and availability for display',()=>{
 assert.equal(typeof core.phoneObservation,'function');
 const result=core.phoneObservation({phoneReading:read},now,'Europe/Rome');
 assert.equal(result.fresh,true);assert.equal(result.active,true);assert.equal(result.current,true);assert.equal(result.item.earned,12);assert.equal(result.ageMs,0);
 const blocked=core.phoneObservation({phoneReading:read,error:'identity-unverified'},now);assert.equal(blocked.active,false);
 const absent=core.phoneObservation({},now);assert.equal(absent.present,false);
});
test('enabled automatic reader with no observation keeps articles unknown even when all PC work is done',()=>{
 const complete={date,observedAt:now,searchMode:'combined',coverage:{daily:true,extra:true,search:true},activities:[{id:'daily',category:'daily',status:'complete',earned:30,total:30,source:'page'}]};
 const account={phoneReaderEnabled:true,phoneReading:null,snapshot:complete,manual:[{...manual,earned:30,status:'complete'}]};
 const s=core.summarize(account,now);
 assert.equal(s.completed,false);assert.equal(s.partial,true);assert.equal(s.groups.phone.length,1);
 assert.equal(s.groups.phone[0].earned,null);assert.equal(s.groups.phone[0].status,'unknown');
 assert.equal(s.remaining,0);assert.equal(core.reminderAccounts([account],now).length,0);
 const confirmed=core.summarize({...account,manual:[{...manual,earned:30,status:'complete',confirmedAt:now}]},now);
 assert.equal(confirmed.completed,true,'an explicit current manual confirmation remains a valid fallback');
});
test('new phone failure invalidates recent automatic progress and reminders without losing historical evidence',()=>{
 const account={phoneReaderEnabled:true,phoneReading:read,phoneError:{status:'unreadable',at:now+1000},manual:[manual]};
 const p=core.phoneObservation(account,now+1000);assert.equal(p.fresh,false);assert.equal(p.active,false);assert.equal(p.item.earned,12);
 const s=core.summarize(account,now+1000);assert.equal(s.remaining,0);assert.equal(s.partial,true);
 assert.equal(core.reminderAccounts([account],now+1000).length,0);
 assert.equal(core.phoneObservation({...account,phoneError:{status:'unreadable',at:now-1}},now).active,true,'old errors cannot suppress newer evidence');
});
test('explicitly paused automatic reader requires manual confirmation before its old points enter totals',()=>{
 const account={phoneReaderEnabled:false,phoneReading:read,manual:[manual,checkin]};
 assert.equal(core.phoneObservation(account,now).active,false);
 assert.equal(core.summarize(account,now).remaining,5);
 const confirmed=core.summarize({...account,manual:[{...manual,earned:20,confirmedAt:now},checkin]},now);
 assert.equal(confirmed.remaining,15);assert.equal(confirmed.groups.phone.find(a=>a.id==='manual-read').source,'manual');
});
async function panel(account,reader={enabled:true,status:'ready',lastCycleAt:now,updatedAt:now,slot:null}){
 const elements=new Map(),requests=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',checked:false,classList:{add(){}},contains(){return false;}});return elements.get(id);};
 class FixedDate extends Date {static now(){return now;}}
 const state={accounts:[{slot:1,clientId:'reader-one',...account}],phoneReader:reader,settings:{timezone:'Europe/Rome'}};
 const runtime={id:'test',async sendMessage(message){if(message.type!=='GET')requests.push(message);return {ok:true,data:message.type==='GET'?{state,config:{},connection:{online:true}}:{state}};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/ui/ui.js'),'utf8'),{RewardsCore:core,chrome:{runtime},document:{getElementById:element,body:{classList:{add(){}}},querySelectorAll:()=>[],activeElement:null},location:{search:''},Date:FixedDate,Intl,setInterval(){}});
 await new Promise(resolve=>setImmediate(resolve));return {html:element('accounts').innerHTML,element,requests};
}
test('fresh automatic article UI shows Galaxy progress/time and hides only its manual editor',async()=>{
 const p=await panel({phoneReading:read,manual:[manual,checkin]});
 assert.match(p.html,/Letto dal Galaxy/);assert.match(p.html,/12\s*\/\s*30/);assert.match(p.html,/Check-in/);
 assert.doesNotMatch(p.html,/name="confirmedPoints"/);assert.match(p.html,/data-phone="manual-checkin"/);
});
test('stale automatic UI shows stale source clearly and keeps explicit manual fallback controls',async()=>{
 const p=await panel({phoneReading:{...read,observedAt:now-360000},manual:[manual]}, {enabled:true,status:'waiting-phone',updatedAt:now,slot:null});
 assert.match(p.html,/Galaxy/);assert.match(p.html,/aggiornare|scadut|non aggiornat/i);assert.match(p.html,/name="confirmedPoints"/);
});
test('missing and failed automatic UI never labels an unverified counter as freshly read',async()=>{
 const pending=await panel({phoneReading:null,manual:[manual]},{enabled:true,status:'reading',slot:1,updatedAt:now});
 assert.match(pending.html,/attesa|verificar/i);assert.doesNotMatch(pending.html,/Letto dal Galaxy/);assert.match(pending.html,/name="confirmedPoints"/);
 const failed=await panel({phoneReading:read,phoneError:{status:'unreadable',at:now+1},manual:[manual]}, {enabled:true,status:'unreadable',slot:1,updatedAt:now+1});
 assert.match(failed.html,/da aggiornare/);assert.match(failed.html,/name="confirmedPoints"/);
});
test('manual article aliases expose one fallback editor and only actual user confirmation sends confirmNow',async()=>{
 const p=await panel({manual:[{...manual,id:'phone-articles'},manual,checkin]});
 assert.equal((p.html.match(/name="confirmedPoints"/g)||[]).length,1);assert.equal((p.html.match(/data-phone="manual-read"/g)||[]).length,1);
 const change=async(id,value)=>{const select={dataset:{phone:id,slot:'1'},value,closest:()=>select};await p.element('accounts').onchange({target:select});};
 await change('manual-checkin','complete');assert.equal(p.requests.at(-1).activities.find(a=>a.id==='manual-read').confirmNow,undefined);
 await change('manual-read','incomplete');assert.equal(p.requests.at(-1).activities.find(a=>a.id==='manual-read').confirmNow,true);
});
test('the removed Galaxy section no longer exposes automatic reader controls',async()=>{
 const p=await panel({phoneReading:read});assert.equal(p.element('phone-reader-enabled').onchange,undefined);assert.equal(p.requests.length,0);
 const source=fs.readFileSync(path.join(__dirname,'../extension/ui/index.html'),'utf8');assert.doesNotMatch(source,/id="phone-reader-enabled"|id="phone-reader-status"|Articoli Bing dal Galaxy/);
});
