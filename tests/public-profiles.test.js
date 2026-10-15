const {test}=require('node:test');const assert=require('node:assert/strict');
const profiles=require('../extension/profiles.js');
test('each public reader starts empty and retains the chosen browser and local connection',()=>{
 for(const slot of [1,2,3]){const c=profiles.apply('reader'+slot,{token:'keep',clientId:'existing',email:'old@example.com',browser:'Brave',coordinator:true});
 assert.equal(c.slot,slot);assert.equal(c.email,'');assert.equal(c.alias,'Account '+slot);assert.equal(c.browser,'Brave');assert.equal(c.token,'keep');assert.equal(c.clientId,'existing');assert.equal(c.coordinator,false);assert.equal(c.autoRefresh,true);}
});
test('the panel can run in any browser without retaining a reader identity',()=>{
 const c=profiles.apply('panel',{slot:2,email:'old@example.com',browser:'Chrome',token:'keep'});
 assert.equal(c.slot,null);assert.equal(c.email,'');assert.equal(c.browser,'Chrome');assert.equal(c.coordinator,true);assert.equal(c.autoRefresh,false);
});
test('saved user accounts stay custom and unsupported reader slots are rejected',()=>{
 const saved={slot:2,browser:'Edge',email:'friend@example.com',alias:'Work'};
 assert.deepEqual(profiles.apply('custom',saved),saved);assert.equal(profiles.keyFor(saved),'custom');
 assert.throws(()=>profiles.apply('reader4',{}));assert.throws(()=>profiles.apply('personal-preset',{}));
});
