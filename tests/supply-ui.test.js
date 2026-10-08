import test from "node:test";
import assert from "node:assert/strict";
import { createElement, act } from "react";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { JSDOM } from "jsdom";

async function fixture({enabled=true,lostResponse=false,active=true,tracked=true}={}) {
  const dom=new JSDOM('<!doctype html><div id="root"></div>',{url:"http://localhost/",pretendToBeVisual:true});
  const originals=new Map();
  for(const [name,value] of Object.entries({window:dom.window,document:dom.window.document,HTMLElement:dom.window.HTMLElement,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true})) {
    originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  }
  dom.window.scrollTo=()=>{};
  const item={id:1,name:"Deodorant",brand:"",quantity:2,category:"Personal Care",location:"Kitchen",status:"normal",reorder_at:1,replenishmentPolicy:"auto_replenish"};
  const allocation={itemId:1,containerId:"shelf",containerName:"Shelf",locationId:"kitchen",locationName:"Kitchen",quantity:2};
  const data={settings:{warningDays:7,version:1},profiles:tracked ? [{itemId:1,estimatedDaysPerUnit:30,warningDays:null,version:1}] : [],
    subscriptions:tracked ? [{itemId:1,status:"active",quantityPerDelivery:1,intervalCount:1,intervalUnit:"month",nextDeliveryDate:"2099-01-01",nextDeliveryOrderId:null,retailer:"Store",notes:"",version:1}] : [],
    usage:active ? [{id:"00000000-0000-4000-8000-000000000001",itemId:1,containerId:"shelf",openedOn:"2026-09-01",finishedOn:null}] : [],linkedOrders:[]};
  const writes=[],reads=[],requests=new Set();let dropped=false;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
    const path=new URL(url).pathname.replace(/^\/home-os/,""),method=options.method || "GET";
    const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
    if(method==="GET") {
      reads.push(path);
      if(path==="/items") return response([item]);
      if(path==="/stats") return response({total_items:1,total_units:item.quantity});
      if(path==="/locations") return response([{id:"kitchen",name:"Kitchen",isActive:true}]);
      if(path==="/containers") return response([{id:"shelf",name:"Shelf",locationName:"Kitchen",isActive:true}]);
      if(path==="/orders") return response([]);
      if(path==="/supply") return response(data);
      if(path.endsWith("/stock-allocations")) return response([allocation]);
    }
    const body=JSON.parse(options.body);writes.push({path,method,body});
    if(path.endsWith("/usage/open")) {
      if(!requests.has(body.requestId)) {
        const current=data.usage.find(u=>!u.finishedOn);
        assert.equal(body.expectedActiveUsageId,current?.id ?? null);
        if(current) {assert.equal(body.replaceActive,true);current.finishedOn=body.date;}
        item.quantity--;allocation.quantity--;
        data.usage.push({id:body.requestId,itemId:1,containerId:body.containerId,openedOn:body.date,finishedOn:null});requests.add(body.requestId);
      }
      if(lostResponse && !dropped) {dropped=true;throw new Error("Connection interrupted after saving");}
      return response({ok:true,replayed:false});
    }
    if(path.endsWith("/usage/finish")) {const u=data.usage.find(u=>u.id===body.usageId);u.finishedOn=body.date;return response({ok:true,replayed:false});}
    if(path==="/items/1/supply") {
      const current=data.profiles[0];
      if(body.expectedVersion !== (current?.version ?? 0)) return response({error:"Supply settings changed. Reload before saving."},409);
      data.profiles=[{...body,itemId:1,version:(current?.version ?? 0)+1}];return response(data.profiles[0]);
    }
    if(path==="/items/1/subscription") {
      const current=data.subscriptions[0];
      if(body.expectedVersion !== (current?.version ?? 0)) return response({error:"Subscription changed. Reload before saving."},409);
      data.subscriptions=[{...current,...body,itemId:1,version:(current?.version ?? 0)+1}];return response(data.subscriptions[0]);
    }
    if(path==="/supply/settings") {assert.equal(body.expectedVersion,data.settings.version);data.settings={warningDays:body.warningDays,version:data.settings.version+1};return response(data.settings);}
    throw new Error(`Unexpected ${method} ${path}`);
  };
  const server=await createServer({configFile:false,root:process.cwd(),plugins:[react()],server:{middlewareMode:true,watch:null,hmr:false,preTransformRequests:false},optimizeDeps:{noDiscovery:true,include:[]},define:{"import.meta.env.VITE_HOME_SUPPLY_TRACKING":JSON.stringify(String(enabled)),"import.meta.env.VITE_HOME_DELIVERY_TRACKING":JSON.stringify("false"),"import.meta.env.VITE_ROGAN_API_URL":JSON.stringify("http://localhost:3001")}});
  const {default:App}=await server.ssrLoadModule("/src/App.jsx");
  const {createRoot}=await import("react-dom/client");const root=createRoot(document.getElementById("root"));await act(async()=>{root.render(createElement(App));});
  const button=text=>[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===text);
  const click=async text=>{const b=typeof text==="string" ? button(text) : text;assert.ok(b,`Button ${text}`);await act(async()=>b.click());};
  return {dom,data,item,allocation,writes,reads,button,click,
    async refresh(){await act(async()=>{dom.window.dispatchEvent(new dom.window.Event("focus"));});},
    async submit(text){const b=button(text);assert.ok(b);await act(async()=>b.closest("form").dispatchEvent(new dom.window.Event("submit",{bubbles:true,cancelable:true})));},
    async close(){await act(async()=>root.unmount());await server.close();globalThis.fetch=originalFetch;for(const [n,d] of originals){if(d)Object.defineProperty(globalThis,n,d);else delete globalThis[n];}dom.window.close();},
  };
}

