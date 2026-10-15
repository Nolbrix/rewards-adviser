(function(root,factory){const entries=typeof module==='object'&&module.exports?require('./strings.js'):root.RewardsStrings;const api=factory(entries);if(typeof module==='object'&&module.exports)module.exports=api;else root.RewardsI18n=api;})(globalThis,entries=>{
 'use strict';
 const escape=value=>value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const keys=Object.keys(entries).sort((a,b)=>b.length-a.length),pattern=new RegExp(keys.map(escape).join('|'),'g');
 function create(language,getMessage){
  const tag=String(language||'en').replace('_','-'),resolved=tag.toLowerCase().startsWith('it')?'it':'en';
  let locale=resolved==='it'?'it-IT':'en-US';try{if(/^(it|en)(-|$)/i.test(tag))locale=Intl.getCanonicalLocales(tag)[0];}catch{}
  function translate(text){if(resolved==='it')return String(text);return String(text).replace(pattern,source=>{const entry=entries[source];return getMessage?.(entry.id)||entry.en;});}
  function t(strings,...values){if(typeof strings==='string')return translate(strings);return strings.reduce((out,part,i)=>out+translate(part)+(i<values.length?String(values[i]):''),'');}
  function localizeDocument(doc){
   doc.documentElement.lang=resolved;
   const walk=doc.createTreeWalker(doc.body,4);let node;
   while((node=walk.nextNode()))if(!['SCRIPT','STYLE','NOSCRIPT'].includes(node.parentElement?.tagName))node.nodeValue=translate(node.nodeValue);
   for(const element of doc.querySelectorAll('[title],[placeholder],[aria-label]'))for(const attr of ['title','placeholder','aria-label'])if(element.hasAttribute(attr))element.setAttribute(attr,translate(element.getAttribute(attr)));
  }
  return {language:resolved,locale,t,localizeDocument};
 }
 const chromeApi=globalThis.chrome?.i18n,instance=create(chromeApi?.getUILanguage?.()||globalThis.navigator?.language||'en',chromeApi?.getMessage?.bind(chromeApi));
 return {create,...instance};
});
