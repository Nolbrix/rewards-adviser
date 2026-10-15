(function(root,factory){const core=typeof module==='object'&&module.exports?require('./core.js'):root.RewardsCore;const api=factory(core);if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsParser=api;})(globalThis,core=>{
 'use strict';
 function number(v) {
  if(core.validNumber(v))return v;if(typeof v!=='string')return null;
  const text=v.trim();if(!/^\d+$|^\d{1,3}([.,\s]\d{3})+$/.test(text))return null;
  const n=Number(text.replace(/[.,\s]/g,''));return core.validNumber(n)?n:null;
 }
 function empty(options={}) {const now=options.now??Date.now();return {date:core.dayKey(now,options.timezone),observedAt:now,account:{email:null},balance:null,activities:[],coverage:{daily:false,extra:false,search:false,mobile:false},diagnostics:{method:'unrecognized',recognized:false}};}
 function extractData(text) {
  if(typeof text!=='string'||text.length>3000000)return null;
  const trimmed=text.trim();try {if(trimmed.startsWith('{')||trimmed.startsWith('['))return JSON.parse(trimmed);}catch{}
  const match=/(?:\b(?:dashboard|__INITIAL_STATE__|__NEXT_DATA__)\s*=\s*)(\{)/.exec(text);if(!match)return null;
  const start=match.index+match[0].length-1;let depth=0,inString=false,escaped=false;
  for(let i=start;i<text.length;i++){const c=text[i];if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;}else if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{return JSON.parse(text.slice(start,i+1));}catch{return null;}}}return null;
 }
 function findDashboard(data) {
  const queue=[data];let count=0;while(queue.length&&count++<1500){const x=queue.shift();if(!x||typeof x!=='object')continue;
   if(x.userStatus||x.dailySetPromotions||x.morePromotions)return x;
   queue.push(...Object.values(x).filter(v=>v&&typeof v==='object'));}return null;
 }
 function promotion(p,category,index) {
  if(!p||typeof p!=='object')return null;
  const total=number(p.pointProgressMax??p.points??p.attributes?.points),progress=number(p.pointProgress??p.attributes?.pointProgress);
  const complete=p.complete===true||p.isComplete===true||p.isCompleted===true;
  const explicitlyIncomplete=p.complete===false||p.isComplete===false||p.isCompleted===false;
  const earned=progress!==null?progress:(complete?total:(explicitlyIncomplete?0:null));
  const status=complete?'complete':explicitlyIncomplete?'incomplete':(earned!==null&&total!==null?(earned>=total?'complete':'incomplete'):'unknown');
  return {id:String(p.offerId||p.id||`${category}:${index}:${p.title||''}`).slice(0,160),title:String(p.title||p.name||'Attività Rewards').replace(/<[^>]*>/g,'').slice(0,240),category,total,earned,status,source:'page',url:core.safeUrl(p.destinationUrl||p.destination||p.url)};
 }
 function fromData(data,options={}) {
  const s=empty(options),d=findDashboard(data);if(!d)return s;
  s.diagnostics={method:'structured',recognized:true};const u=d.userStatus||{};
  s.balance=number(u.availablePoints);const email=u.email||u.emailAddress||u.userEmail;
  if(typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))s.account.email=email.slice(0,254).toLowerCase();
  let daily=d.dailySetPromotions;
  if(daily&&!Array.isArray(daily)&&typeof daily==='object'){
   const [y,m,day]=s.date.split('-');daily=daily[s.date]??daily[`${Number(m)}/${Number(day)}/${y}`]??daily[`${m}/${day}/${y}`];
  }
  if(Array.isArray(daily)){s.coverage.daily=true;daily.forEach((p,i)=>{const a=promotion(p,'daily',i);if(a)s.activities.push(a);});}
  if(Array.isArray(d.morePromotions)){s.coverage.extra=true;d.morePromotions.forEach((p,i)=>{const a=promotion(p,'extra',i);if(a)s.activities.push(a);});}
  const counters=u.counters||{};
  for(const [key,category,label] of [['pcSearch','desktop','Ricerche da PC'],['mobileSearch','mobile','Ricerche da telefono']]) {
   const raw=counters[key];if(!Array.isArray(raw)||!raw.length)continue;
   const values=raw.map(c=>({earned:number(c.pointProgress),total:number(c.pointProgressMax)}));
   if(values.some(v=>v.earned===null||v.total===null||v.earned>v.total))continue;
   const total=values.reduce((n,v)=>n+v.total,0),earned=values.reduce((n,v)=>n+v.earned,0);
   s.activities.push({id:category,title:label,category,total,earned,status:earned>=total?'complete':'incomplete',source:'page',url:null});
   s.coverage[category==='desktop'?'search':'mobile']=true;
  }
  const seen=new Set();s.activities=s.activities.filter(a=>{if(seen.has(a.id))return false;seen.add(a.id);return true;});return s;
 }
 function readFlight(scripts,options={}) {
  const s=empty(options),chunks=[];let length=0;
  // Decode only JSON strings in Next.js stream records; page JavaScript is never run.
  const push=/\bself\.__next_f\.push\(\s*\[\s*1\s*,\s*("(?:\\.|[^"\\])*")\s*\]\s*\)/g;
  for(const text of scripts){if(typeof text!=='string'||text.length>3000000)continue;
   for(const match of text.matchAll(push)){try{const value=JSON.parse(match[1]);length+=value.length;if(length>6000000)return s;chunks.push(value);}catch{}}
  }
  const queue=[];
  for(const line of chunks.join('').split('\n')){const match=/^[0-9a-f]+:(\[.*|\{.*)$/.exec(line);if(!match)continue;try{queue.push(JSON.parse(match[1]));}catch{}}
  const seen=new Set(),bonusLabels={starbonus:'Bonus Star Bing',levelbonus:'Bonus aumento livello mensile',dsebonus:'Bonus per motore di ricerca predefinito'};
  function add(a){if(a&&!seen.has(a.id)){seen.add(a.id);s.activities.push(a);}}
  function profileEmail(root){const nodes=[root];let email=null,profile=false;
   for(let i=0;i<nodes.length&&i<500;i++){const v=nodes[i];if(!v||typeof v!=='object')continue;
    if(v.instrument?.name==='HeaderProfileFlyout_Logout')profile=true;
    if(typeof v.className==='string'&&v.className.split(/\s+/).includes('pii')&&typeof v.children==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.children))email=v.children.toLowerCase().slice(0,254);
    for(const child of Object.values(v))if(child&&typeof child==='object')nodes.push(child);
   }return profile?email:null;
  }
  let count=0,recognized=false;
  for(let i=0;i<queue.length&&count++<20000;i++){
   const x=queue[i];if(!x||typeof x!=='object')continue;
   if(!Array.isArray(x)){
    if(x.key==='SearchAndEarn'&&x.supportedLevels&&['newLevel1','newLevel2','newLevel3'].some(k=>Object.hasOwn(x.supportedLevels,k)))s.searchMode='combined';
    if(typeof x.className==='string'&&x.className.split(/\s+/).includes('rounded-cornerFlyoutRest'))s.account.email=profileEmail(x)||s.account.email;
    if(number(x.balance)!==null&&number(x.level)!==null){s.balance=number(x.balance);recognized=true;}
    if(x.type==='dailyset'&&Array.isArray(x.model?.dailySetItems)){
     const items=x.model.dailySetItems.filter(p=>{if(!p||typeof p!=='object')return false;const date=p.date;
      if(!date)return true;const m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);return (m?`${m[3]}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`:date)===s.date;
     });
     recognized=true;if(items.length||!x.model.dailySetItems.length){s.coverage.daily=true;items.forEach((p,index)=>add(promotion(p,'daily',index)));}
    }
    if(x.type==='pointsclaim'&&number(x.model?.pointClaim?.points)!==null){
     const total=number(x.model.pointClaim.points);recognized=true;add({id:'pointsclaim',title:'Punti bonus pronti da richiedere',category:'extra',total,earned:total===0?total:0,status:total===0?'complete':'incomplete',source:'page',url:null});
    }
    if(bonusLabels[x.type]&&x.model?.bonus){const b=x.model.bonus,complete=b.state==='complete';
     const total=number(complete?b.prevPointsEarned:b.pointsMax);add({id:x.type,title:bonusLabels[x.type],category:'extra',total,earned:complete?total:null,status:complete?'complete':'unknown',source:'page',url:null});
    }
   }
   for(const v of Object.values(x))if(v&&typeof v==='object')queue.push(v);
  }
  if(recognized)s.diagnostics={method:'next-flight',recognized:true};
  return s;
 }
 function readDocument(doc,options={}) {
  const scripts=[...doc.querySelectorAll('script')].map(script=>script.textContent||'');
  let s=readFlight(scripts,options);
  for(const script of scripts){
   const data=extractData(script);if(!data)continue;
   const candidate=fromData(data,options);if(candidate.diagnostics.recognized&&(!s.diagnostics.recognized||candidate.activities.length>s.activities.length))s=candidate;
  }
  const emailElements=doc.querySelectorAll('[data-rewards-email],#id_n,#id_l,[aria-label*="@"]');
  for(const el of emailElements){const value=el.getAttribute('data-rewards-email')||el.getAttribute('aria-label')||el.textContent;const match=value?.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);if(match){s.account.email=match[0].toLowerCase();break;}}
  if(s.diagnostics.recognized)return s;
  const balanceEl=doc.querySelector('[data-rewards-balance],#balanceToolTipDiv .pointsValue,#id_rc');
  if(balanceEl)s.balance=number(balanceEl.getAttribute('data-rewards-balance')||balanceEl.textContent);
  const cards=[...doc.querySelectorAll('[data-rewards-card],[data-offer-id],[data-offerid],.mee-card')].slice(0,500),seen=new Set();
  for(const [i,el] of cards.entries()){
   const text=(el.textContent||'').trim();if(!text||text.length>1600)continue;
   const title=(el.querySelector('h2,h3,h4,.mee-card-title')?.textContent||el.getAttribute('aria-label')||text.split('\n')[0]).trim();
   const section=el.closest('section,[role="region"],.mee-card-group');
   const label=(section?.getAttribute('aria-label')||section?.querySelector('h1,h2,h3')?.textContent||'').toLowerCase();
   const category=/daily set|set giornalier|serie giornalier/.test(label)?'daily':'extra';
   const id=el.getAttribute('data-offer-id')||el.getAttribute('data-offerid')||`${category}:${title}`;if(seen.has(id))continue;seen.add(id);
   const pointsText=el.getAttribute('data-points')||text.match(/(?:\+\s*)?(\d+)\s*(?:punti|points)\b/i)?.[1];
   const marker=el.getAttribute('data-complete');
   const complete=marker==='true'||!!el.querySelector('.mee-icon-CheckMark,[aria-label="Completed"],[aria-label="Completato"]');
   const incomplete=marker==='false';const total=number(pointsText);
   s.activities.push({id,title:title.slice(0,240),category,total,earned:complete?total:incomplete?0:null,status:complete?'complete':incomplete?'incomplete':'unknown',source:'page',url:core.safeUrl(el.querySelector('a[href]')?.href)});
  }
  if(cards.length){s.diagnostics={method:'dom',recognized:s.activities.length>0};}
  // DOM cards do not prove that an entire section was loaded: keep coverage partial.
  return s;
 }
 return {number,extractData,fromData,readFlight,readDocument};
});
