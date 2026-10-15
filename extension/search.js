(function(root,factory){const core=typeof module==='object'&&module.exports?require('./core.js'):root.RewardsCore;const api=factory(core);if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsSearch=api;})(globalThis,core=>{
 'use strict';
 const empty=status=>({status,mode:'unknown',subject:null,balance:null,activities:[],coverage:{search:false,mobile:false}});
 function fromData(data){
  if(data?.IsAuthenticated!==true)return empty('not-signed-in');
  if(data.IsError===true||data.IsSuspendedUser===true||data.IsUnsupportedCountry===true)return empty('unavailable');
  const result=empty('unavailable'),u=data.FlyoutResult?.UserStatus,counters=u?.Counters||{};
  result.subject=typeof data.UserId==='string'&&data.UserId.trim().length<=256?data.UserId.trim():null;
  if(!result.subject||/^muid:/i.test(result.subject))return empty('identity-unverified');
  result.balance=core.validNumber(u?.AvailablePoints)?u.AvailablePoints:null;
  const types=new Set(),nodes=[data.FlyoutResult?.Layout?.Controls];
  for(let i=0;i<nodes.length&&i<3000;i++){const n=nodes[i];if(!n||typeof n!=='object')continue;
   const type=n.CustomProperties?.Counter;if(['PcCombined','PcSearch','MobileSearch'].includes(type))types.add(type);
   for(const v of Object.values(n))if(v&&typeof v==='object')nodes.push(v);
  }
  const valid=row=>row&&core.validNumber(row.PointProgress)&&core.validNumber(row.PointProgressMax)&&row.PointProgressMax>0&&row.PointProgress<=row.PointProgressMax;
  function add(id,category,title,earned,total){if(!core.validNumber(earned)||!core.validNumber(total)||earned>total)return;result.activities.push({id,category,title,earned,total,status:earned>=total?'complete':'incomplete',source:'page',url:null});}
  if(types.has('PcCombined')){
   result.mode='combined';const rows=counters.PCSearch;
   if(Array.isArray(rows)&&rows.length&&rows.length<=100&&rows.every(valid)){
    add('bing-search','search','Ricerche Bing · PC + telefono',rows.reduce((n,r)=>n+r.PointProgress,0),rows.reduce((n,r)=>n+r.PointProgressMax,0));
    result.coverage.search=result.activities.length>0;
   }
  }else if(types.has('PcSearch')||types.has('MobileSearch')){
   result.mode='separate';
   if(types.has('PcSearch')){const row=Array.isArray(counters.PCSearch)?counters.PCSearch.find(r=>r&&typeof r.OfferId==='string'&&!r.OfferId.toLowerCase().includes('edgeplusbing')):null;if(valid(row)){add('desktop','desktop','Ricerche da PC',row.PointProgress,row.PointProgressMax);result.coverage.search=true;}}
   if(types.has('MobileSearch')){const row=counters.MobileSearch?.[0];if(valid(row)){add('mobile','mobile','Ricerche da telefono',row.PointProgress,row.PointProgressMax);result.coverage.mobile=true;}}
  }
  if(result.activities.length)result.status='ok';return result;
 }
 function emailFromHome(html){
  if(typeof html!=='string'||html.length>4000000)return null;
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)){
   const text=match[1],start=/\bvar\s+_model\s*=\s*\{/.exec(text);if(!start)continue;
   let depth=0,inString=false,escaped=false;const first=start.index+start[0].length-1;
   for(let i=first;i<text.length;i++){const c=text[i];if(inString){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c==='"')inString=false;}else if(c==='"')inString=true;else if(c==='{')depth++;else if(c==='}'&&--depth===0){try{const data=JSON.parse(text.slice(first,i+1));const email=data.UserEmail;if(typeof email==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return email.trim().toLowerCase().slice(0,254);}catch{}break;}}
  }return null;
 }
 function identityStatus(primary,reading,binding){
  const email=primary?.account?.email;if(!email||!reading.subject)return 'identity-unverified';
  if(reading.email&&reading.email!==email)return 'account-mismatch';
  if(binding)return binding.email===email&&binding.subject===reading.subject?'linked':'account-mismatch';
  return reading.email===email?'initial-match':'identity-unverified';
 }
 function merge(primary,reading,now=Date.now()){
  const usable=reading?.status==='ok'&&reading.date===primary.date&&Number.isFinite(reading.observedAt)&&reading.observedAt>=now-120000&&reading.observedAt<=now+30000;
  const next={...primary,diagnostics:{...primary.diagnostics,searchStatus:usable?'ok':reading?.status==='ok'?'unavailable':reading?.status||'unavailable'}};
  if(!usable)return next;
  // withSearch verifies the Bing identity before merging. A newer balance from
  // that response can advance a dashboard left open, while an older cache cannot.
  const balance=core.validNumber(reading.balance)&&Number.isFinite(primary.observedAt)&&reading.observedAt>=primary.observedAt?reading.balance:primary.balance;
  return {...next,balance,searchMode:reading.mode,observedAt:Math.min(primary.observedAt,reading.observedAt),coverage:{...primary.coverage,...reading.coverage},activities:[...(primary.activities||[]).filter(a=>!['search','desktop','mobile'].includes(a.category)),...reading.activities]};
 }
 return {fromData,emailFromHome,identityStatus,merge};
});
