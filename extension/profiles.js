(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsProfiles=api;})(globalThis,()=>{
 'use strict';
 const presets=Object.freeze({
  reader1:Object.freeze({slot:1,alias:'Account 1',email:'',coordinator:false,autoRefresh:true}),
  reader2:Object.freeze({slot:2,alias:'Account 2',email:'',coordinator:false,autoRefresh:true}),
  reader3:Object.freeze({slot:3,alias:'Account 3',email:'',coordinator:false,autoRefresh:true}),
  panel:Object.freeze({slot:null,alias:'Pannello',email:'',coordinator:true,autoRefresh:false})
 });
 function apply(key,current={}){if(key==='custom')return {...current};if(!Object.hasOwn(presets,key))throw new Error('Scegli Lettore 1, Lettore 2, Lettore 3 oppure Pannello.');return {...current,...presets[key]};}
 function keyFor(config={}){
  const key=Object.keys(presets).find(k=>Object.entries(presets[k]).every(([field,value])=>(field==='email'?String(config[field]||'').trim().toLowerCase():config[field])===value));
  if(key)return key;
  if(config.slot===null&&!config.coordinator&&!config.email&&(!config.alias||config.alias==='Account'))return '';
  return 'custom';
 }
 return {presets,apply,keyFor};
});
