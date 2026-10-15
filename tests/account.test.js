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
// Two 1x1 frames with different palette indexes; the original bytes must survive every profile path.
const animatedGif='data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAAKAAAALAAAAAABAAEAAAICRAEAIfkEAAoAAAAsAAAAAAEAAQAAAgJMAQA7';
function gifWithComment(size){
 const original=Buffer.from(animatedGif.split(',')[1],'base64'),blocks=[original.subarray(0,-1),Buffer.from([0x21,0xfe])];
 while(size){const length=Math.min(255,size);blocks.push(Buffer.from([length]),Buffer.alloc(length,65));size-=length;}
 blocks.push(Buffer.from([0,0x3b]));return 'data:image/gif;base64,'+Buffer.concat(blocks).toString('base64');
}
test('animated avatar and banner GIF bytes remain unchanged when cleaning a profile',()=>{
 const clean=accounts.cleanProfile({theme:'red',photo:animatedGif,banner:animatedGif,bannerStyle:'image'});
 assert.equal(clean.photo,animatedGif);assert.equal(clean.banner,animatedGif);assert.equal(clean.bannerStyle,'image');
});
test('GIF profile images reject corrupt, truncated and mislabeled animation data',()=>{
 const bytes=Buffer.from(animatedGif.split(',')[1],'base64'),zeroWidth=Buffer.from(bytes);zeroWidth[6]=0;
 for(const gif of ['data:image/gif;base64,AAAA','data:image/gif;base64,!!!!','data:image/gif;base64,'+bytes.subarray(0,-1).toString('base64'),'data:image/gif;base64,'+zeroWidth.toString('base64'),'data:image/gif;base64,'+Buffer.from('GIF89a').toString('base64')]){
  assert.throws(()=>accounts.cleanProfile({photo:gif}));assert.throws(()=>accounts.cleanProfile({banner:gif}));
 }
});
test('GIF logical screens reject excessive dimensions and decoded pixel area before profile acceptance',()=>{
 for(const [width,height] of [[10000,10000],[65535,65535],[4097,1],[1,4097],[2049,2048]]){
  const bytes=Buffer.from(animatedGif.split(',')[1],'base64');bytes.writeUInt16LE(width,6);bytes.writeUInt16LE(height,8);
  const gif='data:image/gif;base64,'+bytes.toString('base64');assert.throws(()=>accounts.cleanProfile({photo:gif}));assert.throws(()=>accounts.cleanProfile({banner:gif}));
 }
 const bytes=Buffer.from(animatedGif.split(',')[1],'base64');bytes.writeUInt16LE(4096,6);bytes.writeUInt16LE(1024,8);
 const gif='data:image/gif;base64,'+bytes.toString('base64');assert.equal(accounts.cleanProfile({photo:gif}).photo,gif);
});
test('GIF frames must stay inside their declared logical screen',()=>{
 for(const [offset,value] of [[28,1],[30,1],[32,2],[34,2],[51,1],[53,1],[55,2],[57,2]]){
  const bytes=Buffer.from(animatedGif.split(',')[1],'base64');bytes.writeUInt16LE(value,offset);
  assert.throws(()=>accounts.cleanProfile({photo:'data:image/gif;base64,'+bytes.toString('base64')}));
 }
 const bytes=Buffer.from(animatedGif.split(',')[1],'base64');bytes.writeUInt16LE(4096,6);bytes.writeUInt16LE(1024,8);bytes.writeUInt16LE(4095,28);bytes.writeUInt16LE(1023,30);
 const gif='data:image/gif;base64,'+bytes.toString('base64');assert.equal(accounts.cleanProfile({banner:gif}).banner,gif);
});
test('GIF graphic control extensions require their four-byte payload and zero terminator',()=>{
 const bytes=Buffer.from(animatedGif.split(',')[1],'base64');
 const short=Buffer.concat([bytes.subarray(0,21),Buffer.from([1,0,0]),bytes.subarray(27)]),unterminated=Buffer.from(bytes);unterminated[26]=1;
 for(const gif of [short,unterminated])assert.throws(()=>accounts.cleanProfile({photo:'data:image/gif;base64,'+gif.toString('base64')}));
});
test('valid GIFs respect separate avatar and banner limits without changing their bytes',()=>{
 const avatar=gifWithComment(134000),banner=gifWithComment(119400);
 assert.equal(avatar.length,179482);assert.equal(banner.length,159942);
 assert.equal(accounts.cleanProfile({photo:avatar}).photo,avatar);assert.equal(accounts.cleanProfile({banner}).banner,banner);
 assert.throws(()=>accounts.cleanProfile({photo:gifWithComment(134400)}));assert.throws(()=>accounts.cleanProfile({banner:gifWithComment(119500)}));
});
test('the image selected second uses the remaining combined budget in either direction',()=>{
 assert.equal(typeof accounts.profileImageBudget,'function');
 assert.equal(accounts.profileImageBudget(false,''),180000);assert.equal(accounts.profileImageBudget(true,''),160000);
 assert.equal(accounts.profileImageBudget(false,'x'.repeat(150000)),80000);assert.equal(accounts.profileImageBudget(true,'x'.repeat(170000)),60000);
 const photo=gifWithComment(100000),banner=gifWithComment(71600),over=gifWithComment(71800);
 assert.equal(photo.length+banner.length,229932);assert.equal(photo.length+over.length,230200);
 assert.equal(accounts.cleanProfile({photo,banner}).banner,banner);assert.throws(()=>accounts.cleanProfile({photo,banner:over}));
});
test('animated GIFs survive profile save, private cloud backup, export and restore verbatim',async()=>{
 let cloud;const document=()=>({name:'projects/example/databases/(default)/documents/users/alice/devices/'+'f'.repeat(32),fields:cloud.fields});
 const t=setup((url,body)=>{
  if(url.includes('lookup'))return {users:[alice]};if(!url.includes('firestore'))return credential;
  if(body.fields){cloud=body;return body;}return url.includes('pageSize')?{documents:[document()]}:document();
 },async()=>({token:'a'.repeat(48),readers:[]}));
 await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});
 const profile={theme:'red',photo:animatedGif,banner:gifWithComment(12),bannerStyle:'image'};
 const saved=await t.app.handle({type:'AUTH_PROFILE',profile});assert.equal(saved.profile.photo,profile.photo);assert.equal(saved.profile.banner,profile.banner);
 await t.app.handle({type:'AUTH_CLOUD_SAVE'});const payload=JSON.parse(cloud.fields.payload.stringValue);assert.equal(payload.profile.photo,profile.photo);assert.equal(payload.profile.banner,profile.banner);assert.ok(Buffer.byteLength(cloud.fields.payload.stringValue,'utf8')<250000);
 const list=await t.app.handle({type:'AUTH_CLOUD_LIST'});assert.equal(list.backups[0].profile.photo,profile.photo);assert.equal(list.backups[0].profile.banner,profile.banner);
 const exported=await t.app.handle({type:'AUTH_CLOUD_EXPORT',device:'f'.repeat(32)});assert.equal(exported.profile.photo,profile.photo);assert.equal(exported.profile.banner,profile.banner);
 await t.app.handle({type:'AUTH_PROFILE',profile:{theme:'blue'}});
 const restored=await t.app.handle({type:'AUTH_CLOUD_RESTORE',device:'f'.repeat(32)});assert.equal(restored.profile.photo,profile.photo);assert.equal(restored.profile.banner,profile.banner);
 await t.app.handle({type:'AUTH_SIGNOUT'});const signed=await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});assert.equal(signed.profile.photo,profile.photo);assert.equal(signed.profile.banner,profile.banner);
});
test('profile banners retain only bounded local raster images and supported visual presets',()=>{
 const profile=accounts.cleanProfile({theme:'red',name:'Alice',banner:'data:image/jpeg;base64,YQ==',bannerStyle:'image',role:'DEV'});
 assert.equal(profile.banner,'data:image/jpeg;base64,YQ==');assert.equal(profile.bannerStyle,'image');assert.equal(profile.role,undefined);
 assert.equal(accounts.cleanProfile({theme:'blue'}).bannerStyle,'theme');assert.equal(accounts.cleanProfile({theme:'blue'}).banner,'');
 for(const raw of [{banner:'https://example.com/banner.jpg'},{banner:'data:image/svg+xml;base64,PHN2Zz4='},{bannerStyle:'arbitrary-css'},{bannerStyle:'image'},{photo:'data:image/jpeg;base64,'+'A'.repeat(150000),banner:'data:image/jpeg;base64,'+'A'.repeat(100000)}])assert.throws(()=>accounts.cleanProfile(raw));
});
test('theme badges are decorative and derived from the selected theme',()=>{
 assert.equal(typeof accounts.themeRole,'function');for(const [theme,role] of Object.entries({red:'MYTHIC',blue:'ASTRAL',black:'ECLIPSE',green:'EMERALD',purple:'ARCANE'}))assert.equal(accounts.themeRole(theme),role);
 for(const value of ['unknown','toString','__proto__'])assert.equal(accounts.themeRole(value),'ASTRAL');
});
test('banner artwork is included in the private backup and stays within the deployed payload limit',async()=>{
 const t=setup(url=>url.includes('lookup')?{users:[alice]}:credential,async()=>({token:'a'.repeat(48),readers:[{slot:1,email:'reader@example.com',alias:'Reader',browser:'Edge'}]}));
 await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});const profile={theme:'red',photo:'data:image/jpeg;base64,'+'A'.repeat(170000),banner:'data:image/jpeg;base64,'+'A'.repeat(55000),bannerStyle:'image'};
 const saved=await t.app.handle({type:'AUTH_PROFILE',profile});assert.equal(saved.profile.banner,profile.banner);await t.app.handle({type:'AUTH_CLOUD_SAVE'});
 const patch=t.calls.find(c=>c.options?.method==='PATCH'),payload=JSON.parse(patch.options.body).fields.payload.stringValue;assert.ok(Buffer.byteLength(payload,'utf8')<250000);assert.equal(JSON.parse(payload).profile.bannerStyle,'image');assert.ok(!payload.includes('private-refresh-token'));
 await t.app.handle({type:'AUTH_SIGNOUT'});const signed=await t.app.handle({type:'AUTH_SIGNIN',email:alice.email,password:'password'});assert.equal(signed.profile.banner,profile.banner);
});
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
