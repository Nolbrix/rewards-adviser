const {test}=require('node:test');const assert=require('node:assert/strict');
let parser={};try{parser=require('../extension/parser.js');}catch{}
const options={now:Date.parse('2026-10-14T10:00:00Z'),timezone:'Europe/Rome',sourceUrl:'https://rewards.bing.com/'};
const fixture={userStatus:{availablePoints:12345,email:'alice@example.com',counters:{pcSearch:[{pointProgress:30,pointProgressMax:90}],mobileSearch:[{pointProgress:15,pointProgressMax:60}]}},dailySetPromotions:{'10/13/2026':[{offerId:'old',title:'Yesterday',points:10,complete:false}],'10/14/2026':[{offerId:'daily1',title:'Quiz oggi',points:20,complete:false},{offerId:'daily2',title:'Completato',points:10,complete:true}]},morePromotions:[{offerId:'bonus',title:'Bonus',points:50,complete:false}]};
test('parses daily, extras and search from structured Rewards dashboard',()=>{
 assert.equal(typeof parser.fromData,'function'); const s=parser.fromData(fixture,options);
 assert.equal(s.balance,12345);assert.equal(s.account.email,'alice@example.com');
 assert.equal(s.activities.find(a=>a.id==='daily1').total,20);
 assert.equal(s.activities.find(a=>a.id==='desktop').earned,30);
 assert.ok(!s.activities.some(a=>a.id==='old'));assert.equal(s.coverage.daily,true);
});
test('unrecognized page does not pretend to have completed zero tasks',()=>{
 assert.equal(typeof parser.fromData,'function');const s=parser.fromData({unrelated:{points:999}},options);
 assert.equal(s.balance,null);assert.equal(s.coverage.daily,false);assert.equal(s.activities.length,0);
});
test('extracts JSON assignment without executing scripts or interpolations',()=>{
 assert.equal(typeof parser.extractData,'function');
 assert.equal(parser.extractData('var dashboard = '+JSON.stringify(fixture)+';').userStatus.availablePoints,12345);
 assert.equal(parser.extractData('var dashboard = {"x":dangerous()};'),null);
 assert.equal(parser.extractData('window.alert("evil");'),null);
});
test('numeric text supports Italian thousands and rejects ambiguous progress',()=>{
 assert.equal(typeof parser.number,'function');assert.equal(parser.number('12.345'),12345);assert.equal(parser.number('0'),0);assert.equal(parser.number('10/90'),null);
});
test('missing completion and progress do not imply all-or-nothing award',()=>{
 assert.equal(typeof parser.fromData,'function');const s=parser.fromData({...fixture,morePromotions:[{offerId:'x',title:'Mystery',points:50}]},options);
 assert.equal(s.activities.find(a=>a.id==='x').status,'unknown');assert.equal(s.activities.find(a=>a.id==='x').earned,null);
});
const flightOptions={now:Date.parse('2026-10-15T10:00:00Z'),timezone:'Europe/Rome'};
const flightScript=(records)=>'self.__next_f.push([1,'+JSON.stringify(records.map(([id,value])=>id+':'+JSON.stringify(value)+'\n').join(''))+']);';
const dailyItems=[{date:'10/15/2026',offerId:'daily-a',title:'Prossimi eventi vicino a me',points:10,isCompleted:false},{date:'10/15/2026',offerId:'daily-b',title:'Chicago Foliage Ventoso',points:10,isCompleted:false},{date:'10/15/2026',offerId:'daily-c',title:'Maestà di Borobudur?',points:10,isCompleted:false}];
const flightRecords=[['31',['$','$L56',null,{balance:40590,level:3}]],['79',['$','$L72',null,{type:'dailyset',model:{dailySetItems:dailyItems}}]],['75',['$','$L72',null,{type:'pointsclaim',model:{pointClaim:{points:109}}}]],['7f',['$','$L72',null,{type:'starbonus',model:{bonus:{state:'complete',prevPointsEarned:60,prevPointsMax:2100,pointsMax:2100}}}]]];
test('modern streamed Rewards dashboard yields spendable balance and three incomplete daily activities',()=>{
 const s=parser.readFlight([flightScript(flightRecords)],flightOptions);
 assert.equal(s.balance,40590);assert.equal(s.diagnostics.recognized,true);
 assert.equal(s.coverage.daily,true);assert.equal(s.activities.filter(a=>a.category==='daily').length,3);
 assert.ok(s.activities.filter(a=>a.category==='daily').every(a=>a.total===10&&a.earned===0&&a.status==='incomplete'));
});
test('modern claimable points stay distinct from the balance and completed monthly bonus has no outstanding points',()=>{
 const s=parser.readFlight([flightScript(flightRecords)],flightOptions);
 assert.equal(s.balance,40590);const claim=s.activities.find(a=>a.id==='pointsclaim');
 assert.equal(claim.category,'claim');assert.equal(claim.total,109);assert.equal(claim.earned,0);assert.equal(claim.status,'incomplete');
 const bonus=s.activities.find(a=>a.id==='starbonus');assert.equal(bonus.status,'complete');assert.equal(bonus.earned,bonus.total);
 assert.equal(s.coverage.search,false);assert.equal(s.coverage.mobile,false);assert.equal(s.coverage.extra,false);
});

