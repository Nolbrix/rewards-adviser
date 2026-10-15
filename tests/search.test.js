const {test}=require('node:test'),assert=require('node:assert/strict');
let search={};try{search=require('../extension/search.js');}catch{}
const source=(mode='PcCombined')=>({IsAuthenticated:true,IsError:false,UserId:'fake-bing-account',FlyoutResult:{UserStatus:{AvailablePoints:40590,Counters:{PCSearch:[{OfferId:'pc',PointProgress:21,PointProgressMax:60}],MobileSearch:[{OfferId:'mobile',PointProgress:3,PointProgressMax:60}]}},Layout:{Controls:{body:[{CustomProperties:{Counter:mode}}]}}}});
test('anonymous Bing placeholders cannot become zero progress for an account',()=>{
 assert.equal(typeof search.fromData,'function');const result=search.fromData({...source(),IsAuthenticated:false});assert.equal(result.status,'not-signed-in');assert.deepEqual(result.activities,[]);
});
test('a browser MUID cannot stand in for an authenticated Rewards account identity',()=>{
 const result=search.fromData({...source(),UserId:'muid:0123456789abcdef0123456789abcdef'});assert.equal(result.status,'identity-unverified');assert.deepEqual(result.activities,[]);
});
test('combined Bing search follows the official PCSearch sum and never duplicates MobileSearch',()=>{
 const data=source();data.FlyoutResult.UserStatus.Counters.PCSearch.push({OfferId:'edgeplusbing',PointProgress:3,PointProgressMax:6});
 const r=search.fromData(data);assert.equal(r.status,'ok');assert.equal(r.mode,'combined');assert.equal(r.subject,'fake-bing-account');
 assert.deepEqual(r.activities.map(a=>[a.category,a.earned,a.total,a.status]),[['search',24,66,'incomplete']]);assert.equal(r.coverage.search,true);assert.equal(r.coverage.mobile,false);
});
test('separate Bing counters exclude Edge bonuses and preserve the individual account limits',()=>{
 const data=source('PcSearch');data.FlyoutResult.Layout.Controls.body.push({CustomProperties:{Counter:'MobileSearch'}});data.FlyoutResult.UserStatus.Counters.PCSearch.unshift({OfferId:'test_edgeplusbing',PointProgress:0,PointProgressMax:12});
 const r=search.fromData(data);assert.equal(r.mode,'separate');assert.deepEqual(r.activities.map(a=>[a.category,a.earned,a.total]),[['desktop',21,60],['mobile',3,60]]);
});
test('missing, negative and oversized progress never imply a completed search allowance',()=>{
 for(const progress of [null,-1,61,'21']){const data=source();data.FlyoutResult.UserStatus.Counters.PCSearch[0].PointProgress=progress;const r=search.fromData(data);assert.equal(r.status,'unavailable');assert.deepEqual(r.activities,[]);}
 const data=source();delete data.FlyoutResult.UserStatus.Counters.PCSearch;assert.deepEqual(search.fromData(data).activities,[]);
});
test('first linking verifies the Bing email and later captures stay pinned to the same subject and email',()=>{
 const primary={account:{email:'alice@example.com'},balance:40590},reading={subject:'hashed-subject',balance:40590,email:'alice@example.com'};
 assert.equal(search.identityStatus(primary,reading,null),'initial-match');
 assert.equal(search.identityStatus(primary,{...reading,email:null},null),'identity-unverified');
 assert.equal(search.identityStatus(primary,{...reading,email:'bob@example.com'},null),'account-mismatch');
 const binding={email:'alice@example.com',subject:'hashed-subject'};
 assert.equal(search.identityStatus(primary,{...reading,balance:40600},binding),'linked');
 assert.equal(search.identityStatus(primary,{...reading,subject:'other-user'},binding),'account-mismatch');
 assert.equal(search.identityStatus({account:{email:'bob@example.com'}},reading,binding),'account-mismatch');
});
test('Bing home identity comes from the inert official header model, not arbitrary email text',()=>{
 const html='<p>wrong@example.com</p><script>var _model = '+JSON.stringify({UserEmail:'Alice@Example.com',UserType:'Msa'})+';</script>';
 assert.equal(search.emailFromHome(html),'alice@example.com');
 assert.equal(search.emailFromHome('<script>var _model={UserEmail:evil()};</script>'),null);
 assert.equal(search.emailFromHome('<p>wrong@example.com</p>'),null);
});
test('fresh search data augments the dashboard without changing its account, balance or daily tasks',()=>{
 const now=Date.parse('2026-10-15T10:00:00Z'),primary={date:'2026-10-15',observedAt:now-20000,account:{email:'alice@example.com'},balance:40590,coverage:{daily:true},activities:[{id:'daily',category:'daily',total:10,earned:0,status:'incomplete'}]};
 const reading={...search.fromData(source()),date:'2026-10-15',observedAt:now-50000};
 const merged=search.merge(primary,reading,now);assert.equal(merged.balance,40590);assert.equal(merged.account.email,'alice@example.com');assert.equal(merged.observedAt,now-50000);assert.equal(merged.activities.length,2);assert.equal(merged.searchMode,'combined');assert.equal(merged.diagnostics.searchStatus,'ok');
 assert.equal(search.merge(primary,{...reading,date:'2026-10-14'},now).activities.length,1);
 assert.equal(search.merge(primary,{...reading,observedAt:now-180000},now).activities.length,1);
});

test('a newer verified Bing balance replaces an older dashboard balance without altering daily activities',()=>{
 const now=Date.parse('2026-10-15T10:00:00Z');
 const primary={date:'2026-10-15',observedAt:now-60000,account:{email:'alice@example.com'},balance:40590,coverage:{daily:true},activities:[{id:'daily',category:'daily',total:10,earned:0,status:'incomplete'}]};
 const data=source();data.FlyoutResult.UserStatus.AvailablePoints=40605;
 const reading={...search.fromData(data),date:'2026-10-15',observedAt:now};
 const merged=search.merge(primary,reading,now);
 assert.equal(merged.balance,40605);assert.equal(merged.account,primary.account);assert.deepEqual(merged.activities[0],primary.activities[0]);
 // An older cached balance cannot undo a more recent dashboard observation.
 assert.equal(search.merge({...primary,observedAt:now,balance:40610},{...reading,observedAt:now-10000},now).balance,40610);
 for(const balance of [null,-1,'40605',NaN])assert.equal(search.merge(primary,{...reading,balance},now).balance,40590);
 assert.equal(search.merge(primary,{...reading,date:'2026-10-14'},now).balance,40590);
 assert.equal(search.merge(primary,{...reading,status:'account-mismatch'},now).balance,40590);
});
