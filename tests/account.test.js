const {test}=require('node:test'),assert=require('node:assert/strict');
let accounts;try{accounts=require('../extension/account.js')}catch{}
const cfg={apiKey:'example-public-api-key',authDomain:'example.firebaseapp.com',projectId:'example',bridgeUrl:'https://example.github.io/rewards-adviser/auth/'};
function setup(respond,backupProvider=null){
 const data={},calls=[],browser={runtime:{getURL:p=>'chrome-extension://'+'a'.repeat(32)+'/'+p},storage:{local:{async get(keys){return Object.fromEntries(keys.filter(k=>k in data).map(k=>[k,structuredClone(data[k])]))},async set(values){Object.assign(data,structuredClone(values))},async remove(keys){for(const key of [].concat(keys))delete data[key]}}}};
 const fetcher=async(url,options)=>{calls.push({url,options});if(url.endsWith('auth-config.json'))return new Response(JSON.stringify(cfg));const body=options?.headers?.['Content-Type']==='application/x-www-form-urlencoded'?Object.fromEntries(new URLSearchParams(options.body)):JSON.parse(options?.body||'{}');return new Response(JSON.stringify(await respond(url,body)));};
 assert.ok(accounts?.createAccount,'Account worker must exist');const app=accounts.createAccount(browser,fetcher,'',backupProvider),handle=app.handle;app.handle=message=>handle({...message,account:message.account===undefined&&data.accountSession?{uid:data.accountSession.uid,stamp:data.accountSession.stamp}:message.account});return {app,data,calls,browser};
}
const credential={idToken:'firebase-id-token',refreshToken:'private-refresh-token',expiresIn:'3600',localId:'alice'};
const alice={localId:'alice',email:'alice@example.com',emailVerified:true,displayName:'Alice'};
test('email sign-in verifies the Firebase token and never exposes credentials to the UI',async()=>{
 const t=setup(url=>url.includes('accounts:lookup')?{users:[alice]}:credential);
 const view=await t.app.handle({type:'AUTH_SIGNIN',email:'alice@example.com',password:'not-saved-password'});
 assert.equal(view.user.uid,'alice');assert.equal(view.user.email,'alice@example.com');assert.equal(view.profile.theme,'blue');
 assert.ok(t.calls.some(c=>c.url.includes('accounts:lookup')));assert.ok(t.data.accountSession.refreshToken);
 assert.ok(!JSON.stringify(view).includes('private-refresh'));assert.ok(!JSON.stringify(t.data).includes('not-saved-password'));
});
test('an unverified or mismatched Firebase identity never becomes a signed-in profile',async()=>{
 const t=setup(url=>url.includes('accounts:lookup')?{users:[{...alice,localId:'other'}]}:credential);
 await assert.rejects(t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'}));assert.equal(t.data.accountSession,undefined);
});
test('themes and photo preferences are isolated by Firebase user and logout retains no session',async()=>{
 let current=alice;const t=setup(url=>url.includes('accounts:lookup')?{users:[current]}:{...credential,localId:current.localId});
 await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});
 await t.app.handle({type:'AUTH_PROFILE',profile:{name:'My profile',theme:'red',photo:''}});
 await t.app.handle({type:'AUTH_SIGNOUT'});assert.equal(t.data.accountSession,undefined);
 current={localId:'bob',email:'bob@example.com'};let view=await t.app.handle({type:'AUTH_SIGNIN',email:current.email,password:'password'});assert.equal(view.profile.theme,'blue');
 current=alice;view=await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});assert.equal(view.profile.theme,'red');assert.equal(view.profile.name,'My profile');
});
test('profile changes reject unrecognized themes and remote or SVG photos',async()=>{
 const t=setup(url=>url.includes('accounts:lookup')?{users:[alice]}:credential);await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});
 for(const profile of [{theme:'unknown'},{theme:'red',photo:'https://example.com/private.jpg'},{theme:'red',photo:'data:image/svg+xml;base64,PHN2Zz4='}])await assert.rejects(t.app.handle({type:'AUTH_PROFILE',profile}));
});
test('logout invalidates an in-flight sign-in',async()=>{
 let release;const waiting=new Promise(r=>release=r);const t=setup(async url=>{if(url.includes('signInWithPassword')){await waiting;return credential}return {users:[alice]}});
 const pending=t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});await new Promise(r=>setImmediate(r));await t.app.handle({type:'AUTH_SIGNOUT'});release();await assert.rejects(pending);assert.equal(t.data.accountSession,undefined);
});
test('expired Firebase credentials are refreshed before exposing a profile',async()=>{
 const t=setup(url=>url.includes('securetoken')?{id_token:'new-id',refresh_token:'new-refresh',expires_in:'3600',user_id:'alice'}:{users:[alice]});
 t.data.accountSession={uid:'alice',idToken:'old-id',refreshToken:'old-refresh',expiresAt:0,email:alice.email};
 const view=await t.app.handle({type:'AUTH_VIEW'});assert.equal(view.user.uid,'alice');assert.ok(t.calls.some(c=>c.url.startsWith('https://securetoken.googleapis.com/')));assert.ok(!JSON.stringify(view).includes('new-refresh'));
});
test('email verification recheck refreshes the token used by Firestore rules',async()=>{
 const t=setup(url=>url.includes('securetoken')?{id_token:'verified-token',refresh_token:'new-refresh',expires_in:'3600'}:url.includes('lookup')?{users:[alice]}:credential);
 t.data.accountSession={uid:'alice',idToken:'unverified-token',refreshToken:'old-refresh',expiresAt:Date.now()+3600000,email:alice.email,verified:false};
 const view=await t.app.handle({type:'AUTH_RECHECK'});assert.equal(view.user.verified,true);assert.ok(t.calls.some(c=>c.url.includes('securetoken')));assert.equal(t.data.accountSession.idToken,'verified-token');
});
test('logout and another user signing in cannot redirect an in-flight private backup',async()=>{
 let release,start;const waiting=new Promise(r=>release=r),started=new Promise(r=>start=r);let user=alice;
 const t=setup(url=>url.includes('lookup')?{users:[user]}:{...credential,localId:user.localId},async()=>{start();await waiting;return {token:'a'.repeat(48),readers:[{slot:1,email:'alice-reader@example.com',alias:'Alice reader',browser:'Edge'}]}});
 await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});const saving=t.app.handle({type:'AUTH_CLOUD_SAVE'});await started;await t.app.handle({type:'AUTH_SIGNOUT'});user={...alice,localId:'bob',email:'bob@example.com'};await t.app.handle({type:'AUTH_SIGNIN',email:user.email,password:'password'});release();
 await assert.rejects(saving);assert.ok(!t.calls.some(c=>c.url.includes('/users/bob/devices/')&&c.options.method==='PATCH'));
});
test('unverified users cannot read or write cloud backups',async()=>{
 const t=setup(url=>url.includes('lookup')?{users:[{...alice,emailVerified:false}]}:credential);await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});
 await assert.rejects(t.app.handle({type:'AUTH_CLOUD_LIST'}));await assert.rejects(t.app.handle({type:'AUTH_CLOUD_SAVE'}));assert.ok(!t.calls.some(c=>c.url.includes('firestore.googleapis.com')));
});
test('a storage read completed after logout cannot resurrect a refreshed session',async()=>{
 const t=setup(url=>url.includes('securetoken')?{id_token:'new-id',refresh_token:'new-refresh',expires_in:'3600'}:url.includes('lookup')?{users:[alice]}:credential);
 await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});let start,release;const started=new Promise(r=>start=r),waiting=new Promise(r=>release=r),get=t.browser.storage.local.get;let delay=true;
 t.browser.storage.local.get=async keys=>{const result=await get(keys);if(delay&&keys.includes('accountSession')){delay=false;start();await waiting;}return result;};
 const pending=t.app.handle({type:'AUTH_RECHECK'});await started;await t.app.handle({type:'AUTH_SIGNOUT'});release();await assert.rejects(pending);assert.equal(t.data.accountSession,undefined);
});
test('first sign-in recovers saved appearance and readers before allowing automatic backup',async()=>{
 const saved={profile:{theme:'red',name:'Saved profile',photo:''},token:'b'.repeat(48),readers:[{slot:1,alias:'Saved reader',email:'saved@example.com',browser:'Brave'}]};
 const t=setup(url=>url.includes('lookup')?{users:[alice]}:url.includes('firestore')?{documents:[{name:'projects/example/databases/(default)/documents/users/alice/devices/'+'f'.repeat(32),fields:{payload:{stringValue:JSON.stringify(saved)},updatedAt:{timestampValue:'2026-10-15T12:00:00Z'}}}]}:credential,async()=>({token:'a'.repeat(48),readers:[]}));
 await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});const result=await t.app.handle({type:'AUTH_CLOUD_INIT'});
 assert.equal(result.profile.theme,'red');assert.equal(result.readers[0].email,'saved@example.com');assert.ok(!JSON.stringify(result).includes(saved.token));assert.ok(!t.calls.some(c=>c.options?.method==='PATCH'));
 await t.app.autoSync();const patch=t.calls.find(c=>c.options?.method==='PATCH');assert.ok(patch);const payload=JSON.parse(JSON.parse(patch.options.body).fields.payload.stringValue);assert.equal(payload.readers[0].email,'saved@example.com');assert.equal(payload.token,'a'.repeat(48));
});
test('requests from an obsolete account panel cannot change or export another user profile',async()=>{
 let user=alice;const t=setup(url=>url.includes('lookup')?{users:[user]}:{...credential,localId:user.localId});
 const old=await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});await t.app.handle({type:'AUTH_SIGNOUT'});user={...alice,localId:'bob',email:'bob@example.com'};await t.app.handle({type:'AUTH_SIGNIN',email:user.email,password:'password'});
 for(const type of ['AUTH_PROFILE','AUTH_CLOUD_LIST','AUTH_CLOUD_EXPORT','AUTH_CLOUD_INIT','AUTH_SIGNOUT'])await assert.rejects(t.app.handle({type,account:old.account,profile:{theme:'red',name:'Alice'},device:'f'.repeat(32)}));
 assert.equal(t.data.accountSession.uid,'bob');assert.equal(t.data['accountProfile:bob'],undefined);
});
test('an explicitly restored backup replaces the remembered reader configuration',async()=>{
 const readers=[{slot:2,alias:'Selected reader',email:'selected@example.com',browser:'Brave'}],saved={profile:{theme:'purple'},token:'b'.repeat(48),readers};
 const t=setup(url=>url.includes('lookup')?{users:[alice]}:url.includes('firestore')?{fields:{payload:{stringValue:JSON.stringify(saved)}}}:credential,async()=>({token:'a'.repeat(48),readers:[]}));
 await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});t.data.accountCloudReaders={uid:'alice',readers:[{slot:1,email:'old@example.com'}]};
 await t.app.handle({type:'AUTH_CLOUD_RESTORE',device:'f'.repeat(32)});await t.app.handle({type:'AUTH_CLOUD_SAVE'});
 const patch=t.calls.find(c=>c.options?.method==='PATCH');assert.deepEqual(JSON.parse(JSON.parse(patch.options.body).fields.payload.stringValue).readers,readers);
});
