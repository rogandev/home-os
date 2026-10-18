import test from 'node:test';
import assert from 'node:assert/strict';
import {createElement,act} from 'react';
import {createServer} from 'vite';
import react from '@vitejs/plugin-react';
import {JSDOM} from 'jsdom';

test('container dialog validates, cancels, reconciles retry and confirms saved identity',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/',pretendToBeVisual:true});
  const originals=new Map();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true})){
    originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
  }
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
  const server=await createServer({configFile:false,plugins:[react()],server:{middlewareMode:true,watch:null,hmr:false},optimizeDeps:{noDiscovery:true,include:[]}});
  const {default:Creator}=await server.ssrLoadModule('/src/ContainerCreator.jsx');
  const {createRoot}=await import('react-dom/client');const root=createRoot(document.getElementById('root'));
  let fail=false, posts=0, refreshes=0;const rows=[];
  const request=async(path,o={})=>{assert.equal(path,'/containers');if(o.method==='POST'){posts++;if(fail)throw Error('offline');rows.push({...JSON.parse(o.body),isActive:true});}return structuredClone(rows);};
  const click=async text=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent===text);assert.ok(b,text);await act(async()=>b.click());};
  const change=async(selector,value)=>{const el=document.querySelector(selector);await act(async()=>{Object.getOwnPropertyDescriptor(el.tagName==='SELECT'?dom.window.HTMLSelectElement.prototype:dom.window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new dom.window.Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));});};
  try{
    await act(async()=>root.render(createElement(Creator,{request,locations:[{id:'bathroom',name:'Bathroom',isActive:true}],onCreated:async()=>{refreshes++;},onOpenChange:()=>{}})));
    await click('Create container');await click('Create empty container');assert.match(document.body.textContent,/Enter a container name/);assert.equal(posts,0);
    await change('input','Bathroom drawer');await click('Create empty container');assert.match(document.body.textContent,/Choose an active location/);
    await click('Cancel');assert.equal(document.querySelector('dialog'),null);assert.equal(posts,0);
    await click('Create container');await change('input','Bathroom drawer');await change('select','bathroom');fail=true;
    await click('Create empty container');assert.match(document.body.textContent,/Could not verify/);assert.equal(document.querySelector('input').disabled,true);
    assert.equal([...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel').disabled,true);
    fail=false;await click('Check and retry');assert.equal(rows.length,1);assert.equal(refreshes,1);assert.equal(document.querySelector('dialog'),null);assert.match(document.body.textContent,/Container created: Bathroom drawer · Bathroom. ID: container-/);
  } finally {
    await act(async()=>root.unmount());await server.close();dom.window.close();for(const [key,d]of originals){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}
  }
});
