import React from "react";
import { createRoot } from "react-dom/client";
import { localDate } from "../src/delivery.js";

const today=localDate();
const dateAfter=days=>new Date(Date.parse(`${today}T12:00:00Z`)+days*86400000).toISOString().slice(0,10);
const items=[
  {id:1,name:"Deodorant",quantity:1},
  {id:2,name:"Shampoo",quantity:2},
  {id:3,name:"Face cleanser",quantity:1},
].map(item=>({...item,brand:"Home OS review fixture",category:"Personal Care",location:"Kitchen",status:"normal",reorder_at:1,replenishmentPolicy:"auto_replenish"}));
const allocations=items.map(item=>({itemId:item.id,containerId:"shelf",containerName:"Supply shelf",locationId:"kitchen",locationName:"Kitchen",quantity:item.quantity}));
const data={settings:{warningDays:7,version:1},profiles:items.map(i=>({itemId:i.id,estimatedDaysPerUnit:i.id===3 ? null : 30,warningDays:null,version:1})),subscriptions:items.filter(i=>i.id!==3).map(i=>({itemId:i.id,status:"active",quantityPerDelivery:i.id===2 ? 2 : 1,intervalCount:1,intervalUnit:"month",nextDeliveryDate:dateAfter(i.id===1 ? 45 : 7),retailer:"Example store",notes:"Advisory only",nextDeliveryOrderId:null,version:1})),usage:items.filter(i=>i.id!==3).map(i=>({id:`00000000-0000-4000-8000-00000000000${i.id}`,itemId:i.id,containerId:"shelf",openedOn:dateAfter(-22),finishedOn:null})),linkedOrders:[]};
const seen=new Set();const actions=[];
window.__supplyFixture={data,items,actions};
window.fetch=async(url,options={})=>{
  const path=new URL(url,location.href).pathname.replace(/^\/home-os/,""),method=options.method || "GET";
  const response=(body,status=200)=>Promise.resolve(new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}}));
  if(method==="GET") {
    if(path==="/items")return response(items);
    if(path==="/stats")return response({total_items:items.length,total_units:items.reduce((n,i)=>n+i.quantity,0),need_to_order:0,awaiting_shipment:0});
    if(path==="/locations")return response([{id:"kitchen",name:"Kitchen",isActive:true}]);
    if(path==="/containers")return response([{id:"shelf",name:"Supply shelf",locationId:"kitchen",locationName:"Kitchen",isActive:true}]);
    if(path==="/orders")return response([]);
    if(path==="/supply")return response(data);
    if(path.endsWith("/stock-allocations"))return response(allocations.filter(a=>a.itemId===Number(path.split("/")[2])));
  }
  const body=JSON.parse(options.body || "{}");actions.push({path,method,body});
  if(path==="/supply/settings") {if(body.expectedVersion!==data.settings.version)return response({error:"Reload changed settings"},409);data.settings={warningDays:body.warningDays,version:data.settings.version+1};return response(data.settings);}
  const id=Number(path.split("/")[2]),item=items.find(i=>i.id===id);
  if(!item)return response({error:"Fixture route not supported"},404);
  for(const [suffix,key] of [["/supply","profiles"],["/subscription","subscriptions"]]) {
    if(path.endsWith(suffix)) {const old=data[key].find(p=>p.itemId===id);if(body.expectedVersion!==(old?.version ?? 0))return response({error:"Settings changed. Reload."},409);
      const saved={...old,...body,itemId:id,version:(old?.version ?? 0)+1};data[key]=data[key].filter(p=>p.itemId!==id).concat(saved);return response(saved);}
  }
  if(path.includes("/usage/")) {
    if(seen.has(body.requestId))return response({ok:true,replayed:true});
    const active=data.usage.find(u=>u.itemId===id && !u.finishedOn);
    if(path.endsWith("/open")) {
      if((active?.id ?? null)!==body.expectedActiveUsageId || (active && body.replaceActive!==true))return response({error:"Confirm replacement of the current container"},409);
      if(item.quantity<1)return response({error:"No spare available"},409);
      if(active)active.finishedOn=body.date;item.quantity--;allocations.find(a=>a.itemId===id).quantity--;
      data.usage.push({id:body.requestId,itemId:id,containerId:body.containerId,openedOn:body.date,finishedOn:null});
    }else {if(!active || active.id!==body.usageId)return response({error:"Usage changed"},409);active.finishedOn=body.date;}
    seen.add(body.requestId);return response({ok:true,replayed:false});
  }
  return response({error:"Fixture route not supported"},400);
};
const {default:App}=await import("../src/App.jsx");
createRoot(document.getElementById("root")).render(<><div style={{padding:10,background:"#373054",color:"white",fontFamily:"system-ui"}}>Local review fixture · synthetic inventory only · reload resets data</div><App /></>);
