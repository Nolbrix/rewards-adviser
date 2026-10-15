(()=>{
 'use strict';const $=id=>document.getElementById(id),tr=globalThis.RewardsI18n?.t||(s=>s),demo=!globalThis.chrome?.runtime?.id;
 let current=null,register=false,photo='',banner='',backups=[],restored=[],busy=false,visualGeneration=0;
 async function send(type,data={}){if(demo)throw Error(tr('Il login è disponibile nell’estensione installata.'));const r=await chrome.runtime.sendMessage({type,...data,account:current?.account});if(!r?.ok)throw Error(tr(r?.error||'Operazione non disponibile.'));return r.data;}
 function feedback(message,error=false){$('account-feedback').textContent=message;$('account-feedback').classList.toggle('error',error);}
 function imageAt(id,value){const image=$(id);image.hidden=!value;if(value)image.src=value;else image.removeAttribute('src');}
 function appearance(profile){const active=!!(current?.user&&profile),p=active?RewardsAccount.cleanProfile(profile):null,name=active?(p.name||current.user.name||tr('Il mio profilo')):tr('Il tuo profilo');
  document.body.dataset.theme=p?.theme||'neutral';const photo=p?.photo||'';for(const id of ['profile-photo','strip-photo','preview-photo'])imageAt(id,photo);for(const id of ['profile-initial','strip-initial','preview-initial'])$(id).hidden=!!photo;
  $('account-caption').textContent=active?name:tr('Accedi');$('strip-name').textContent=name;$('preview-name').textContent=name;$('strip-hint').textContent=active?tr('Il tuo spazio Rewards'):tr('Accedi e scegli il tuo stile');
  for(const id of ['strip-role','preview-role']){$(id).hidden=!active;$(id).textContent=active?RewardsAccount.themeRole(p.theme):'';}
  for(const id of ['profile-strip','profile-preview','account-open']){const surface=$(id);surface.dataset.bannerStyle=p?.bannerStyle||'theme';if(p?.bannerStyle==='image'&&p.banner)surface.style.setProperty('--profile-cover',`url("${p.banner}")`);else surface.style.removeProperty('--profile-cover');}
 }
 function draft(){return {name:$('app-name').value,theme:document.querySelector('input[name="theme"]:checked')?.value||current?.profile?.theme||'blue',photo,banner,bannerStyle:$('app-banner-style').value||'theme'};}
 function bannerChoice(){const option=$('app-banner-style').querySelector('option[value="image"]');option.disabled=!banner;$('remove-profile-banner').disabled=!banner;}
 function render(view){if(current?.account?.stamp!==view?.account?.stamp){visualGeneration++;backups=[];restored=[];photo='';banner='';$('cloud-backups').replaceChildren();}current=view;const user=view?.user,profile=view?.profile;
  $('account-login').hidden=!!user;$('account-personalize').hidden=!user;appearance(user?profile:null);
  $('account-config-status').textContent=view?.configured?'':tr('Il servizio di accesso è in preparazione. Il riepilogo locale resta disponibile.');$('google-signin').disabled=!view?.configured||!view?.googleReady;$('email-submit').disabled=!view?.configured;
  if(user){$('app-identity').textContent=user.email;$('verify-section').hidden=user.verified;$('app-name').value=profile?.name||user.name||'';photo=profile?.photo||'';banner=profile?.banner||'';$('app-banner-style').value=profile?.bannerStyle||'theme';document.querySelector(`input[name="theme"][value="${profile?.theme||'blue'}"]`).checked=true;}else{$('app-identity').textContent='';$('app-name').value='';photo='';banner='';$('app-banner-style').value='theme';}bannerChoice();
 }
 async function run(action){if(busy)return;busy=true;feedback('');const buttons=[...$('account-dialog').querySelectorAll('button')].filter(b=>b.id!=='account-close');const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);try{await action();}catch(e){feedback(e.message,true);}finally{buttons.forEach((b,i)=>b.disabled=disabled[i]);busy=false;bannerChoice();if(current){$('google-signin').disabled=!current.configured||!current.googleReady;$('email-submit').disabled=!current.configured;}}}
 async function synchronize(){try{const r=await send('AUTH_CLOUD_SAVE');if(r.saved)feedback(tr('Backup privato salvato.'));}catch(e){feedback(e.message,true);}}
 function showReaders(readers){restored=readers;$('cloud-backups').replaceChildren();for(const [index,reader] of restored.entries()){const row=document.createElement('div');row.className='cloud-reader';const label=document.createElement('span');label.textContent=`${reader.alias} · ${reader.email} · ${reader.browser}`;const button=document.createElement('button');button.type='button';button.textContent=tr('Usa in questo profilo');button.dataset.reader=index;row.append(label,button);$('cloud-backups').append(row);}}
 async function initializeCloud(){const result=await send('AUTH_CLOUD_INIT');render(result);showReaders(result.readers);if(result.readers.length)feedback(tr('Tema e foto recuperati. Scegli il lettore da usare in questo profilo del browser.'));else await synchronize();}
 async function signed(view){render(view);$('app-password').value='';feedback(tr('Accesso completato.'));if(view.user?.verified)await initializeCloud();else feedback(tr('Verifica la tua email per attivare il backup privato.'));}
 async function openProfile(){$('account-dialog').showModal();feedback('');try{const v=demo?{configured:false,user:null}:await send('AUTH_VIEW');render(v);if(v.user?.verified&&v.needsCloudInit)await initializeCloud();}catch(e){feedback(e.message,true);}}
 $('account-open').onclick=openProfile;$('profile-strip').onclick=openProfile;
 $('account-close').onclick=()=>{$('account-dialog').close();$('app-password').value='';appearance(current?.user?current.profile:null);};
 function mode(signup){register=signup;$('show-signin').setAttribute('aria-pressed',String(!signup));$('show-signup').setAttribute('aria-pressed',String(signup));$('email-submit').textContent=tr(signup?'Crea account':'Accedi con email');$('register-hint').hidden=!signup;$('app-password').autocomplete=signup?'new-password':'current-password';}
 $('show-signin').onclick=()=>mode(false);$('show-signup').onclick=()=>mode(true);
 $('account-form').onsubmit=event=>{event.preventDefault();run(async()=>{await signed(await send(register?'AUTH_SIGNUP':'AUTH_SIGNIN',{email:$('app-email').value,password:$('app-password').value}));});};
 $('google-signin').onclick=()=>run(async()=>signed(await send('AUTH_GOOGLE')));
 $('password-reset').onclick=()=>run(async()=>{if(!$('app-email').value||!$('app-email').checkValidity())throw Error(tr('Inserisci prima la tua email.'));await send('AUTH_RESET',{email:$('app-email').value});feedback(tr('Se esiste un account con questa email, riceverai le istruzioni per reimpostare la password.'));});
 $('verify-email').onclick=()=>run(async()=>{await send('AUTH_VERIFY');feedback(tr('Email di verifica inviata. Controlla la tua posta.'));});
 $('recheck-email').onclick=()=>run(async()=>{render(await send('AUTH_RECHECK'));if(current.user?.verified)await initializeCloud();else feedback(tr('L’email non risulta ancora verificata.'));});
 $('account-signout').onclick=()=>run(async()=>{render(await send('AUTH_SIGNOUT'));$('cloud-backups').replaceChildren();backups=[];restored=[];feedback(tr('Hai effettuato l’uscita. I lettori Rewards restano collegati sul PC.'));});
 async function raster(file,isBanner){
  if(!file)return null;const gif=file.type==='image/gif',budget=RewardsAccount.profileImageBudget(isBanner,isBanner?photo:banner);
  if(!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)||!gif&&file.size>(isBanner?6:2)*1024*1024)throw Error(tr(isBanner?'Scegli un banner JPG, PNG, WebP o GIF. Le immagini statiche possono arrivare a 6 MB.':'Scegli una foto JPG, PNG, WebP o GIF. Le immagini statiche possono arrivare a 2 MB.'));
  let original='';if(gif){
   const byteBudget=Math.max(0,Math.floor((budget-22)/4)*3),kb=Math.floor(byteBudget/1024*10)/10;
   const tooLarge=()=>Error(tr('La GIF supera lo spazio disponibile ({kb} KB). Scegli una GIF più leggera.').replace('{kb}',String(kb)));
   if(file.size>byteBudget)throw tooLarge();
   original=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error(tr('GIF non valida. Scegli un altro file.')));reader.readAsDataURL(file);});
   if(original.length>budget)throw tooLarge();try{RewardsAccount.cleanProfile({photo:isBanner?photo:original,banner:isBanner?original:banner});}catch{throw Error(tr('GIF non valida. Scegli un altro file.'));}
  }
  const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;try{await image.decode();}catch(e){if(gif)throw Error(tr('GIF non valida. Scegli un altro file.'));throw e;}if(!image.naturalWidth||!image.naturalHeight)throw Error(tr(gif?'GIF non valida. Scegli un altro file.':'Foto non valida.'));
   if(gif)return original;
   const ratio=isBanner?4:1,sw=Math.min(image.naturalWidth,image.naturalHeight*ratio),sh=sw/ratio;let width=isBanner?960:160;
   while(width>=(isBanner?320:80)){const canvas=document.createElement('canvas');canvas.width=width;canvas.height=Math.round(width/ratio);canvas.getContext('2d').drawImage(image,(image.naturalWidth-sw)/2,(image.naturalHeight-sh)/2,sw,sh,0,0,canvas.width,canvas.height);
    for(const quality of [.86,.72,.58,.44]){const value=canvas.toDataURL('image/jpeg',quality);if(value.length<=budget)return value;}width=Math.floor(width*.75);
   }throw Error(tr('Immagini troppo grandi. Scegli un banner più leggero.'));
  }finally{URL.revokeObjectURL(url);}
 }
 async function upload(isBanner){const input=$(isBanner?'app-banner-input':'app-photo-input'),version=visualGeneration,stamp=current?.account?.stamp;
  if(!current?.user)throw Error(tr('Accedi per personalizzare il profilo.'));
  try{const value=await raster(input.files[0],isBanner);if(!value)return;if(version!==visualGeneration||stamp!==current?.account?.stamp)throw Error(tr('Accesso annullato.'));
   if(isBanner){banner=value;bannerChoice();$('app-banner-style').value='image';}else photo=value;appearance(draft());
  }finally{input.value='';}
 }
 $('app-photo-input').onchange=()=>run(()=>upload(false));$('app-banner-input').onchange=()=>run(()=>upload(true));
 $('remove-profile-photo').onclick=()=>{photo='';appearance(draft());};
 $('remove-profile-banner').onclick=()=>{banner='';$('app-banner-style').value='theme';bannerChoice();appearance(draft());};
 $('app-name').oninput=()=>{if(current?.user)appearance(draft());};
 $('appearance-form').onchange=event=>{if(event.target.name==='theme'||event.target.id==='app-banner-style')appearance(draft());};
 $('appearance-form').onsubmit=event=>{event.preventDefault();run(async()=>{render(await send('AUTH_PROFILE',{profile:draft()}));feedback(tr('Profilo salvato su questo browser.'));if(current.user.verified)await synchronize();});};
 $('account-dialog').addEventListener('close',()=>{visualGeneration++;photo=current?.profile?.photo||'';banner=current?.profile?.banner||'';$('app-banner-style').value=current?.profile?.bannerStyle||'theme';bannerChoice();appearance(current?.user?current.profile:null);});
 $('cloud-save').onclick=()=>run(synchronize);
 $('cloud-load').onclick=()=>run(async()=>{
  backups=(await send('AUTH_CLOUD_LIST')).backups;$('cloud-backups').replaceChildren();
  if(!backups.length){feedback(tr('Non ci sono ancora backup salvati.'));return;}
  for(const [index,backup] of backups.entries()){
   const box=document.createElement('div');box.className='cloud-backup';const caption=document.createElement('small');caption.textContent=new Date(backup.updatedAt).toLocaleString(globalThis.RewardsI18n?.locale);box.append(caption);
   const button=document.createElement('button');button.type='button';button.textContent=tr('Recupera questo backup');button.dataset.backup=index;box.append(button);const download=document.createElement('button');download.type='button';download.textContent=tr('Scarica backup privato');download.dataset.download=index;box.append(download);$('cloud-backups').append(box);
  }
 });
 $('cloud-backups').onclick=event=>{const target=event.target.closest('button');if(!target)return;run(async()=>{
  if(target.dataset.download!==undefined){const backup=await send('AUTH_CLOUD_EXPORT',{device:backups[Number(target.dataset.download)].id});const url=URL.createObjectURL(new Blob([JSON.stringify(backup,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='rewards-adviser-private-backup.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);feedback(tr('Backup scaricato: contiene chiave ed email. Conservalo in privato.'));}
  else if(target.dataset.backup!==undefined){const result=await send('AUTH_CLOUD_RESTORE',{device:backups[Number(target.dataset.backup)].id});render(result);restored=result.readers;$('cloud-backups').replaceChildren();
   showReaders(result.readers);
   feedback(tr('Tema e foto recuperati. Scegli il lettore da usare in questo profilo del browser.'));
  }else if(target.dataset.reader!==undefined){const reader=restored[Number(target.dataset.reader)];await send('AUTH_READER',{slot:reader.slot});feedback(tr('Lettore recuperato. Apri Rewards e accedi all’account Microsoft corrispondente.'));}
 });};
 if(!demo)send('AUTH_VIEW').then(async v=>{render(v);if(v.user?.verified&&v.needsCloudInit)await initializeCloud();}).catch(()=>{});
 if(!demo)chrome.runtime.onMessage.addListener((message,sender)=>{const worker=new URL('../background.js',location.href).href;if(message?.type==='ACCOUNT_CHANGED'&&sender.id===chrome.runtime.id&&sender.url===worker){visualGeneration++;backups=[];restored=[];photo='';banner='';$('cloud-backups').replaceChildren();appearance(null);send('AUTH_VIEW').then(render).catch(()=>{});}});
})();
