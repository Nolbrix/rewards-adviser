/* Shared pure data rules; usable in extension pages, workers and Node tests. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsCore=api;})(globalThis,()=>{
 'use strict';
 const CATEGORIES=['daily','extra','claim','search','desktop','mobile','phone'];
 const SEARCH_STATUSES=['ok','not-signed-in','account-mismatch','unavailable','identity-unverified'];
 const DEFAULT_NAMES=['Account 1','Account 2','Account 3'];
 const defaultAlias=slot=>DEFAULT_NAMES[Number(slot)-1]||'Pannello';
 function dayKey(now=Date.now(),timezone='Europe/Rome') {
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now));
  const get=t=>parts.find(p=>p.type===t).value;return `${get('year')}-${get('month')}-${get('day')}`;
 }
 const validNumber=v=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0&&v<=100000000;
 const articleId=id=>id==='manual-read'||id==='phone-articles';
 function phoneObservation(account={},now=Date.now(),timezone='Europe/Rome') {
  const raw=account.phoneReading,required=account.phoneReaderEnabled===true,present=raw!==null&&raw!==undefined;
  if(!present&&!required)return {present:false,required:false,current:false,fresh:false,active:false,ageMs:null,item:null};
  const stamp=raw?.observedAt,validStamp=typeof stamp==='number'&&Number.isFinite(stamp)&&Math.abs(stamp)<=8640000000000000,current=raw?.date===dayKey(now,timezone);
  const valid=raw?.source==='phone-screen'&&validNumber(raw?.earned)&&raw.earned<=30&&raw?.total===30&&validStamp&&dayKey(stamp,timezone)===raw.date;
  const error=account.phoneError,failed=['calibration-needed','waiting-phone','interrupted','unreadable','account-unavailable','error'].includes(error?.status)&&typeof error?.at==='number'&&Number.isFinite(error.at)&&error.at<=now+2000&&(!validStamp||error.at>=stamp);
  const fresh=valid&&current&&now-stamp<=300000&&stamp<=now+2000&&!failed&&account.phoneReaderEnabled!==false,active=fresh&&!account.error;
  const earned=valid?raw.earned:null,status=earned===null?'unknown':earned===30?'complete':'incomplete';
  const item={id:'phone-articles',title:'Letture articoli Bing',category:'phone',date:raw?.date||null,observedAt:validStamp?stamp:null,total:30,earned,status,source:'phone-screen',remaining:earned===null?null:30-earned,active};
  return {present,required,current,fresh,active,failed,ageMs:validStamp?Math.max(0,now-stamp):null,item};
 }
 function safeUrl(value){try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='bing.com'||u.hostname.endsWith('.bing.com')||u.hostname==='rewards.microsoft.com')?u.href:null;}catch{return null;}}
 function summarize(account={},now=Date.now(),timezone='Europe/Rome') {
  const today=dayKey(now,timezone),snapshot=account.snapshot,combined=snapshot?.searchMode==='combined';
  const current=!!snapshot&&snapshot.date===today;
  const fresh=current&&now-snapshot.observedAt<=300000&&snapshot.observedAt<=now+30000;
  const usable=fresh&&!account.error;
  const phone=phoneObservation(account,now,timezone),manual=(account.manual||[]).filter(a=>a.date===today);
  const override=!phone.fresh&&manual.find(a=>articleId(a.id)&&typeof a.confirmedAt==='number'&&Number.isFinite(a.confirmedAt)&&a.confirmedAt<=now+2000&&(!Number.isFinite(phone.item?.observedAt)||a.confirmedAt>=phone.item.observedAt));
  const seen=new Set(),items=[];
  for(const raw of [...(override?[override]:phone.present||phone.required?[phone.item]:[]),...(current?snapshot.activities||[]:[]),...manual]) {
   if(!raw||!CATEGORIES.includes(raw.category)||raw.status==='not-applicable')continue;
   if(combined?['desktop','mobile'].includes(raw.category):raw.category==='search')continue;
   const id=String(raw.id||`${raw.category}:${raw.title}`),category=raw.category==='extra'&&id==='pointsclaim'?'claim':raw.category,semantic=raw.category==='phone'&&articleId(id)?'phone-articles':id;if(seen.has(semantic))continue;seen.add(semantic);
   const total=validNumber(raw.total)?raw.total:null,earned=validNumber(raw.earned)?raw.earned:null;
   const status=['complete','incomplete','unknown'].includes(raw.status)?raw.status:'unknown';
   const remaining=total!==null&&earned!==null&&earned<=total?Math.max(0,total-earned):null;
   items.push({...raw,id,category,total,earned,status,remaining,active:!account.error&&(raw.source==='phone-screen'?phone.active:raw.source==='manual'||usable)});
  }
  const earning=items.filter(a=>a.category!=='claim');
  const incomplete=earning.filter(a=>a.status==='incomplete').length,unknown=earning.filter(a=>a.status==='unknown').length;
  const missingCoverage=!current||(combined?['daily','extra','search']:['daily','extra','search','mobile']).some(k=>snapshot.coverage?.[k]!==true);
  const partial=!usable||missingCoverage||unknown>0||((phone.present||phone.required)&&!phone.active&&!override)||earning.some(a=>a.status!=='complete'&&a.remaining===null);
  const hasProgress=earning.some(a=>a.active&&a.remaining!==null&&a.status!=='unknown')||!!(usable&&['daily','extra'].some(k=>snapshot.coverage?.[k]===true));
  const remaining=earning.reduce((n,a)=>n+(a.active&&a.status==='incomplete'&&a.remaining!==null?a.remaining:0),0);
  const claimable=items.reduce((n,a)=>n+(a.category==='claim'&&a.active&&a.status==='incomplete'&&a.remaining!==null?a.remaining:0),0);
  const groups=Object.fromEntries(CATEGORIES.map(c=>[c,items.filter(a=>a.category===c)]));
  const actionable=earning.filter(a=>a.active&&a.status==='incomplete');
  return {today,current,fresh,hasProgress,stale:!!snapshot&&!fresh,remaining,claimable,incomplete,unknown,partial,completed:hasProgress&&!partial&&earning.length>0&&incomplete===0,items,groups,actionable};
 }
 function reminderAccounts(accounts,now=Date.now(),timezone='Europe/Rome') {return accounts.map(a=>({account:a,summary:summarize(a,now,timezone)})).filter(a=>a.summary.actionable.length>0);}
 function sanitizeDump(snapshot={}) {
  const clean={version:1,date:snapshot.date||null,observedAt:snapshot.observedAt||null,balance:validNumber(snapshot.balance)?snapshot.balance:null,account:{email:'[oscurata]'},coverage:{},activities:[]};
  if(['combined','separate'].includes(snapshot.searchMode))clean.searchMode=snapshot.searchMode;
  if(SEARCH_STATUSES.includes(snapshot.diagnostics?.searchStatus))clean.diagnostics={searchStatus:snapshot.diagnostics.searchStatus};
  for(const k of ['daily','extra','search','mobile'])clean.coverage[k]=snapshot.coverage?.[k]===true;
  clean.activities=(snapshot.activities||[]).slice(0,500).map(a=>{
   const item={category:CATEGORIES.includes(a.category)?a.category:'extra',title:String(a.title||'').slice(0,200).replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[email oscurata]'),status:['complete','incomplete','unknown'].includes(a.status)?a.status:'unknown',earned:validNumber(a.earned)?a.earned:null,total:validNumber(a.total)?a.total:null,source:'page'};
   const url=safeUrl(a.url);if(url){const u=new URL(url);item.url=u.origin+u.pathname;}return item;
  });return clean;
 }
 return {CATEGORIES,DEFAULT_NAMES,defaultAlias,dayKey,validNumber,safeUrl,phoneObservation,summarize,reminderAccounts,sanitizeDump};
});