test("supply UI",async t=>{
  await t.test("flag off never reads new endpoints or changes legacy Use 1",async()=>{
    const f=await fixture({enabled:false});try{assert.equal(f.reads.includes("/supply"),false);assert.ok(f.button("Use 1"));assert.equal(f.button("Plan supply"),undefined);assert.deepEqual(f.writes,[]);}finally{await f.close();}
  });
  await t.test("untracked item asks for explicit estimate without inventing a rate",async()=>{
    const f=await fixture({tracked:false,active:false});try{assert.ok(f.button("Use 1"));await f.click("Plan supply");assert.equal(document.querySelector('[aria-label="Estimated days per container"]').value,"");assert.deepEqual(f.writes,[]);}finally{await f.close();}
  });
  await t.test("No preserves active unit; Yes replaces atomically; Finish does not subtract twice",async()=>{
    const f=await fixture();try{
      assert.equal(f.button("Use 1"),undefined);await f.click("Opened a new one");assert.match(document.body.textContent,/Does this replace/);assert.deepEqual(f.writes,[]);
      await f.click("No, keep current container");assert.equal(f.item.quantity,2);assert.equal(f.data.usage[0].finishedOn,null);
      await f.click("Opened a new one");await f.click("Yes, replace and open");assert.equal(f.item.quantity,1);assert.equal(f.writes.length,1);assert.equal(f.writes[0].body.replaceActive,true);assert.equal(document.querySelector('[role="dialog"]'),null);
      await f.click("Finished one");assert.equal(f.writes.length,1);await f.click("Confirm finished");assert.equal(f.item.quantity,1);assert.equal(f.data.usage.filter(u=>!u.finishedOn).length,0);
    }finally{await f.close();}
  });
  await t.test("lost response retries the identical operation without consuming another spare",async()=>{
    const f=await fixture({lostResponse:true});try{
      await f.click("Opened a new one");await f.click("Yes, replace and open");assert.match(document.querySelector('[role="alert"]').textContent,/Connection interrupted/);assert.equal(f.item.quantity,1);
      await f.click("Retry same action");assert.equal(f.item.quantity,1);assert.deepEqual(f.writes[0],f.writes[1]);assert.equal(document.querySelector('[role="dialog"]'),null);
    }finally{await f.close();}
  });
  await t.test("profile saves can be repeated; a draft opened before another device edits keeps its original version",async()=>{
    const f=await fixture();try{
      await f.click("Plan supply");await f.submit("Save supply settings");await f.submit("Save supply settings");assert.equal(f.data.profiles[0].version,3);
      await f.click(document.querySelector('[aria-label="Close Supply · Deodorant"]'));await f.click("Plan supply");f.data.profiles[0].version=4;await f.refresh();await f.submit("Save supply settings");
      assert.equal(f.writes.at(-1).body.expectedVersion,3);assert.match(document.querySelector('[role="alert"]').textContent,/changed/);assert.equal(f.data.profiles[0].version,4);
    }finally{await f.close();}
  });
  await t.test("pause, resume and cancel are tracking-only; global default and per-item zero remain distinct",async()=>{
    const f=await fixture();try{
      await f.click("Plan supply");await f.click("Pause tracking");assert.equal(f.data.subscriptions[0].status,"paused");await f.click("Resume tracking");await f.click("Cancel tracking");assert.equal(f.data.subscriptions[0].status,"cancelled");assert.equal(f.item.quantity,2);assert.ok(f.writes.every(w=>w.path==="/items/1/subscription"));
      await f.click(document.querySelector('[aria-label="Close Supply · Deodorant"]'));await f.click("Supply settings");await f.submit("Save default");assert.equal(f.data.settings.warningDays,7);assert.equal(f.data.profiles[0].warningDays,null);
    }finally{await f.close();}
  });
});
