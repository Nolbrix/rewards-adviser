const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../extension/core.js'),i18n=require('../extension/i18n.js');
const now=Date.parse('2026-10-15T10:00:00Z'),date='2026-10-15';

async function panel(account={}){
 const elements=new Map();
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){}},contains(){return false;}});return elements.get(id);};
 class FixedDate extends Date {static now(){return now;}}
 const state={accounts:[{slot:1,clientId:'reader-one',alias:'Da fare',manual:[],...account}],settings:{timezone:'Europe/Rome'}};
 const runtime={id:'test',async sendMessage(){return {ok:true,data:{state,config:{},connection:{online:true}}};}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/ui/ui.js'),'utf8'),{
  RewardsCore:core,RewardsI18n:{...i18n.create('en-US'),localizeDocument(){}},chrome:{runtime},
  document:{getElementById:element,body:{classList:{add(){}}},querySelectorAll:()=>[],activeElement:null},
  location:{search:''},Date:FixedDate,Intl,setInterval(){}
 });
 await new Promise(resolve=>setImmediate(resolve));
 return {element,html:element('accounts').innerHTML};
}

test('English dashboard translates waiting account status and active connection',async()=>{
 const p=await panel();
 assert.match(p.html,/<span class="pill off">Waiting<\/span>/);
 assert.equal(p.element('connection').textContent,'Local connection active');
});

test('English dashboard translates unknown task captions and partial totals',async()=>{
 const p=await panel({snapshot:{date,observedAt:now,coverage:{daily:true},activities:[
  {id:'unknown',title:'Impostazioni',category:'daily',status:'unknown',earned:null,total:null,source:'page'}
 ]}});
 assert.match(p.html,/<span class="pill warn">Partial data<\/span>/);
 assert.match(p.html,/title="Unverified"/);
 assert.equal(p.element('total-note').textContent,'Partial total: some activities are unverified.');
});

test('English rendering preserves user account names and page task titles',async()=>{
 const p=await panel({snapshot:{date,observedAt:now,coverage:{daily:true},activities:[
  {id:'custom-title',title:'Impostazioni',category:'daily',status:'complete',earned:10,total:10,source:'page'}
 ]}});
 assert.match(p.html,/<div class="account-name">Da fare<\/div>/);
 assert.match(p.html,/<span class="task-title">Impostazioni<\/span>/);
 assert.match(p.html,/<span class="task-points">Done<\/span>/);
 assert.match(p.html,/title="Complete"/);
});
