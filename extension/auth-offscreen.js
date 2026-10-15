(()=>{
 'use strict';let active=false;
 chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  const worker=new URL('background.js',location.href).href;
  if(message?.target!=='account-offscreen'||message.type!=='GOOGLE_START'||sender.id!==chrome.runtime.id||sender.url!==worker)return;
  if(active){respond({error:'busy'});return;}active=true;
  const bridge=new URL(message.bridgeUrl);if(bridge.protocol!=='https:'){respond({error:'invalid-origin'});active=false;return;}
  const frame=document.createElement('iframe');frame.src=bridge.href;frame.referrerPolicy='no-referrer';document.body.append(frame);
  let done=false;
  function finish(result){if(done)return;done=true;active=false;clearTimeout(timeout);window.removeEventListener('message',receive);frame.remove();respond(result);}
  function receive(event){if(event.source!==frame.contentWindow||event.origin!==bridge.origin||event.data?.requestId!==message.requestId||event.data?.type!=='REWARDS_AUTH_RESULT')return;
   const c=event.data.credential;if(c&&typeof c.idToken==='string'&&typeof c.refreshToken==='string')finish({credential:{idToken:c.idToken,refreshToken:c.refreshToken,localId:c.localId,expiresIn:'3600'}});else finish({error:'cancelled'});
  }
  window.addEventListener('message',receive);const timeout=setTimeout(()=>finish({error:'timeout'}),120000);
  frame.onload=()=>frame.contentWindow.postMessage({type:'REWARDS_AUTH_START',requestId:message.requestId},bridge.origin);
  return true;
 });
})();
