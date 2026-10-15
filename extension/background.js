if(typeof importScripts==='function')importScripts('strings.js','i18n.js','core.js','search.js');
(function(root,factory){const core=typeof module==='object'&&module.exports?require('./core.js'):root.RewardsCore;const search=typeof module==='object'&&module.exports?require('./search.js'):root.RewardsSearch;const api=factory(core,search);if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsBackground=api;})(globalThis,(core,search)=>{
 'use strict';
 const BASE='http://127.0.0.1:18743',REWARDS='https://rewards.bing.com/?ref=rewardspanel';
 const SEARCH='https://www.bing.com/rewardsapp/flyoutdata?channel=bingflyout&partnerId=BingRewards',BING='https://www.bing.com/';
 const matches=['https://rewards.bing.com/*','https://rewards.microsoft.com/*'];
 async function bingPageRead(){
  const origin='https://www.bing.com';
  async function read(url,max){
   if(location.origin!==origin)throw new Error('Origin changed');
   const response=await fetch(url,{method:'GET',credentials:'same-origin',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});
   if(location.origin!==origin||!response.ok||response.url&&new URL(response.url).origin!==origin)throw new Error('Bing unavailable');
   const text=await response.text();if(location.origin!==origin||text.length>max)throw new Error('Bing unavailable');return text;
  }
  try{return {beforeHtml:await read('https://www.bing.com/',4000000),flyoutText:await read('https://www.bing.com/rewardsapp/flyoutdata?channel=bingflyout&partnerId=BingRewards',3000000),afterHtml:await read('https://www.bing.com/',4000000)};}
  catch{return {status:'unavailable'};}
 }
 function isRewards(url){try{const u=new URL(url);return u.protocol==='https:'&&['rewards.bing.com','rewards.microsoft.com'].includes(u.hostname);}catch{return false;}}
 function senderAllowed(sender,type,extensionId){if(sender.id!==extensionId)return false;if(['ui/','extension/ui/'].some(path=>sender.url?.startsWith(`chrome-extension://${extensionId}/${path}`)))return true;return !!sender.tab&&isRewards(sender.url)&&['CAPTURE','PING'].includes(type);}
 function createAdviser(browser,fetcher=globalThis.fetch,prefix=globalThis.location?.pathname?.endsWith('/extension/background.js')?'extension/':'') {
  const language=globalThis.RewardsI18n||(typeof require==='function'?require('./i18n.js'):null);
  const tr=language?language.create(browser.i18n?.getUILanguage?.()||globalThis.navigator?.language||'en',browser.i18n?.getMessage?.bind(browser.i18n)).t:(text=>text);
  let pending=null,lastTick=0,configVersion=0,changingConfig=false,pageRead=null;
  async function changeConfig(action){
   if(changingConfig)throw new Error(tr('Attendi il salvataggio delle impostazioni in corso.'));
   changingConfig=true;configVersion++;
   try{if(pending)await pending.catch(()=>{});return await action();}
   finally{configVersion++;changingConfig=false;}
  }
  async function config(){let {config:c}=await browser.storage.local.get(['config']);if(!c){c={clientId:crypto.randomUUID(),token:'',slot:null,alias:'Account',email:'',browser:globalThis.navigator?.userAgent?.includes('Edg/')?'Edge':'Chrome',coordinator:false,autoRefresh:false};await browser.storage.local.set({config:c});}
   if(!c.token){try{const response=await fetcher(browser.runtime.getURL(prefix+'local-link.json'),{cache:'no-store'});if(response.ok){const link=await response.json();if(link.app==='rewards-realtime-adviser'&&typeof link.token==='string'&&/^[a-f0-9]{48}$/i.test(link.token)){c={...c,token:link.token};await browser.storage.local.set({config:c});}}}catch{}}
   return c;
  }
  async function api(route,body,cfg){const c=cfg||await config();if(!c.token)throw new Error(tr('Collega questo profilo nelle impostazioni.'));
   const response=await fetcher(BASE+route,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(6000)});
   const result=await response.json();if(!response.ok)throw new Error(tr(result.error||'Collegamento locale non disponibile.'));return result;
  }
  async function cache(state){await browser.storage.local.set({state,connection:{online:true,at:Date.now(),error:null}});return state;}
  async function saveConfig(raw){
   if(!raw||!/^([a-f0-9]{48})$/i.test((raw.token||'').trim()))throw new Error(tr('Avvia AVVIA.cmd nella cartella del progetto, poi riapri le impostazioni: il collegamento verrà compilato automaticamente.'));
   if(raw.slot!==null&&![1,2,3].includes(raw.slot))throw new Error(tr('Scegli un account valido.'));
   if(!['Edge','Chrome','Brave'].includes(raw.browser))throw new Error(tr('Scegli il browser del profilo.'));
   if(raw.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw.email.trim()))throw new Error(tr('Email Microsoft non valida.'));
   return changeConfig(async()=>{const old=await config(),alias=String(raw.alias||'').trim();const c={clientId:old.clientId,token:raw.token.trim(),slot:raw.slot,alias:(alias&&alias!=='Account'?alias:core.defaultAlias(raw.slot)).slice(0,80),email:String(raw.email||'').trim().toLowerCase(),browser:raw.browser,coordinator:raw.coordinator===true,autoRefresh:raw.autoRefresh===true};
   const result=await api('/api/heartbeat',{clientId:c.clientId,config:c},c);await browser.storage.local.set({config:c,...(old.slot!==c.slot||old.email!==c.email?{searchBinding:null,searchCache:null,searchAttempt:0}:{})});await cache(result.state);return c;});
  }
  async function dashboards(){return (await browser.tabs.query({url:matches})).filter(t=>isRewards(t.url));}
  async function performCommand(command){const tabs=await dashboards();
   if(command.action==='open'){if(tabs.length)await browser.tabs.update(tabs[0].id,{active:true});else await browser.tabs.create({url:REWARDS,active:true});return;}
   if(command.action==='refresh'){await browser.storage.local.set({searchAttempt:0,searchCache:null});if(tabs.length)await Promise.all(tabs.map(t=>browser.tabs.reload(t.id)));else await browser.tabs.create({url:REWARDS,active:false});return;}
   if(command.action==='scan')for(const tab of tabs){try{await browser.tabs.sendMessage(tab.id,{type:'SCAN'});}catch{try{await browser.scripting.executeScript({target:{tabId:tab.id},files:['core.js','parser.js','content.js'].map(file=>prefix+file)});}catch{}}}
  }
  async function tick(force=false){
   if(changingConfig)return (await browser.storage.local.get(['state'])).state;
   if(pending)return pending;
   if(!force&&Date.now()-lastTick<8000)return (await browser.storage.local.get(['state'])).state;
   pending=(async()=>{try{const c=await config();const response=await api('/api/heartbeat',{clientId:c.clientId,config:c});lastTick=Date.now();await cache(response.state);
    for(const cmd of response.commands||[]){await performCommand(cmd);await api('/api/ack',{clientId:c.clientId,commandId:cmd.id});}
    return response.state;
   }catch(error){await browser.storage.local.set({connection:{online:false,at:Date.now(),error:error.message}});throw error;}finally{pending=null;}})();return pending;
  }
  async function readBingInTab(generation){
   if(!browser.scripting?.executeScript||changingConfig||generation!==configVersion)return null;
   if(pageRead?.generation===generation)return pageRead.promise;
   const job={generation};pageRead=job;
   job.promise=(async()=>{try{
    const isBing=tab=>{try{return new URL(tab.url).origin==='https://www.bing.com';}catch{return false;}};
    const tabs=(await browser.tabs.query({url:['https://www.bing.com/*']})).filter(isBing);let tab=tabs.find(t=>t.status==='complete')||tabs[0],created=false;
    if(!tab){const {bingTabOpenedAt=0}=await browser.storage.local.get(['bingTabOpenedAt']);if(Date.now()-bingTabOpenedAt<300000||changingConfig||generation!==configVersion)return null;
     await browser.storage.local.set({bingTabOpenedAt:Date.now()});if(changingConfig||generation!==configVersion)return null;tab=await browser.tabs.create({url:BING,active:false});created=true;
    }
    if(!Number.isInteger(tab?.id))return null;
    if(tab.status!=='complete'&&browser.tabs.get){const end=Date.now()+8000;while(Date.now()<end){if(changingConfig||generation!==configVersion)return null;tab=await browser.tabs.get(tab.id);const ownPending=created&&tab.pendingUrl===BING&&(!tab.url||tab.url==='about:blank');if(!isBing(tab)&&!ownPending)return null;if(tab.status==='complete'){if(!isBing(tab))return null;break;}await new Promise(resolve=>setTimeout(resolve,200));}if(tab.status!=='complete')return null;}
    if(changingConfig||generation!==configVersion)return null;
    const result=await browser.scripting.executeScript({target:{tabId:tab.id,frameIds:[0]},world:'ISOLATED',func:bingPageRead});
    if(changingConfig||generation!==configVersion)return null;const value=result?.[0]?.result;
    return value&&typeof value.beforeHtml==='string'&&value.beforeHtml.length<=4000000&&typeof value.afterHtml==='string'&&value.afterHtml.length<=4000000&&typeof value.flyoutText==='string'&&value.flyoutText.length<=3000000?value:null;
   }catch{return null;}finally{if(pageRead===job)pageRead=null;}})();return job.promise;
  }
  async function withSearch(snapshot,c,generation){
   const now=Date.now(),email=snapshot?.account?.email;
   if(!snapshot?.diagnostics?.recognized||snapshot.date!==core.dayKey(now)||!email||!Number.isFinite(snapshot.observedAt)||now-snapshot.observedAt>300000||snapshot.observedAt>now+30000)return snapshot;
   if(c.email&&c.email!==email)return search.merge(snapshot,{status:'account-mismatch'},now);
   const {searchBinding,searchCache,searchAttempt=0}=await browser.storage.local.get(['searchBinding','searchCache','searchAttempt']);
   if(searchCache?.email===email&&now-searchAttempt<60000)return search.merge(snapshot,searchCache.reading,now);
   await browser.storage.local.set({searchAttempt:now});let reading;
   async function readText(url,max){const response=await fetcher(url,{credentials:'include',cache:'no-store',redirect:'error',signal:AbortSignal.timeout(5000)});if(!response.ok||response.url&&new URL(response.url).origin!=='https://www.bing.com')throw new Error('Bing unavailable');const text=await response.text();if(text.length>max)throw new Error('Bing response too large');return text;}
   try{
    let beforeEmail=null,afterEmail=null,data;
    try{beforeEmail=search.emailFromHome(await readText(BING,4000000));data=JSON.parse(await readText(SEARCH,3000000));reading=search.fromData(data);if(reading.status==='ok')afterEmail=search.emailFromHome(await readText(BING,4000000));}
    catch{reading={status:'unavailable'};}
    if(beforeEmail&&beforeEmail!==email||afterEmail&&afterEmail!==email)reading={status:'account-mismatch'};
    else if(reading.status==='ok'&&(!beforeEmail||!afterEmail))reading={status:'identity-unverified'};
    if(['not-signed-in','unavailable','identity-unverified'].includes(reading.status)){
     const page=await readBingInTab(generation);
     if(page){beforeEmail=search.emailFromHome(page.beforeHtml);afterEmail=search.emailFromHome(page.afterHtml);data=JSON.parse(page.flyoutText);reading=search.fromData(data);if(beforeEmail&&beforeEmail!==email||afterEmail&&afterEmail!==email)reading={status:'account-mismatch'};}
    }
    if(reading.status==='ok'){
     const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(reading.subject||''));reading={...reading,subject:Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')};
     if(typeof data.UserId!=='string'||!data.UserId.trim())reading.subject=null;
     reading.email=afterEmail;
     if(changingConfig||generation!==configVersion)return null;
     if(beforeEmail!==email||reading.email!==email)reading={status:beforeEmail&&reading.email?'account-mismatch':'identity-unverified'};
     else{
     const identity=search.identityStatus(snapshot,reading,searchBinding);
     if(identity==='initial-match')await browser.storage.local.set({searchBinding:{email,subject:reading.subject}});
     else if(identity!=='linked')reading={status:identity};
     }
    }
   }catch{reading={status:'unavailable'};}
   if(changingConfig||generation!==configVersion)return null;
   reading={...reading,date:core.dayKey(now),observedAt:now};
   await browser.storage.local.set({searchCache:{email,reading}});return search.merge(snapshot,reading,Date.now());
  }
  async function capture(snapshot){if(changingConfig)return {accepted:false};const generation=configVersion,c=await config();if(changingConfig||generation!==configVersion)return {accepted:false};if(!c.token||!c.slot){await browser.storage.local.set({localSnapshot:snapshot});return {accepted:false};}
   await tick();if(changingConfig||generation!==configVersion)return {accepted:false};snapshot=await withSearch(snapshot,c,generation);if(!snapshot||changingConfig||generation!==configVersion)return {accepted:false};await browser.storage.local.set({localSnapshot:snapshot});if(changingConfig||generation!==configVersion)return {accepted:false};const response=await api('/api/snapshot',{clientId:c.clientId,slot:c.slot,expectedEmail:c.email||null,snapshot},c);if(!changingConfig&&generation===configVersion)await cache(response.state);return {accepted:response.accepted};
  }
  async function remind(state,now=Date.now()){
   const c=await config(),{lastNotificationAt=0}=await browser.storage.local.get(['lastNotificationAt']);
   if(!c.coordinator||state?.coordinatorId!==c.clientId||state.settings?.notifications===false||state.settings?.snoozeUntil>now||now-lastNotificationAt<590000)return;
   const targets=core.reminderAccounts(state.accounts||[],now,state.settings?.timezone);if(!targets.length){await browser.action.setBadgeText({text:''});return;}
   const message=targets.map(({account,summary})=>{const known=summary.actionable.reduce((n,a)=>n+(a.remaining??0),0);return tr`${account.alias||'Account'}: ${summary.actionable.length} attività da fare${known?tr`, ${known} punti noti`:''}${summary.actionable.some(a=>a.remaining===null)?tr(' + punti non indicati'):''}`;}).join('\n');
   await browser.notifications.create('rewards-reminder',{type:'basic',iconUrl:browser.runtime.getURL(prefix+'icons/icon128.png'),title:tr('Rewards: ci sono attività da completare'),message,buttons:[{title:tr('Apri riepilogo')},{title:tr('Pausa 30 minuti')}]});
   await browser.storage.local.set({lastNotificationAt:now});await browser.action.setBadgeBackgroundColor({color:'#39d8b0'});await browser.action.setBadgeText({text:String(targets.length)});
  }
  async function getView(){try{await tick(true);}catch{}const data=await browser.storage.local.get(['state','connection']);return {...data,config:await config()};}
  async function handle(message){
   if(message.type==='GET')return getView();
   if(message.type==='CONFIG'){await saveConfig(message.config);return getView();}
   if(message.type==='PING')return tick();
   if(message.type==='CAPTURE')return capture(message.snapshot);
   if(message.type==='COMMAND'){return api('/api/command',{target:message.target,action:message.action});}
   if(message.type==='MANUAL'){const result=await api('/api/manual',{slot:message.slot,activities:message.activities});await cache(result.state);return result;}
   if(message.type==='SETTINGS'){const result=await api('/api/settings',message.settings);await cache(result.state);return result;}
   if(message.type==='PHONE_SETTINGS'){const result=await api('/api/phone/settings',message.settings);await cache(result.state);return result;}
   if(message.type==='DUMP'){const {state,localSnapshot}=await browser.storage.local.get(['state','localSnapshot']);const snapshot=state?.accounts?.find(a=>a.slot===message.slot)?.snapshot||localSnapshot;return core.sanitizeDump(snapshot);}
   if(message.type==='RESET')return changeConfig(async()=>{const c=await config();if(!c.slot)throw new Error(tr('Questo profilo non è un lettore.'));const result=await api('/api/reset',{slot:c.slot,clientId:c.clientId},c);await browser.storage.local.set({config:{...c,email:''},searchBinding:null,searchCache:null,searchAttempt:0});return result;});
   if(message.type==='TEST_NOTIFICATION'){await browser.notifications.create('rewards-test',{type:'basic',iconUrl:browser.runtime.getURL(prefix+'icons/icon128.png'),title:tr('Rewards Adviser · prova'),message:tr('I promemoria sono pronti. Quelli automatici arrivano ogni 10 minuti quando ci sono attività incomplete verificabili.')});return {ok:true};}
   if(message.type==='EXPAND'){await browser.tabs.create({url:browser.runtime.getURL(prefix+'ui/index.html?expanded=1')});return {ok:true};}
   throw new Error(tr('Operazione non disponibile.'));
  }
  async function alarm(name){let state;try{state=await tick(true);}catch{return;}
   if(name==='rewards-reminder')await remind(state);
   if(name==='rewards-sync'){
    const c=await config(),{lastReload=0}=await browser.storage.local.get(['lastReload']);
    if(c.slot&&c.autoRefresh&&Date.now()-lastReload>=120000){await browser.storage.local.set({lastReload:Date.now()});const tabs=await dashboards();await Promise.all(tabs.map(t=>browser.tabs.reload(t.id)));}
   }
  }
  return {config,saveConfig,api,tick,capture,getView,performCommand,remind,handle,alarm};
 }
 return {createAdviser,isRewards,senderAllowed,bingPageRead};
});