test('accumulated claimable credits remain separate from daily earning activities and extra promotions',()=>{
 const entries=[{category:'mtb',date:'2026-10',points:420},{category:'gub',date:'2026-10',points:60},{category:'ds',date:'2026-09',points:224},{category:'ds',date:'2026-10',points:248},{category:'bseb',date:'2026-10',points:210}];
 const records=[['1',{type:'pointsclaim',model:{pointClaim:{points:1162,entries}}}],['2',{type:'dailyset',model:{dailySetItems:dailyItems}}]];
 const s=parser.readFlight([flightScript(records)],flightOptions);
 const claim=s.activities.find(a=>a.id==='pointsclaim');
 assert.equal(claim.category,'claim');assert.equal(claim.total,1162);assert.equal(claim.earned,0);
 assert.equal(s.activities.filter(a=>a.category==='daily').reduce((sum,a)=>sum+a.total-a.earned,0),30);
 assert.equal(s.activities.filter(a=>a.category==='extra').length,0);
 const extra=parser.fromData({...fixture,morePromotions:[{offerId:'pointsclaim-bonus',title:'Daily bonus credit',points:10,complete:false}]},options);
 assert.equal(extra.activities.find(a=>a.id==='pointsclaim-bonus').category,'extra');
});
test('Flight records split across scripts decode inert JSON and never execute supplied JavaScript',()=>{
 const text='31:'+JSON.stringify(['$','$L56',null,{balance:40590,level:3}])+'\n';
 const s=parser.readFlight(['self.__next_f.push([1,'+JSON.stringify(text.slice(0,27))+']);','self.__next_f.push([1,'+JSON.stringify(text.slice(27))+']); globalThis.__rewardsExecuted=true;'],flightOptions);
 assert.equal(s.balance,40590);assert.equal(globalThis.__rewardsExecuted,undefined);
 assert.equal(parser.readFlight(['self.__next_f.push([1,malicious()]);'],flightOptions).diagnostics.recognized,false);
});
test('modern daily items from a different date do not become today activities',()=>{
 const records=[['31',['$','$L56',null,{balance:40590,level:3}]],['79',['$','$L72',null,{type:'dailyset',model:{dailySetItems:dailyItems.map(a=>({...a,date:'10/14/2026'}))}}]]];
 const s=parser.readFlight([flightScript(records)],flightOptions);assert.equal(s.activities.length,0);assert.equal(s.coverage.daily,false);
});
test('modern account identity is read only from the Microsoft profile flyout',()=>{
 const profile=['$','div',null,{className:'flex rounded-cornerFlyoutRest bg-flyout',children:[['$','p',null,{className:'pii truncate',children:'reader@example.com'}],['$','a',null,{instrument:{name:'HeaderProfileFlyout_Logout'}}]]}];
 const unrelated=['$','p',null,{className:'pii truncate',children:'other@example.com'}];
 const s=parser.readFlight([flightScript([...flightRecords,['ab',profile],['82',unrelated]])],flightOptions);
 assert.equal(s.account.email,'reader@example.com');
 assert.equal(parser.readFlight([flightScript([...flightRecords,['82',unrelated]])],flightOptions).account.email,null);
});
test('new-program membership marks a shared search allowance without inventing earned points',()=>{
 const records=[...flightRecords,['ac',{key:'SearchAndEarn',supportedLevels:{newLevel1:'15',newLevel2:'30',newLevel3:'60'}}]];
 const s=parser.readFlight([flightScript(records)],flightOptions);assert.equal(s.searchMode,'combined');assert.equal(s.coverage.search,false);assert.ok(!s.activities.some(a=>['search','desktop','mobile'].includes(a.category)));
});
