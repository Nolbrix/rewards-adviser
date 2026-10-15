import {initializeApp} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import {getAuth,GoogleAuthProvider,signInWithPopup,inMemoryPersistence,setPersistence,signOut} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import {firebaseConfig,allowedExtensionIds} from './config.js';
const app=initializeApp(firebaseConfig),auth=getAuth(app);let busy=false;
window.addEventListener('message',async event=>{
 if(event.source!==parent||!allowedExtensionIds.some(id=>event.origin==='chrome-extension://'+id)||event.data?.type!=='REWARDS_AUTH_START'||typeof event.data.requestId!=='string'||event.data.requestId.length>80||busy)return;
 busy=true;const requestId=event.data.requestId,origin=event.origin;
 try{await setPersistence(auth,inMemoryPersistence);const provider=new GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});const result=await signInWithPopup(auth,provider),user=result.user;
  parent.postMessage({type:'REWARDS_AUTH_RESULT',requestId,credential:{idToken:await user.getIdToken(),refreshToken:user.refreshToken,localId:user.uid}},origin);
 }catch{parent.postMessage({type:'REWARDS_AUTH_RESULT',requestId,error:'cancelled'},origin);}
 finally{await signOut(auth).catch(()=>{});busy=false;}
});
