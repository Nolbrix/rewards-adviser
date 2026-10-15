(()=>{
 'use strict';const tr=globalThis.RewardsI18n?.t||((parts,...values)=>typeof parts==='string'?parts:parts.reduce((out,p,i)=>out+p+(i<values.length?String(values[i]):''),'')),locale=globalThis.RewardsI18n?.locale||'it-IT';
 if(globalThis.RewardsI18n)RewardsI18n.localizeDocument(document);
 const core=RewardsCore,demo=!globalThis.chrome?.runtime?.id,$=id=>document.getElementById(id);
 let view=demo?RewardsDemo.view():{state:null,config:null,connection:null},renderKey='',busy=false;
 const fmt=n=>new Intl.NumberFormat(locale).format(n),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={daily:tr('Set giornaliero'),extra:tr('Extra e bonus'),search:tr('Ricerche Bing · PC + telefono'),desktop:tr('Ricerche PC'),mobile:tr('Ricerche telefono'),phone:tr('Bing sul telefono')};
 const searchHelp={
  'not-signed-in':tr('Apri Bing nello stesso profilo sorgente e accedi all’account Microsoft associato, poi aggiorna Rewards.'),
  'account-mismatch':tr('Bing mostra un altro account. Apri Bing nello stesso profilo sorgente, verifica l’account Microsoft associato e aggiorna Rewards.'),
  'identity-unverified':tr('L’identità di Bing non è verificabile. Apri Bing nello stesso profilo sorgente, verifica l’account Microsoft associato e aggiorna Rewards.'),
  'unavailable':tr('Il contatore delle ricerche non è disponibile. Apri Bing nello stesso profilo sorgente e aggiorna Rewards.')
 };
 const phoneDefaults=[{id:'manual-checkin',title:'Check-in Bing',status:'unknown',total:null},{id:'manual-read',title:tr('Letture articoli Bing'),status:'unknown',total:30}];
 const articleId=id=>id==='manual-read'||id==='phone-articles';
 const phoneReaderLabels={off:tr('Lettura automatica del Galaxy in pausa.'),'calibration-needed':tr('Il riconoscimento del Galaxy deve essere configurato prima della lettura.'),'waiting-phone':tr('In attesa del Galaxy: mantieni il telefono connesso e sbloccato.'),'waiting-idle':tr('La lettura automatica parte quando il PC è inattivo.'),'reading':tr('Lettura automatica degli articoli dal Galaxy in corso.'),'ready':tr('Lettura automatica aggiornata dal Galaxy.'),'interrupted':tr('Lettura interrotta: il PC o il telefono è stato usato.'),'unreadable':tr('Il contatore sul Galaxy non è leggibile. I punti restano da verificare.'),'account-unavailable':tr('Un account non è disponibile nell’app Bing sul Galaxy.'),'error':tr('Lettura del Galaxy non disponibile. Controlla Collegamento al telefono.')};
 const errorLabels={'account-change':tr('La pagina mostra un altro account. Riassocia il profilo.'),'identity-unverified':tr('Email della sessione non verificabile. La lettura precedente è conservata; aggiorna Rewards.'),'page-unrecognized':tr('Pagina non riconosciuta o sessione scaduta. Ricarica Rewards; se persiste, esporta un dump.')};
 if(location.search.includes('expanded=1')||demo)document.body.classList.add('expanded');
 function notice(message){$('notice').textContent=message;$('notice').hidden=!message;}
 async function send(message){if(demo)throw new Error(tr('Questa è un’anteprima con dati di esempio. Le azioni sono disponibili nell’estensione installata.'));const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw new Error(response?.error||tr('L’estensione non ha risposto. Riapri il pannello.'));return response.data;}
 function phoneTasks(account){const date=core.dayKey(Date.now(),view.state?.settings?.timezone),saved=account.manual?.length?account.manual:phoneDefaults;
  const tasks=account.phoneReading&&!saved.some(a=>articleId(a.id))?[...saved,phoneDefaults[1]]:saved;
  return tasks.filter((a,index)=>!articleId(a.id)||tasks.findIndex(task=>articleId(task.id))===index).map(savedTask=>{
  const a=savedTask.id==='phone-articles'?{...savedTask,id:'manual-read'}:savedTask;
  const expired=a.date&&a.date!==date,status=expired?'unknown':a.status||'unknown';
  if(a.id!=='manual-read')return {...a,status};
  const confirmedPoints=status==='complete'?30:status==='incomplete'?(core.validNumber(a.earned)&&a.earned<=30?a.earned:0):null;
  return {...a,title:tr('Letture articoli Bing'),total:30,status,earned:confirmedPoints,confirmedPoints};
 });}
 function phoneContext(account){return account.phoneReaderEnabled===undefined&&view.state?.phoneReader?{...account,phoneReaderEnabled:view.state.phoneReader.enabled===true}:account;}
 function accountSummary(account){return core.summarize({...phoneContext(account),manual:phoneTasks(account)},Date.now(),view.state?.settings?.timezone);}
 function category(account,summary,kind,opened){const items=summary.groups[kind],coverage=summary.current&&account.snapshot?.coverage;
  const searchKind=['search','desktop','mobile'].includes(kind),missingSearchHelp=searchHelp[account.snapshot?.diagnostics?.searchStatus]||tr('Apri Bing nello stesso profilo sorgente e aggiorna Rewards. I punti delle ricerche non sono ancora verificabili.');
  let label=tr('Non rilevato');
  if(kind==='daily')label=items.length?tr`${items.filter(a=>a.status==='complete').length}/${items.length} fatte`:coverage?.daily?tr('Nessuna attività'):tr('Non rilevato');
  if(kind==='extra')label=items.length?tr`${items.filter(a=>a.status==='incomplete').length} da fare${items.some(a=>a.status==='unknown')?' · ?':''}`:coverage?.extra?tr('Nessun extra'):tr('Non rilevato');
  if(searchKind){const a=items[0];if(a)label=a.total!==null&&a.earned!==null?tr`${fmt(a.earned)} / ${fmt(a.total)}`:tr('Punti non disponibili');}
  const phone=kind==='phone'?core.phoneObservation(phoneContext(account),Date.now(),view.state?.settings?.timezone):null;
  if(kind==='phone')label=phone.active?tr`${fmt(phone.item.earned)} / 30 · Galaxy`:phone.present?tr('Letture da aggiornare'):phone.required?tr('Articoli da verificare'):tr('Conferma manuale');
  let content='';
  if(kind==='phone'){
   const tasks=phoneTasks(account);content='';
   if(phone.present){
    const time=phone.item.observedAt!==null?new Date(phone.item.observedAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:view.state?.settings?.timezone||'Europe/Rome'}):tr('orario non disponibile');
    content+=tr`<div class="phone-task"><span>Letture articoli Bing<span class="manual-tag">Letto dal Galaxy · ${esc(time)}${phone.active?'':tr(' · da aggiornare')}</span></span><strong>${phone.item.earned===null?'?':fmt(phone.item.earned)} / 30</strong></div>`;
    if(!phone.active)content+=tr('<p class="help">L’ultima lettura del Galaxy non è attuale e non entra nel totale. Puoi confermare i punti nell’app e salvarli a mano come alternativa.</p>');
   }
   if(phone.required&&!phone.present)content+=tr('<p class="help">In attesa della lettura automatica dal Galaxy. I punti degli articoli restano da verificare.</p>');
   content+=tr`<p class="help">${phone.active?tr('Le letture articoli si aggiornano dal Galaxy. Gli altri controlli restano manuali.'):tr('Controlli facoltativi per le attività che vedi nell’app. Non verificati dal sito.')}</p>`;
   content+=tasks.filter(a=>!phone.active||!articleId(a.id)).map(a=>{
    const row=tr`<div class="phone-task"><label for="phone-${account.slot}-${esc(a.id)}">${esc(a.title)}<span class="manual-tag">Manuale${a.id==='manual-read'?tr(' · solo app'):''}${a.total!==null&&a.total!==undefined?' · '+fmt(a.total)+' pt':''}</span></label><select id="phone-${account.slot}-${esc(a.id)}" data-phone="${esc(a.id)}" data-slot="${account.slot}" aria-label="Stato ${esc(a.title)}"><option value="unknown" ${a.status==='unknown'?'selected':''}>Da verificare</option><option value="incomplete" ${a.status==='incomplete'?'selected':''}>Da fare</option><option value="complete" ${a.status==='complete'?'selected':''}>Fatto</option><option value="not-applicable" ${a.status==='not-applicable'?'selected':''}>Non presente</option></select><button class="remove" data-remove="${esc(a.id)}" data-slot="${account.slot}" aria-label="Rimuovi ${esc(a.title)}">×</button></div>`;
    return row+(a.id==='manual-read'?tr`<form class="phone-read phone-add" data-slot="${account.slot}"><label for="read-points-${account.slot}">Punti confermati nell’app (0–30)</label><input id="read-points-${account.slot}" name="confirmedPoints" type="number" min="0" max="30" step="1" value="${a.confirmedPoints??''}" aria-label="Punti confermati per letture articoli Bing" required><button type="submit">Salva</button></form>`:'');
   }).join('');
   content+=tr`<form class="phone-add" data-slot="${account.slot}"><label class="sr-only" for="add-title-${account.slot}">Nome attività Bing</label><input id="add-title-${account.slot}" name="title" placeholder="Aggiungi un’attività dell’app" maxlength="120" required><label class="sr-only" for="add-points-${account.slot}">Punti opzionali</label><input id="add-points-${account.slot}" name="points" type="number" min="0" max="100000" placeholder="Punti"><button type="submit">+</button></form>`;
  }else if(items.length){
   const total=items.reduce((n,a)=>n+(a.total||0),0),earned=items.reduce((n,a)=>n+(a.earned||0),0);
   const percent=kind==='daily'?items.filter(a=>a.status==='complete').length/items.length*100:total?earned/total*100:0;
   content=tr`<div class="progress-track" aria-hidden="true"><div class="progress-fill" style="width:${Math.min(100,Math.max(0,percent))}%"></div></div><ul class="task-list">`+items.map(a=>tr`<li class="task"><span class="task-state ${a.status}" title="${a.status==='complete'?tr('Completata'):a.status==='incomplete'?tr('Da completare'):tr('Non verificabile')}">${a.status==='complete'?'✓':a.status==='incomplete'?'○':'?'}</span><span class="task-title">${esc(a.title)}</span><span class="task-points">${a.status==='complete'?tr('Fatto'):a.remaining!==null?fmt(a.remaining)+' pt':'? pt'}</span></li>`).join('')+'</ul>';
   if(searchKind&&items.some(a=>a.total===null||a.earned===null))content+=tr`<p class="help">${missingSearchHelp}</p>`;
  }else content='<p class="help">'+(searchKind?missingSearchHelp:coverage?.[kind]?tr('Microsoft non mostra attività in questa categoria.'):tr('Apri e aggiorna Rewards nel profilo sorgente. I dati mancanti restano sconosciuti.'))+'</p>';
  if(kind!=='phone'&&account.snapshot&&(!summary.fresh||account.error)&&(items.length||coverage?.[kind])){label+=tr(' · da aggiornare');content=tr('<p class="help">Dati dell’ultima lettura, esclusi dal totale attuale finché Rewards non viene aggiornato.</p>')+content;}
  const key=tr`${account.slot}-${kind}`;return tr`<details class="category" data-detail="${key}" ${opened.has(key)?'open':''}><summary><span class="category-title">${labels[kind]}</span><span class="category-total">${label}</span></summary>${content}</details>`;
 }
 function card(account,opened){const s=accountSummary(account),snapshot=account.snapshot;
  const categories=core.CATEGORIES.filter(kind=>snapshot?.searchMode==='combined'?!['desktop','mobile'].includes(kind):kind!=='search');
  const connected=!!account.clientId,status=account.error?tr('Da controllare'):!snapshot?tr('In attesa'):!s.current?tr('Giorno precedente'):s.stale?tr('Da aggiornare'):s.completed?tr('Rilevate complete'):s.partial?tr('Dati parziali'):tr('Da completare');
  const tone=!snapshot?'off':account.error||s.stale||s.partial?'warn':'';
  const age=snapshot?Math.max(0,Math.floor((Date.now()-snapshot.observedAt)/60000)):null;
  const updated=snapshot?(age<1?tr('Lettura appena aggiornata'):tr`Lettura di ${age} min fa`):tr('Nessuna lettura ricevuta');
  const historical=!!snapshot&&(s.stale||!!account.error);
  const phoneCaption=s.items.some(a=>a.active&&a.source==='phone-screen')?tr('punti telefono confermati<br>lettura Rewards da aggiornare'):tr('punti confermati a mano<br>lettura Rewards da aggiornare');
  const remainingCaption=historical?(s.hasProgress?phoneCaption:tr('totale da aggiornare<br>ultima lettura conservata')):tr('punti mancanti noti')+(s.partial?tr('<br>totale parziale'):'');
  const readerHelp=connected&&account.lastSeen&&Date.now()-account.lastSeen>120000?tr('<br>Il profilo sorgente non risponde. Apri il suo browser e lascia Rewards aperto.'):connected&&s.stale?tr('<br>Il lettore è collegato, ma la lettura Rewards non è aggiornata. Apri Rewards e premi aggiorna.') : '';
  const identity=snapshot?.account?.identityVerified===false?tr(' · email associata a mano'):'';
  return tr`<article class="account-card" data-account="${account.slot}"><div class="card-head"><div class="avatar" aria-hidden="true">${account.slot}</div><div class="identity"><div class="source-label">${esc(account.browser||tr('Browser da configurare'))}</div><div class="account-name">${esc(account.alias||'Account '+account.slot)}</div><div class="account-email">${esc(account.email||tr('Email Microsoft da associare'))}</div></div></div><div class="card-meta"><span class="pill ${tone}">${status}</span><span class="balance">Saldo <strong>${snapshot?.balance!==null&&snapshot?.balance!==undefined?fmt(snapshot.balance):'—'}</strong></span></div><div class="remaining"><strong>${s.hasProgress?fmt(s.remaining):'—'}</strong><span>${remainingCaption}</span></div>${!connected?tr('<div class="empty-state">Carica l’estensione nel profilo sorgente e scegli questo account nelle impostazioni.</div>'):''}<div class="categories">${categories.map(kind=>category(account,s,kind,opened)).join('')}</div><div class="card-footer"><div class="last-update">${esc(account.error?errorLabels[account.error]||account.error:updated+identity)}${readerHelp}</div><div class="card-buttons"><button data-action="open" data-slot="${account.slot}">Apri Rewards ↗</button><button data-action="refresh" data-slot="${account.slot}" aria-label="Aggiorna account ${account.slot}">↻</button><button data-action="dump" data-slot="${account.slot}">Dump</button></div></div></article>`;
 }
 function render(force=false){const state=view.state,accounts=state?.accounts||[1,2,3].map(slot=>({slot,alias:core.defaultAlias(slot),manual:[]}));
  $('today').textContent=new Intl.DateTimeFormat(locale,{weekday:'long',day:'numeric',month:'long',timeZone:state?.settings?.timezone||'Europe/Rome'}).format(new Date());
  $('connection').textContent=demo?tr('Anteprima · dati di esempio'):view.connection?.online?tr('Collegamento locale attivo'):view.config?.token?tr('Collegamento locale non disponibile'):tr('Collegamento da configurare');$('connection').className='status'+(view.connection?.online?' online':'');
  $('mode').textContent=demo?tr('ESEMPI · nessun account reale'):view.config?.slot?tr`Lettore account ${view.config.slot} · ${view.config.browser}`:tr('Pannello dei tre account');if(demo)$('mode').classList.add('demo-ribbon');
  const summaries=accounts.filter(a=>a.clientId||a.email||a.snapshot).map(accountSummary);
  const known=summaries.reduce((n,s)=>n+s.remaining,0),hasData=summaries.some(s=>s.hasProgress);
  $('total').textContent=hasData?fmt(known):'—';$('total-note').textContent=hasData?(summaries.some(s=>s.partial)?tr('Totale parziale: alcune attività non sono verificabili.'):tr('Somma delle attività rilevate negli account collegati.')):tr('Collega i profili e apri Rewards in ciascun browser.');
  const settings=state?.settings||{},paused=settings.snoozeUntil>Date.now();
  $('reminder-note').textContent=paused?tr('In pausa fino alle ')+new Date(settings.snoozeUntil).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:settings.timezone}):settings.notifications===false?tr('Notifiche disattivate nelle impostazioni.'):state?.coordinatorId?tr('Attivi dal coordinatore. Solo attività incomplete verificabili.'):tr('Attiva il coordinatore in un solo profilo.');
  const phoneReader=state?.phoneReader||{enabled:false,status:'off'};
  $('phone-reader-enabled').checked=phoneReader.enabled===true;
  $('phone-reader-status').textContent=(phoneReaderLabels[phoneReader.status]||phoneReaderLabels.off)+(phoneReader.lastCycleAt?tr(' Ultimo ciclo: ')+new Date(phoneReader.lastCycleAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit',timeZone:settings.timezone||'Europe/Rome'})+'.':'');
  if(!paused)$('pause').value='0';
  const key=JSON.stringify(accounts.map(a=>({...a,lastSeen:!!a.lastSeen&&Date.now()-a.lastSeen<=120000})))+Math.floor(Date.now()/30000);
  if(!force&&(key===renderKey||$('accounts').contains(document.activeElement)&&document.activeElement.matches('input,select')))return;
  const opened=new Set([...document.querySelectorAll('details[data-detail][open]')].map(d=>d.dataset.detail));
  $('accounts').innerHTML=accounts.map(a=>card(a,opened)).join('');renderKey=key;
 }
 async function load(force=false){if(busy)return;busy=true;try{if(!demo)view=await send({type:'GET'});render(force);}catch(error){notice(error.message);}finally{busy=false;}}
 function formConfig(){return {token:$('token').value,slot:$('slot').value?Number($('slot').value):null,browser:$('browser').value,alias:$('alias').value,email:$('email').value,coordinator:$('coordinator').checked,autoRefresh:$('auto-refresh').checked};}
 function fillProfile(config){for(const key of ['alias','email'])$(key).value=config[key]||'';$('slot').value=config.slot||'';$('browser').value=config.browser||'Edge';$('coordinator').checked=config.coordinator===true;$('auto-refresh').checked=config.autoRefresh===true;}
 function profileSummary(){const c=formConfig(),role=c.slot?tr`Account ${c.slot}${c.autoRefresh?tr(' · aggiornamento ogni 2 minuti'):tr(' · aggiornamento manuale')}`:tr('pannello dei tre account');$('profile-summary').textContent=$('profile').value?tr`${c.alias||tr('Configurazione personalizzata')}${c.email?' · '+c.email:''} · ${c.browser} · ${role}${c.coordinator?tr(' · promemoria ogni 10 minuti'):''}`:tr('Seleziona un profilo per compilare la configurazione.');}
 async function openSettings(){if(!demo)view=await send({type:'GET'});const c=view.config||{};$('token').value=c.token||'';fillProfile(c);$('profile').value=RewardsProfiles.keyFor(c);$('advanced-config').open=$('profile').value==='custom';$('timezone').value=view.state?.settings?.timezone||'Europe/Rome';$('notifications').checked=view.state?.settings?.notifications!==false;$('config-error').textContent='';profileSummary();$('config-dialog').showModal();}
 $('settings').onclick=()=>openSettings().catch(e=>notice(e.message));$('close-config').onclick=()=>$('config-dialog').close();$('expand').onclick=()=>send({type:'EXPAND'}).catch(e=>notice(e.message));
 $('profile').onchange=()=>{const key=$('profile').value;if(!key){profileSummary();return;}if(key==='custom')$('advanced-config').open=true;else{fillProfile(RewardsProfiles.apply(key,formConfig()));$('advanced-config').open=false;}$('config-error').textContent='';profileSummary();};
 for(const id of ['browser','email','alias'])$(id).oninput=()=>profileSummary();
 $('advanced-config').onchange=()=>{$('profile').value='custom';profileSummary();};
 $('config-form').onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;try{
  view=await send({type:'CONFIG',config:formConfig()});
  await send({type:'SETTINGS',settings:{timezone:$('timezone').value,notifications:$('notifications').checked}});
  $('config-dialog').close();notice(tr('Profilo collegato. Apri Rewards nel browser sorgente per ricevere la prima lettura.'));await load(true);
 }catch(e){$('config-error').textContent=e.message;}finally{button.disabled=false;}};
 $('reset').onclick=async()=>{try{await send({type:'RESET'});$('email').value='';$('config-error').textContent=tr('Associazione azzerata. Salva e apri Rewards; puoi anche inserire l’email a mano.');}catch(e){$('config-error').textContent=e.message;}};
 $('test-notification').onclick=()=>send({type:'TEST_NOTIFICATION'}).then(()=>{$('config-error').textContent=tr('Notifica di prova inviata. Se non appare, controlla le notifiche di Windows.');}).catch(e=>{$('config-error').textContent=e.message;});
 async function command(target,action){const result=await send({type:'COMMAND',target,action});notice(result.targeted?tr`Richiesta inviata a ${result.targeted} profilo/i. La risposta può richiedere fino a un minuto se la pagina è chiusa.`:tr('Nessun lettore associato: configura prima l’estensione nel profilo sorgente.'));}
 $('refresh').onclick=async()=>{const button=$('refresh');button.disabled=true;try{await command('all','refresh');await load(true);}catch(e){notice(e.message);}finally{button.disabled=false;}};
 $('phone-reader-enabled').onchange=async()=>{const control=$('phone-reader-enabled'),enabled=control.checked;control.disabled=true;try{const response=await send({type:'PHONE_SETTINGS',settings:{enabled}});view.state=response.state;render(true);notice(enabled?tr('Lettura automatica del Galaxy attivata. Il PC deve restare acceso e il telefono collegato.'):tr('Lettura automatica del Galaxy in pausa.'));}catch(e){control.checked=view.state?.phoneReader?.enabled===true;notice(e.message);}finally{control.disabled=false;}};
 $('accounts').onclick=async event=>{const button=event.target.closest('button[data-action],button[data-remove]');if(!button)return;const slot=Number(button.dataset.slot),account=view.state?.accounts?.find(a=>a.slot===slot)||{slot};button.disabled=true;
  try{if(button.dataset.remove){await savePhone(slot,phoneTasks(account).filter(a=>a.id!==button.dataset.remove));}
   else if(button.dataset.action==='dump'){const dump=await send({type:'DUMP',slot});const url=URL.createObjectURL(new Blob([JSON.stringify(dump,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=tr`rewards-dump-account-${slot}-${core.dayKey()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);notice(tr('Dump diagnostico esportato: email oscurata, nessun cookie o token.'));}
   else await command(slot,button.dataset.action);
  }catch(e){notice(e.message);}finally{button.disabled=false;}
 };
 async function savePhone(slot,activities){const response=await send({type:'MANUAL',slot,activities});view.state=response.state;render(true);}
 $('accounts').onchange=async event=>{const select=event.target.closest('select[data-phone]');if(!select)return;const slot=Number(select.dataset.slot),a=view.state?.accounts?.find(x=>x.slot===slot)||{slot};
  try{await savePhone(slot,phoneTasks(a).map(task=>{
   if(task.id!==select.dataset.phone)return task;
   if(task.id!=='manual-read')return {...task,status:select.value};
   const confirmedPoints=select.value==='complete'?30:select.value==='incomplete'?0:null;
   return {...task,status:select.value,earned:confirmedPoints,confirmedPoints,confirmNow:true};
  }));}catch(e){notice(e.message);render(true);}
 };
 $('accounts').onsubmit=async event=>{const form=event.target.closest('.phone-read,.phone-add');if(!form)return;event.preventDefault();const slot=Number(form.dataset.slot),account=view.state?.accounts?.find(a=>a.slot===slot)||{slot};
  if(form.matches('.phone-read')){
   const value=form.elements.confirmedPoints.value.trim(),confirmedPoints=Number(value);
   if(!/^\d+$/.test(value)||!Number.isInteger(confirmedPoints)||confirmedPoints>30){notice(tr('Inserisci i punti delle letture confermati nell’app: un numero intero da 0 a 30.'));return;}
   try{await savePhone(slot,phoneTasks(account).map(task=>task.id==='manual-read'?{...task,confirmedPoints,earned:confirmedPoints,status:confirmedPoints===30?'complete':'incomplete',confirmNow:true}:task));}catch(e){notice(e.message);}return;
  }
  const title=form.elements.title.value.trim(),value=form.elements.points.value;
  try{await savePhone(slot,[...phoneTasks(account),{id:'manual-'+crypto.randomUUID(),title,total:value===''?null:Number(value),status:'incomplete'}]);}catch(e){notice(e.message);}
 };
 $('pause').onchange=async()=>{try{const choice=$('pause').value;let until=choice==='0'?0:Date.now()+Number(choice)*60000;
  if(choice==='tomorrow'){const zone=view.state?.settings?.timezone||'Europe/Rome',today=core.dayKey(Date.now(),zone);let lo=Date.now(),hi=lo+27*3600000;while(hi-lo>1000){const mid=Math.floor((lo+hi)/2);if(core.dayKey(mid,zone)===today)lo=mid;else hi=mid;}until=hi;}
  const response=await send({type:'SETTINGS',settings:{snoozeUntil:until}});view.state=response.state;render(true);
 }catch(e){notice(e.message);}};
 render();load();if(!demo)setInterval(()=>load(),3000);
})();