if(typeof chrome==='object'&&chrome.runtime?.onMessage){
 const adviser=RewardsBackground.createAdviser(chrome);
 async function setup(){await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
  for(const [name,periodInMinutes] of [['rewards-sync',1],['rewards-reminder',10]])if(!await chrome.alarms.get(name))await chrome.alarms.create(name,{delayInMinutes:periodInMinutes,periodInMinutes});
 }
 setup().catch(()=>{});chrome.runtime.onInstalled.addListener(()=>{setup().then(()=>adviser.performCommand({action:'scan'})).catch(()=>{});});chrome.runtime.onStartup.addListener(()=>{setup().then(()=>adviser.tick(true)).catch(()=>{});});
 chrome.alarms.onAlarm.addListener(alarm=>adviser.alarm(alarm.name).catch(()=>{}));
 chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
  if(!RewardsBackground.senderAllowed(sender,message?.type,chrome.runtime.id))return false;
  adviser.handle(message).then(data=>sendResponse({ok:true,data})).catch(error=>sendResponse({ok:false,error:error.message}));return true;
 });
 chrome.notifications.onClicked.addListener(id=>{if(id.startsWith('rewards-'))adviser.handle({type:'EXPAND'}).catch(()=>{});});
 chrome.notifications.onButtonClicked.addListener((id,index)=>{if(id!=='rewards-reminder')return;if(index===0)adviser.handle({type:'EXPAND'}).catch(()=>{});else adviser.handle({type:'SETTINGS',settings:{snoozeUntil:Date.now()+1800000}}).then(()=>chrome.notifications.clear(id)).catch(()=>{});});
}
