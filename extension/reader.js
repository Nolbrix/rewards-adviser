/* Fresh, read-only Rewards requests independent of page timers. */
(function(root,factory){const parser=typeof module==='object'&&module.exports?require('./parser.js'):root.RewardsParser;const core=typeof module==='object'&&module.exports?require('./core.js'):root.RewardsCore;const api=factory(parser,core);if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsReader=api;})(globalThis,(parser,core)=>{
 'use strict';
 const REWARDS='https://rewards.bing.com/?ref=rewardspanel',LIMIT=6000000;
 const isRewards=url=>{try{const u=new URL(url);return u.protocol==='https:'&&['rewards.bing.com','rewards.microsoft.com'].includes(u.hostname)&&!u.username&&!u.password;}catch{return false;}};
 async function rewardsPageRead(){
  const origin=location.origin;
  if(!['https://rewards.bing.com','https://rewards.microsoft.com'].includes(origin))return null;
  try{const response=await fetch(origin+'/?ref=rewardspanel',{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(7000)});
   if(location.origin!==origin||!response.ok||new URL(response.url).origin!==origin)return null;
   const html=await response.text();if(location.origin!==origin||html.length>6000000)return null;
   return {html,url:response.url};
  }catch{return null;}
 }
 function createReader(browser,fetcher=globalThis.fetch){
  const storage=browser.storage.session||browser.storage.local;
  async function bounded(promise){let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),8000);})]);}finally{clearTimeout(timer);}}
  async function read(expectedEmail=null,current=()=>true){
   if(!current())return null;
   function parse(value,stamp){
    if(!current()||!isRewards(value?.url)||typeof value?.html!=='string'||value.html.length>LIMIT)return null;
    const snapshot=parser.readHtml(value.html,{now:stamp,timezone:'Europe/Rome'}),email=snapshot.account?.email;
    return snapshot.diagnostics.recognized&&core.validNumber(snapshot.balance)&&email&&(!expectedEmail||email===expectedEmail)?snapshot:null;
   }
   const startedAt=Date.now();
   try{const response=await fetcher(REWARDS,{method:'GET',credentials:'include',cache:'no-store',redirect:'follow',signal:AbortSignal.timeout(7000)});
    if(response.ok&&isRewards(response.url)){const snapshot=parse({html:await response.text(),url:response.url},startedAt);if(snapshot)return {snapshot,transport:'worker'};}
   }catch{}
   if(!current()||!browser.scripting?.executeScript)return null;
   let tabs=[];try{tabs=(await browser.tabs.query({url:['https://rewards.bing.com/*','https://rewards.microsoft.com/*']})).filter(t=>isRewards(t.url)&&!t.discarded&&!t.frozen&&t.status==='complete');}catch{}
   const saved=await storage.get(['readerHelperTab','readerHelperCreatedAt']);if(!current())return null;
   tabs.sort((a,b)=>(a.id===saved.readerHelperTab?-1:0)-(b.id===saved.readerHelperTab?-1:0));
   async function inTab(tab){
    if(!current()||!Number.isInteger(tab?.id))return null;const stamp=Date.now();
    try{const values=await bounded(browser.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:rewardsPageRead}));
     const snapshot=parse(values?.[0]?.result,stamp);return snapshot?{snapshot,transport:'tab'}:null;
    }catch{return null;}
   }
   for(const tab of tabs.slice(0,2)){const result=await inTab(tab);if(result)return result;if(!current())return null;}
   // One helper per browser session, with a cooldown if it was closed. User tabs
   // are never activated, navigated or closed by this recovery path.
   if(saved.readerHelperTab){try{const existing=await browser.tabs.get(saved.readerHelperTab);if(isRewards(existing?.url)||isRewards(existing?.pendingUrl))return null;}catch{}}
   if(Date.now()-(saved.readerHelperCreatedAt||0)<300000||!current())return null;
   await storage.set({readerHelperCreatedAt:Date.now()});if(!current())return null;
   let helper;try{helper=await browser.tabs.create({url:REWARDS,active:false});await storage.set({readerHelperTab:helper.id});if(browser.tabs.update)await browser.tabs.update(helper.id,{autoDiscardable:false}).catch(()=>{});}catch{return null;}
   const end=Date.now()+8000;
   while(current()&&helper.status!=='complete'&&Date.now()<end){
    await new Promise(resolve=>setTimeout(resolve,200));try{helper=await browser.tabs.get(helper.id);}catch{return null;}
    if(!isRewards(helper.url)&&!isRewards(helper.pendingUrl))return null;
   }
   return current()&&helper.status==='complete'&&isRewards(helper.url)?inTab(helper):null;
  }
  return {read};
 }
 return {createReader,rewardsPageRead,isRewards};
});
