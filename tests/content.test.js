const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),core=require('../extension/core.js');
async function documentFixture(timeOrigin){
 let now=timeOrigin,pending,listener,interval,snapshot={balance:100,account:{email:null},activities:[],coverage:{},diagnostics:{recognized:true}};const captures=[];
 class Clock extends Date{static now(){return now;}}
 const context={performance:{timeOrigin},Date:Clock,RewardsCore:core,RewardsParser:{readDocument:()=>JSON.parse(JSON.stringify(snapshot))},document:{documentElement:{}},MutationObserver:class{observe(){}},setTimeout:cb=>{pending=cb;return 1;},clearTimeout:()=>{},setInterval:cb=>{interval=cb;},chrome:{runtime:{sendMessage:async message=>{if(message.type==='CAPTURE')captures.push(message.snapshot);},onMessage:{addListener:cb=>{listener=cb;}}}}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../extension/content.js'),'utf8'),context);
 const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
 return {captures,setNow:value=>{now=value;},setBalance:value=>{snapshot.balance=value;},scan:async()=>{listener({type:'SCAN'},null,()=>{});await pending();await settle();},poll:async()=>{interval();await settle();}};
}
test('repeated scans and heartbeats do not pretend unchanged dashboard data is fresh',async()=>{
 const now=Date.now(),f=await documentFixture(now);f.setNow(now+600000);await f.scan();await f.poll();
 assert.equal(f.captures.length,3);assert.ok(f.captures.every(s=>s.observedAt===now));
});
test('a real same-day dashboard change advances the observation timestamp',async()=>{
 const now=Date.now(),f=await documentFixture(now);f.setNow(now+1000);f.setBalance(110);await f.scan();
 assert.equal(f.captures.at(-1).balance,110);assert.equal(f.captures.at(-1).observedAt,now+1000);
});
test('a dashboard kept open overnight does not relabel yesterday activities as today',async()=>{
 const yesterday=Date.now()-86400000,f=await documentFixture(yesterday);f.setNow(yesterday+86400000);f.setBalance(110);await f.scan();
 assert.equal(f.captures.at(-1).balance,110);assert.equal(f.captures.at(-1).date,core.dayKey(yesterday));assert.equal(f.captures.at(-1).observedAt,yesterday);
});
