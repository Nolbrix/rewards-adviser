(()=>{
 'use strict';const $=id=>document.getElementById(id),tr=globalThis.RewardsI18n?.t||(s=>s),demo=!globalThis.chrome?.runtime?.id;
 let current=null,register=false,photo='',backups=[],restored=[],busy=false;
 async function send(type,data={}){if(demo)throw Error(tr('Il login è disponibile nell’estensione installata.'));const r=await chrome.runtime.sendMessage({type,...data,account:current?.account});if(!r?.ok)throw Error(tr(r?.error||'Operazione non disponibile.'));return r.data;}
 function feedback(message,error=false){$('account-feedback').textContent=message;$('account-feedback').classList.toggle('error',error);}
 function appearance(profile){document.body.dataset.theme=profile?.theme||'neutral';const image=profile?.photo||'';$('profile-photo').hidden=!image;$('profile-initial').hidden=!!image;if(image)$('profile-photo').src=image;else $('profile-photo').removeAttribute('src');}
 function render(view){if(current?.account?.stamp!==view?.account?.stamp){backups=[];restored=[];photo='';$('cloud-backups').replaceChildren();}current=view;const user=view?.user,profile=view?.profile;
  $('account-login').hidden=!!user;$('account-personalize').hidden=!user;$('account-caption').textContent=user?(profile?.name||user.name||tr('Il mio profilo')):tr('Accedi');appearance(user?profile:null);
  $('account-config-status').textContent=view?.configured?'':tr('Il servizio di accesso è in preparazione. Il riepilogo locale resta disponibile.');$('google-signin').disabled=!view?.configured||!view?.googleReady;$('email-submit').disabled=!view?.configured;
  if(user){$('app-identity').textContent=user.email;$('verify-section').hidden=user.verified;$('app-name').value=profile?.name||user.name||'';photo=profile?.photo||'';document.querySelector(`input[name="theme"][value="${profile?.theme||'blue'}"]`).checked=true;}else{$('app-identity').textContent='';$('app-name').value='';}
 }
 async function run(action){if(busy)return;busy=true;feedback('');const buttons=[...$('account-dialog').querySelectorAll('button')].filter(b=>b.id!=='account-close');const disabled=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);try{await action();}catch(e){feedback(e.message,true);}finally{buttons.forEach((b,i)=>b.disabled=disabled[i]);busy=false;if(current){$('google-signin').disabled=!current.configured||!current.googleReady;$('email-submit').disabled=!current.configured;}}}
 async function synchronize(){try{const r=await send('AUTH_CLOUD_SAVE');if(r.saved)feedback(tr('Backup privato salvato.'));}catch(e){feedback(e.message,true);}}
 function showReaders(readers){restored=readers;$('cloud-backups').replaceChildren();for(const [index,reader] of restored.entries()){const row=document.createElement('div');row.className='cloud-reader';const label=document.createElement('span');label.textContent=`${reader.alias} · ${reader.email} · ${reader.browser}`;const button=document.createElement('button');button.type='button';button.textContent=tr('Usa in questo profilo');button.dataset.reader=index;row.append(label,button);$('cloud-backups').append(row);}}
 async function initializeCloud(){const result=await send('AUTH_CLOUD_INIT');render(result);showReaders(result.readers);if(result.readers.length)feedback(tr('Tema e foto recuperati. Scegli il lettore da usare in questo profilo del browser.'));else await synchronize();}
 async function signed(view){render(view);$('app-password').value='';feedback(tr('Accesso completato.'));if(view.user?.verified)await initializeCloud();else feedback(tr('Verifica la tua email per attivare il backup privato.'));}
 $('account-open').onclick=async()=>{$('account-dialog').showModal();feedback('');try{const v=demo?{configured:false,user:null}:await send('AUTH_VIEW');render(v);if(v.user?.verified&&v.needsCloudInit)await initializeCloud();}catch(e){feedback(e.message,true);}};
 $('account-close').onclick=()=>{$('account-dialog').close();$('app-password').value='';appearance(current?.user?current.profile:null);};
 function mode(signup){register=signup;$('show-signin').setAttribute('aria-pressed',String(!signup));$('show-signup').setAttribute('aria-pressed',String(signup));$('email-submit').textContent=tr(signup?'Crea account':'Accedi con email');$('register-hint').hidden=!signup;$('app-password').autocomplete=signup?'new-password':'current-password';}
 $('show-signin').onclick=()=>mode(false);$('show-signup').onclick=()=>mode(true);
 $('account-form').onsubmit=event=>{event.preventDefault();run(async()=>{await signed(await send(register?'AUTH_SIGNUP':'AUTH_SIGNIN',{email:$('app-email').value,password:$('app-password').value}));});};
 $('google-signin').onclick=()=>run(async()=>signed(await send('AUTH_GOOGLE')));
 $('password-reset').onclick=()=>run(async()=>{if(!$('app-email').value||!$('app-email').checkValidity())throw Error(tr('Inserisci prima la tua email.'));await send('AUTH_RESET',{email:$('app-email').value});feedback(tr('Se esiste un account con questa email, riceverai le istruzioni per reimpostare la password.'));});
 $('verify-email').onclick=()=>run(async()=>{await send('AUTH_VERIFY');feedback(tr('Email di verifica inviata. Controlla la tua posta.'));});
 $('recheck-email').onclick=()=>run(async()=>{render(await send('AUTH_RECHECK'));if(current.user?.verified)await initializeCloud();else feedback(tr('L’email non risulta ancora verificata.'));});
 $('account-signout').onclick=()=>run(async()=>{render(await send('AUTH_SIGNOUT'));$('cloud-backups').replaceChildren();backups=[];restored=[];feedback(tr('Hai effettuato l’uscita. I lettori Rewards restano collegati sul PC.'));});
 $('app-photo-input').onchange=()=>run(async()=>{
  const file=$('app-photo-input').files[0];if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error(tr('Scegli una foto JPG, PNG o WebP entro 2 MB.'));
  const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();const size=Math.min(image.naturalWidth,image.naturalHeight);if(!size)throw Error(tr('Foto non valida.'));
   const canvas=document.createElement('canvas');canvas.width=canvas.height=160;canvas.getContext('2d').drawImage(image,(image.naturalWidth-size)/2,(image.naturalHeight-size)/2,size,size,0,0,160,160);photo=canvas.toDataURL('image/jpeg',.85);appearance({...current.profile,photo});
  }finally{URL.revokeObjectURL(url);$('app-photo-input').value='';}
 });
 $('remove-profile-photo').onclick=()=>{photo='';appearance({...current.profile,photo});};
 $('appearance-form').onchange=event=>{if(event.target.name==='theme')appearance({...current.profile,photo,theme:event.target.value});};
 $('appearance-form').onsubmit=event=>{event.preventDefault();run(async()=>{const theme=document.querySelector('input[name="theme"]:checked').value;render(await send('AUTH_PROFILE',{profile:{name:$('app-name').value,theme,photo}}));feedback(tr('Profilo salvato su questo browser.'));if(current.user.verified)await synchronize();});};
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
 if(!demo)chrome.runtime.onMessage.addListener((message,sender)=>{const worker=new URL('../background.js',location.href).href;if(message?.type==='ACCOUNT_CHANGED'&&sender.id===chrome.runtime.id&&sender.url===worker){backups=[];restored=[];photo='';$('cloud-backups').replaceChildren();appearance(null);send('AUTH_VIEW').then(render).catch(()=>{});}});
})();
