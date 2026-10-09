import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {JSDOM} from 'jsdom';

async function fixture({manage=true,empty=false,lost=false,zero=false}={}){
 const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:'http://localhost/'}),old=new Map();
 for(const [k,v] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){old.set(k,Object.getOwnPropertyDescriptor(globalThis,k));Object.defineProperty(globalThis,k,{configurable:true,writable:true,value:v});}
 const data={razors:empty?[]:[{id:'razor-a',name:'Venus body',itemId:1,intervalDays:7,reminderDays:null,version:1,ageDays:null,dueOn:null,remind:false}],history:[],corrections:[],items:[{id:1,name:'Venus blades'}],sources:zero?[]:[{itemId:1,containerId:'shelf',containerName:'Shelf',locationName:'Bathroom',quantity:2}]};
 const writes=[],keys=new Set();let dropped=false;
 const request=async(path,options={})=>{
  if(!options.method)return structuredClone(data);
  const body=JSON.parse(options.body);writes.push({path,...body});
  if(options.method==='PUT'){data.razors=[{...body,id:path.split('/').at(-1),version:1,ageDays:null,dueOn:null,remind:false}];return data.razors[0];}
  if(!keys.has(body.requestId)){keys.add(body.requestId);data.sources[0].quantity--;data.history.push({id:body.requestId,razorId:'razor-a',changedOn:body.changedOn,itemName:'Venus blades',containerName:'Shelf'});data.razors[0].version++;}
  if(lost&&!dropped){dropped=true;throw new Error('Response lost after saving');}return {ok:true};
 };
 const server=await createServer({configFile:false,root:process.cwd(),plugins:[react()],server:{middlewareMode:true,watch:null,hmr:false,preTransformRequests:false},optimizeDeps:{noDiscovery:true,include:[]}});
 const {default:Panel}=await server.ssrLoadModule('/src/RazorPanel.jsx');const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
 await act(async()=>root.render(createElement(Panel,{request,manage})));
 const button=text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text);
 const click=async text=>{assert.ok(button(text),text);await act(async()=>button(text).click());};
 const change=async(element,value)=>{await act(async()=>{const proto=element.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(element,value);element.dispatchEvent(new dom.window.Event(element.tagName==='SELECT'?'change':'input',{bubbles:true}));});};
 return {data,writes,button,click,change,dom,async submit(){await act(async()=>document.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true})));},async close(){await act(async()=>root.unmount());await server.close();for(const[k,v]of old){if(v)Object.defineProperty(globalThis,k,v);else delete globalThis[k];}dom.window.close();}};
}
test('razor UI',async t=>{
 await t.test('unknown history stays unknown and stock source is never selected automatically; lost response retries once',async()=>{
  const f=await fixture({lost:true});try{
   assert.match(document.body.textContent,/Last change unknown/);assert.match(document.body.textContent,/Reminders off/);
   await f.click('Change Blade');assert.equal(document.querySelector('select').value,'');assert.equal(f.button('Confirm replacement').disabled,true);assert.equal(f.writes.length,0);
   await f.change(document.querySelector('select'),'shelf');await f.submit();assert.match(document.body.textContent,/Response lost/);assert.ok(document.querySelector('fieldset').disabled);
   await f.submit();assert.equal(f.writes.length,2);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(f.data.sources[0].quantity,1);assert.equal(document.querySelector('form'),null);
  }finally{await f.close();}
 });
 await t.test('zero stock blocks recording and FORM surface does not configure inventory',async()=>{
  const f=await fixture({manage:false,zero:true});try{assert.equal(f.button('Configure'),undefined);assert.equal(f.button('Add razor'),undefined);await f.click('Change Blade');assert.match(document.body.textContent,/No blades available/);assert.ok(f.button('Confirm replacement').disabled);assert.equal(f.writes.length,0);}finally{await f.close();}
 });
 await t.test('new razor has blank inventory/cadence/reminder and creates no historical replacement',async()=>{
  const f=await fixture({empty:true});try{await f.click('Add razor');assert.equal(document.querySelector('select').value,'');assert.ok([...document.querySelectorAll('input[type=number]')].every(x=>x.value===''));assert.equal(f.writes.length,0);await f.click('Cancel');assert.equal(f.data.history.length,0);}finally{await f.close();}
 });
});
