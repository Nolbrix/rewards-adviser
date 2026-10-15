const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const core=require('../extension/core.js');
const now=Date.parse('2026-10-15T10:00:00Z'),today='2026-10-15';
const checkin={id:'manual-checkin',title:'Check-in Bing',category:'phone',total:5,earned:0,status:'incomplete',source:'manual',date:today};
const reading={id:'manual-read',title:'Letture articoli Bing',category:'phone',total:30,earned:12,status:'incomplete',source:'manual',date:today};

async function panel(manual=[]) {
 const elements=new Map(),requests=[];
 const element=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',classList:{add(){}},contains(){return false;}});return elements.get(id);};
 class FixedDate extends Date {static now(){return now;}}
 const state={accounts:[{slot:1,clientId:'reader-one',manual}],settings:{timezone:'Europe/Rome'}};
 const chrome={runtime:{id:'test-extension',async sendMessage(message){
  if(message.type==='GET')return {ok:true,data:{state,config:{},connection:{online:true}}};
  requests.push(JSON.parse(JSON.stringify(message)));
  return {ok:true,data:{state}};
 }}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/ui/ui.js'),'utf8'),{RewardsCore:core,chrome,document:{getElementById:element,body:{classList:{add(){}}},querySelectorAll:()=>[],activeElement:null},location:{search:''},Date:FixedDate,Intl,setInterval(){}});
 await new Promise(resolve=>setImmediate(resolve));
 return {
  get html(){return element('accounts').innerHTML;},
  get notice(){return element('notice').textContent;},requests,
  async change(id,status){const select={dataset:{phone:id,slot:'1'},value:status,closest:()=>select};await element('accounts').onchange({target:select});},
  async submitRead(value){const form={dataset:{slot:'1'},elements:{confirmedPoints:{value:String(value)}},matches:selector=>selector.split(',').some(s=>s.trim()==='.phone-read'),closest:selector=>selector.split(',').some(s=>s.trim()==='.phone-read')?form:null};await element('accounts').onsubmit({target:form,preventDefault(){}});}
 };
}
function sentReading(panel){return panel.requests.at(-1)?.activities?.find(item=>item.id==='manual-read');}

test('article reading starts unknown with a dedicated manual app-only 30 point control',async()=>{
 const p=await panel();
 assert.match(p.html,/Letture articoli Bing/);assert.match(p.html,/Manuale.*solo app/);
 assert.match(p.html,/name="confirmedPoints"[^>]*min="0"[^>]*max="30"/);
 assert.match(p.html,/name="confirmedPoints"[^>]*value=""/);assert.match(p.html,/>Salva<\/button>/);
 assert.match(p.html,/Check-in Bing/);assert.equal(p.requests.length,0);
});
test('partial reading displays confirmed points and contributes its residual once',async()=>{
 const p=await panel([checkin,reading]);
 assert.match(p.html,/name="confirmedPoints"[^>]*value="12"/);
 const summary=core.summarize({manual:[checkin,reading]},now,'Europe/Rome');
 assert.equal(summary.remaining,23);assert.equal(summary.groups.phone.length,2);
});
test('saving article points sends one explicit confirmation and keeps check-in separate',async()=>{
 const p=await panel([checkin,reading]);await p.submitRead('18');
 assert.equal(p.requests.length,1);assert.equal(p.requests[0].type,'MANUAL');assert.equal(p.requests[0].slot,1);
 assert.equal(sentReading(p)?.confirmedPoints,18);assert.equal(sentReading(p)?.total,30);
 assert.equal(p.requests[0].activities.filter(item=>item.id==='manual-read').length,1);
 const retained=p.requests[0].activities.find(item=>item.id==='manual-checkin');assert.equal(retained.status,'incomplete');assert.equal(retained.total,5);
});
test('empty or invalid article points never silently save zero',async()=>{
 for(const value of ['', ' ', '-1','31','1.5','text']){const p=await panel([checkin,reading]);await p.submitRead(value);assert.equal(p.requests.length,0,`unexpected save for ${JSON.stringify(value)}`);}
 const p=await panel([checkin,reading]);await p.submitRead('0');assert.equal(sentReading(p)?.confirmedPoints,0);
});
test('changing check-in reserializes the current article partial without losing it',async()=>{
 const p=await panel([checkin,reading]);await p.change('manual-checkin','complete');
 assert.equal(sentReading(p)?.confirmedPoints,12);assert.equal(sentReading(p)?.earned,12);
 assert.equal(p.requests[0].activities.find(item=>item.id==='manual-checkin').status,'complete');
});
test('previous-day reading points stay unknown when another phone task changes',async()=>{
 const p=await panel([checkin,{...reading,date:'2026-10-14',earned:24}]);
 assert.match(p.html,/name="confirmedPoints"[^>]*value=""/);await p.change('manual-checkin','complete');
 assert.equal(sentReading(p)?.confirmedPoints,null);assert.equal(sentReading(p)?.earned,null);assert.equal(sentReading(p)?.status,'unknown');
});
test('article status choices explicitly map to zero, full allowance or unknown',async()=>{
 for(const [status,want] of [['incomplete',0],['complete',30],['unknown',null],['not-applicable',null]]){
  const p=await panel([checkin,reading]);await p.change('manual-read',status);
  assert.equal(sentReading(p)?.confirmedPoints,want,status);assert.equal(sentReading(p)?.status,status);
 }
});
test('legacy confirmed to-do reading gains the 30 point allowance without marking defaults to-do',async()=>{
 const p=await panel([checkin,{...reading,title:'Letture / altre attività Bing',earned:0,total:null}]);
 assert.match(p.html,/Letture articoli Bing/);assert.match(p.html,/name="confirmedPoints"[^>]*value="0"/);
 assert.match(p.html,/<div class="remaining"><strong>35<\/strong>/);
 await p.change('manual-checkin','complete');assert.equal(sentReading(p)?.total,30);assert.equal(sentReading(p)?.confirmedPoints,0);
 const unknown=await panel([checkin,{...reading,earned:null,status:'unknown',total:null}]);
 await unknown.change('manual-checkin','complete');assert.equal(sentReading(unknown)?.confirmedPoints,null);assert.equal(sentReading(unknown)?.status,'unknown');
});
