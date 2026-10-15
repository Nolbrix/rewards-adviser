(()=>{
 'use strict';if(globalThis.__rewardsAdviserLoaded)return;globalThis.__rewardsAdviserLoaded=true;
 let timer=null,busy=false,lastFingerprint='',lastDataAt=performance.timeOrigin||Date.now();
 async function capture(){if(busy)return;busy=true;try{
  const snapshot=RewardsParser.readDocument(document,{timezone:'Europe/Rome'});
  const fingerprint=JSON.stringify({balance:snapshot.balance,account:snapshot.account,activities:snapshot.activities,coverage:snapshot.coverage});
  if(lastFingerprint&&fingerprint!==lastFingerprint&&RewardsCore.dayKey(lastDataAt)===RewardsCore.dayKey())lastDataAt=Date.now();
  lastFingerprint=fingerprint;snapshot.observedAt=lastDataAt;snapshot.date=RewardsCore.dayKey(lastDataAt);
  await chrome.runtime.sendMessage({type:'CAPTURE',snapshot});
 }catch{}finally{busy=false;}}
 function schedule(){clearTimeout(timer);timer=setTimeout(capture,1000);}
 const observer=new MutationObserver(schedule);observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['data-complete','aria-label','data-points']});
 chrome.runtime.onMessage.addListener((message,_sender,sendResponse)=>{if(message.type==='SCAN'){schedule();sendResponse({ok:true});}return false;});
 capture();setInterval(()=>{capture();chrome.runtime.sendMessage({type:'PING'}).catch(()=>{});},15000);
})();
