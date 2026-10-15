const {test}=require('node:test');const assert=require('node:assert/strict');
let api={};try{api=require('../extension/i18n.js');}catch{}
test('automatic language uses Italian and falls back to English for other system languages',()=>{
 assert.equal(typeof api.create,'function');assert.equal(api.create('it-IT').language,'it');assert.equal(api.create('en-GB').language,'en');assert.equal(api.create('de-DE').language,'en');
 assert.equal(api.create('en-US').t('Impostazioni'),'Settings');assert.equal(api.create('it-IT').t('Impostazioni'),'Impostazioni');
});
test('tagged UI templates translate static labels without altering account names or markup inputs',()=>{
 assert.equal(typeof api.create,'function');const tr=api.create('en-US').t;
 const name='Fatto <b>Impostazioni</b>';
 assert.equal(tr`<span>Saldo ${name}</span>`,'<span>Balance Fatto <b>Impostazioni</b></span>');
 assert.equal(tr`Lettura di ${7} min fa`,'Read 7 min ago');
});
test('notifications and account setup are translated in the same language',()=>{
 assert.equal(typeof api.create,'function');const tr=api.create('en-US').t;
 assert.equal(tr('Rewards: ci sono attività da completare'),'Rewards: activities still to complete');
 assert.equal(tr('Salva e collega'),'Save and connect');assert.equal(tr('Email Microsoft'),'Microsoft email');
});
