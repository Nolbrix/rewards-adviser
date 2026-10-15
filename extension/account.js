(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsAccount=api;})(globalThis,()=>{
 'use strict';
 const THEMES=['blue','red','black','green','purple'];
 const ROLES=Object.freeze({blue:'ASTRAL',red:'MYTHIC',black:'ECLIPSE',green:'EMERALD',purple:'ARCANE'});
 const themeRole=theme=>Object.hasOwn(ROLES,theme)?ROLES[theme]:ROLES.blue;
 function cleanProfile(raw={}){
  const theme=raw.theme||'blue',name=String(raw.name||'').trim().slice(0,60),photo=raw.photo||'',banner=raw.banner||'',bannerStyle=raw.bannerStyle||(banner?'image':'theme');
  if(!THEMES.includes(theme))throw Error('Tema non valido.');
  if(typeof photo!=='string'||photo.length>180000||photo&&!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(photo))throw Error('Foto non valida. Scegli JPG, PNG o WebP.');
  if(typeof banner!=='string'||banner.length>160000||banner&&!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(banner))throw Error('Banner non valido. Scegli JPG, PNG o WebP.');
  if(!['theme','aurora','sunset','midnight','image'].includes(bannerStyle)||bannerStyle==='image'&&!banner)throw Error('Scegli un banner valido.');
  if(photo.length+banner.length>230000)throw Error('Immagini troppo grandi. Scegli un banner più leggero.');
  return {theme,name,photo,banner,bannerStyle};
 }
 function createAccount(browser,fetcher=globalThis.fetch,prefix='',backupProvider=null,restoreReader=null){
  let generation=0,signing=false,refreshing=null,configuration=null,cloudSaving=null;
  const storage=browser.storage.local;
  async function config(){
   if(!configuration){const response=await fetcher(browser.runtime.getURL(prefix+'auth-config.json'),{cache:'no-store'});configuration=response.ok?await response.json():{};}
   return configuration;
  }
  async function request(action,body){
   const c=await config();if(!c.apiKey||!c.projectId)throw Error('Il login Firebase non è ancora configurato.');
   const response=await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:${action}?key=${encodeURIComponent(c.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
   const result=await response.json();if(!response.ok)throw Error(errorMessage(result.error?.message));return result;
  }
  function errorMessage(code){
   const messages={EMAIL_EXISTS:'Esiste già un account con questa email.',INVALID_LOGIN_CREDENTIALS:'Email o password non corretta.',INVALID_PASSWORD:'Email o password non corretta.',EMAIL_NOT_FOUND:'Email o password non corretta.',TOO_MANY_ATTEMPTS_TRY_LATER:'Troppi tentativi. Riprova più tardi.',USER_DISABLED:'Account disabilitato.',OPERATION_NOT_ALLOWED:'Questo metodo di accesso non è ancora attivo.',INVALID_ID_TOKEN:'Sessione scaduta. Accedi di nuovo.',TOKEN_EXPIRED:'Sessione scaduta. Accedi di nuovo.'};
   return messages[String(code||'').split(' : ')[0]]||'Accesso non riuscito. Riprova.';
  }
  async function profile(uid){const key='accountProfile:'+uid,data=await storage.get([key]);return cleanProfile(data[key]||{});}
  async function context(){const version=generation,s=await session();if(!s||version!==generation)throw Error('Accesso annullato.');return {uid:s.uid,stamp:s.stamp,version};}
  async function check(ctx){const {accountSession:s}=await storage.get(['accountSession']);if(ctx.version!==generation||s?.uid!==ctx.uid||s?.stamp!==ctx.stamp)throw Error('Accesso annullato.');}
  function publicUser(s){return s?{uid:s.uid,email:s.email||'',name:s.name||'',verified:s.verified===true}:null;}
  async function view(session,version=generation){const c=await config(),s=session===undefined?(await storage.get(['accountSession'])).accountSession:session,p=s?await profile(s.uid):null,{accountCloudReady:ready}=await storage.get(['accountCloudReady']);if(version!==generation)throw Error('Accesso annullato.');return {configured:!!(c.apiKey&&c.projectId),googleReady:!!c.bridgeUrl,user:publicUser(s),account:s?{uid:s.uid,stamp:s.stamp}:null,profile:p,needsCloudInit:!!s&&!(ready?.uid===s.uid&&ready?.stamp===s.stamp)};}
  async function establish(raw,version){
   if(typeof raw.idToken!=='string'||typeof raw.refreshToken!=='string'||!raw.refreshToken||raw.idToken.length>20000||raw.refreshToken.length>10000)throw Error('Risposta di accesso non valida.');
   const result=await request('lookup',{idToken:raw.idToken}),u=result.users?.[0];
   if(!u||typeof u.localId!=='string'||!u.localId||u.localId.length>128||raw.localId&&u.localId!==raw.localId)throw Error('Identità non verificabile.');
   const s={uid:u.localId,email:u.email||'',name:u.displayName||'',verified:u.emailVerified===true,idToken:raw.idToken,refreshToken:raw.refreshToken,expiresAt:Date.now()+Math.min(3600,Math.max(60,Number(raw.expiresIn)||3600))*1000,stamp:raw.stamp||crypto.randomUUID()};
   if(version!==generation)throw Error('Accesso annullato.');await storage.set({accountSession:s});
   if(version!==generation){const stored=(await storage.get(['accountSession'])).accountSession;if(stored?.stamp===s.stamp)await storage.remove('accountSession');throw Error('Accesso annullato.');}return s;
  }
  async function session(force=false){
   const version=generation,{accountSession:s}=await storage.get(['accountSession']);if(version!==generation)throw Error('Accesso annullato.');if(!s)return null;if(!force&&s.expiresAt>Date.now()+60000)return s;
   if(refreshing)return refreshing;
   refreshing=(async()=>{const c=await config();const response=await fetcher(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(c.apiKey)}`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:s.refreshToken}).toString(),signal:AbortSignal.timeout(15000)});
    const r=await response.json();if(!response.ok){if([400,401,403].includes(response.status)&&version===generation)await storage.remove('accountSession');throw Error('Sessione scaduta. Accedi di nuovo.');}
    return establish({idToken:r.id_token,refreshToken:r.refresh_token,expiresIn:r.expires_in,localId:s.uid,stamp:s.stamp},version);
   })().finally(()=>refreshing=null);return refreshing;
  }
  async function google(){
   const c=await config();let url;try{url=new URL(c.bridgeUrl)}catch{throw Error('Il login Google non è ancora configurato.');}
   if(url.protocol!=='https:'||url.username||url.password)throw Error('Indirizzo di accesso Google non valido.');
   if(!browser.offscreen)throw Error('Apri questa versione in Edge, Chrome o Brave aggiornato.');
   const documentUrl=browser.runtime.getURL(prefix+'auth-offscreen.html');
   const contexts=await browser.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[documentUrl]});
   if(!contexts.length)await browser.offscreen.createDocument({url:prefix+'auth-offscreen.html',reasons:['IFRAME_SCRIPTING'],justification:'Authenticate with Google in the hosted Firebase sign-in page after the user requests sign-in.'});
   try{
    const result=await browser.runtime.sendMessage({target:'account-offscreen',type:'GOOGLE_START',requestId:crypto.randomUUID(),bridgeUrl:url.href});
    if(!result?.credential)throw Error('Accesso Google annullato o non disponibile.');return result.credential;
   }finally{await browser.offscreen.closeDocument().catch(()=>{});}
  }
  async function firestore(method,path,body,ctx){
   const s=await session();if(!s)throw Error('Accedi per salvare il tuo profilo.');if(!s.verified)throw Error('Verifica la tua email prima di salvare il backup.');if(!ctx)throw Error('Accesso annullato.');await check(ctx);if(s.uid!==ctx.uid)throw Error('Accesso annullato.');const c=await config();await check(ctx);
   const response=await fetcher(`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(c.projectId)}/databases/(default)/documents/users/${encodeURIComponent(s.uid)}/${path}`,{method,headers:{Authorization:'Bearer '+s.idToken,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
   const data=await response.json();await check(ctx);if(!response.ok)throw Error(response.status===403?'Backup non disponibile. Controlla verifica email e regole Firebase.':'Backup non disponibile. Riprova.');return data;
  }
  async function saveCloud(force=false){
   if(cloudSaving)return cloudSaving;
   cloudSaving=(async()=>{const ctx=await context(),s=await session();if(!s||!s.verified)throw Error('Verifica la tua email prima di salvare il backup.');await check(ctx);
    const local=backupProvider?await backupProvider():null;if(!local||!/^[a-f0-9]{48}$/i.test(local.token||''))throw Error('Avvia START.cmd e collega i lettori prima di salvare il backup.');
    const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(local.token));const device=Array.from(new Uint8Array(hash)).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('');
    const {accountCloudReaders:remembered}=await storage.get(['accountCloudReaders']);const readers=new Map((remembered?.uid===s.uid?remembered.readers:[]).map(r=>[r.slot,r]));
    for(const r of (local.readers||[]).filter(r=>[1,2,3].includes(r.slot)&&r.email).slice(0,3))readers.set(r.slot,{slot:r.slot,alias:String(r.alias||'').slice(0,80),email:String(r.email||'').slice(0,254),browser:['Edge','Chrome','Brave'].includes(r.browser)?r.browser:'Edge'});
    const payload={profile:await profile(s.uid),token:local.token,readers:[...readers.values()].slice(0,3)};
    const serialized=JSON.stringify(payload),digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(serialized)),payloadHash=Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('');
    const {accountCloud:last}=await storage.get(['accountCloud']);if(!force&&last?.uid===s.uid&&last.device===device&&last.payloadHash===payloadHash)return {saved:false,updatedAt:last.updatedAt};
    const updatedAt=new Date().toISOString();await firestore('PATCH',`devices/${device}`,{fields:{payload:{stringValue:serialized},updatedAt:{timestampValue:updatedAt},schema:{integerValue:'1'}}},ctx);
    await check(ctx);await storage.set({accountCloud:{uid:s.uid,device,updatedAt,payloadHash}});await check(ctx);return {saved:true,updatedAt};
   })().finally(()=>cloudSaving=null);return cloudSaving;
  }
  async function backups(){
   const ctx=await context(),r=await firestore('GET','devices?pageSize=30',null,ctx);await check(ctx);return (r.documents||[]).map(d=>{let p;try{p=JSON.parse(d.fields?.payload?.stringValue||'{}')}catch{return null}return {id:d.name.split('/').pop(),updatedAt:d.fields?.updatedAt?.timestampValue,profile:cleanProfile(p.profile),readers:(p.readers||[]).filter(x=>[1,2,3].includes(x.slot)).slice(0,3)};}).filter(Boolean);
  }
  async function handle(message){
   const started=generation;
   if(!['AUTH_VIEW','AUTH_SIGNIN','AUTH_SIGNUP','AUTH_GOOGLE','AUTH_RESET'].includes(message.type)){
    const {accountSession:s}=await storage.get(['accountSession']);
    if(started!==generation||s&&(s.uid!==message.account?.uid||s.stamp!==message.account?.stamp)||!s&&message.type!=='AUTH_SIGNOUT')throw Error('Accesso annullato.');
   }
   if(message.type==='AUTH_SIGNOUT'){generation++;await storage.remove(['accountSession','accountCloud','accountCloudReady','accountCloudReaders']);return view(null);}
   if(message.type==='AUTH_VIEW')return view(await session(),started);
   if(message.type==='AUTH_RESET'){await request('sendOobCode',{requestType:'PASSWORD_RESET',email:String(message.email||'').trim()});return {sent:true};}
   if(message.type==='AUTH_CLOUD_SAVE')return saveCloud(true);
   if(message.type==='AUTH_CLOUD_LIST')return {backups:await backups()};
   if(message.type==='AUTH_CLOUD_INIT'){
    const ctx=await context(),s=await session(),all=await backups(),local=backupProvider?await backupProvider():null;await check(ctx);
    let own='';if(local?.token){const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(local.token));own=Array.from(new Uint8Array(hash)).slice(0,16).map(x=>x.toString(16).padStart(2,'0')).join('');}
    const selected=all.find(b=>b.id===own)||all.sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
    if(selected){const key='accountProfile:'+ctx.uid,stored=await storage.get([key]);await check(ctx);if(!stored[key])await storage.set({[key]:selected.profile});await check(ctx);await storage.set({accountCloudReaders:{uid:ctx.uid,readers:selected.readers}});}
    await check(ctx);await storage.set({accountCloudReady:{uid:ctx.uid,stamp:s.stamp}});await check(ctx);
    return {...await view(s,ctx.version),readers:selected?.readers||[]};
   }
   if(message.type==='AUTH_CLOUD_EXPORT'){
    if(!/^[a-f0-9]{32}$/.test(message.device||''))throw Error('Backup non valido.');
    const ctx=await context(),raw=await firestore('GET','devices/'+message.device,null,ctx);let p;try{p=JSON.parse(raw.fields?.payload?.stringValue||'{}')}catch{throw Error('Backup non valido.');}await check(ctx);
    if(!/^[a-f0-9]{48}$/i.test(p.token||''))throw Error('Chiave nel backup non valida.');
    return {app:'rewards-adviser-private-backup',schema:1,device:message.device,token:p.token,profile:cleanProfile(p.profile),readers:(p.readers||[]).filter(r=>[1,2,3].includes(r.slot)).slice(0,3).map(r=>({slot:r.slot,alias:String(r.alias||'').slice(0,80),email:String(r.email||'').slice(0,254),browser:r.browser}))};
   }
   if(message.type==='AUTH_CLOUD_RESTORE'){
    if(!/^[a-f0-9]{32}$/.test(message.device||''))throw Error('Backup non valido.');
    const ctx=await context(),raw=await firestore('GET','devices/'+message.device,null,ctx);let p;try{p=JSON.parse(raw.fields?.payload?.stringValue||'{}')}catch{throw Error('Backup non valido.');}
    const s=await session(),next=cleanProfile(p.profile),readers=(p.readers||[]).filter(r=>[1,2,3].includes(r.slot)).slice(0,3).map(r=>({slot:r.slot,alias:String(r.alias||'').slice(0,80),email:String(r.email||'').slice(0,254),browser:r.browser}));await check(ctx);await storage.set({['accountProfile:'+ctx.uid]:next,accountCloudReaders:{uid:ctx.uid,readers}});await check(ctx);
    return {...await view(s,ctx.version),readers};
   }
   if(message.type==='AUTH_READER'){
    const ctx=await context(),{accountCloudReaders:saved}=await storage.get(['accountCloudReaders']);await check(ctx);
    const reader=saved?.uid===ctx.uid&&saved.readers.find(r=>r.slot===message.slot);if(!reader||!restoreReader)throw Error('Backup non valido.');
    return restoreReader(reader,()=>check(ctx));
   }
   if(message.type==='AUTH_PROFILE'){
    const ctx=await context(),s=await session(),next=cleanProfile(message.profile);await check(ctx);await storage.set({['accountProfile:'+ctx.uid]:next});await check(ctx);return view(s,ctx.version);
   }
   if(message.type==='AUTH_VERIFY'){const s=await session();if(!s)throw Error('Accedi prima di verificare l’email.');await request('sendOobCode',{requestType:'VERIFY_EMAIL',idToken:s.idToken});return {sent:true};}
   if(message.type==='AUTH_RECHECK')return view(await session(true),started);
   if(['AUTH_SIGNIN','AUTH_SIGNUP','AUTH_GOOGLE'].includes(message.type)){
    if(signing)throw Error('Attendi l’accesso in corso.');signing=true;const version=++generation;
    try{let raw;if(message.type==='AUTH_GOOGLE')raw=await google();else{const email=String(message.email||'').trim(),password=message.password;
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||typeof password!=='string'||password.length<6||password.length>256)throw Error('Inserisci email e password valide (almeno 6 caratteri).');
     raw=await request(message.type==='AUTH_SIGNUP'?'signUp':'signInWithPassword',{email,password,returnSecureToken:true});}
     return view(await establish(raw,version),version);
    }finally{signing=false;}
   }
   throw Error('Operazione account non riconosciuta.');
  }
  async function autoSync(){const {accountSession:s,accountCloudReady:ready}=await storage.get(['accountSession','accountCloudReady']);if(s?.verified&&ready?.uid===s.uid&&ready.stamp===s.stamp)await saveCloud();}
  return {handle,saveCloud,autoSync};
 }
 return {createAccount,cleanProfile,THEMES,themeRole};
});
