import React from 'react';
import {createRoot} from 'react-dom/client';
import RazorPanel from '../../src/RazorPanel.jsx';
const today=new Date().toISOString().slice(0,10),ago=n=>new Date(Date.parse(today)-n*86400000).toISOString().slice(0,10);
const data={razors:[
 {id:'venus-body',name:'Venus · body',itemId:1,intervalDays:14,reminderDays:2,version:1,ageDays:16,dueOn:ago(2),status:'overdue',remind:true},
 {id:'venus-face',name:'Venus · face',itemId:1,intervalDays:null,reminderDays:null,version:1,ageDays:null,dueOn:null,status:'unknown',remind:false},
 {id:'mach3',name:'Mach 3',itemId:2,intervalDays:10,reminderDays:null,version:1,ageDays:3,dueOn:ago(-7),status:'current',remind:false}],
 items:[{id:1,name:'Venus replacement blades'},{id:2,name:'Mach 3 replacement blades'}],
 sources:[{itemId:1,containerId:'drawer',containerName:'Drawer',locationName:'Bathroom',quantity:2},{itemId:1,containerId:'closet',containerName:'Blade box',locationName:'Closet',quantity:3}],
 history:[{id:'last-body',razorId:'venus-body',changedOn:ago(16),itemName:'Venus replacement blades',containerName:'Drawer'},{id:'last-mach3',razorId:'mach3',changedOn:ago(3),itemName:'Mach 3 replacement blades',containerName:'Drawer'}],corrections:[]};
const requests=new Set(),writes=[];
const scenario=new URLSearchParams(location.search).get('fault');
let faultUsed=false,refreshFaultPending=false;
// Synthetic fixture observability only. Never imported by the production app.
window.__razorFixture={snapshot:()=>structuredClone(data),writes};
async function request(path,options={}){
 if(!options.method){
  if(refreshFaultPending){refreshFaultPending=false;throw Error('Fixture refresh failed after save. Reload and review history.');}
  return structuredClone(data);
 }
 writes.push({path,method:options.method,body:JSON.parse(options.body)});
 await new Promise(resolve=>setTimeout(resolve,120));
 if(scenario==='before'&&!faultUsed){faultUsed=true;throw Error('Fixture request rejected before saving.');}
 const body=JSON.parse(options.body),id=path.split('/')[2],razor=data.razors.find(r=>r.id===id);
 if(options.method==='PUT'){
  const saved={...body,id,version:(razor?.version??0)+1,ageDays:razor?.ageDays??null,dueOn:razor?.dueOn??null,remind:false};
  if(razor)Object.assign(razor,saved);else data.razors.push(saved);return saved;
 }
 if(requests.has(body.requestId))return {ok:true,replayed:true};
 if(razor.version!==body.expectedVersion)throw Error('Fixture version changed. Reload.');
 if(path.endsWith('/changes')){
  const source=data.sources.find(s=>s.itemId===body.itemId&&s.containerId===body.containerId&&s.quantity>0);
  if(!source)throw Error('No blade in that storage container.');source.quantity--;
  data.history.unshift({id:body.requestId,razorId:id,changedOn:body.changedOn,itemName:data.items.find(i=>i.id===body.itemId).name,containerName:source.containerName});
  razor.ageDays=Math.round((Date.parse(today)-Date.parse(body.changedOn))/86400000);razor.dueOn=razor.intervalDays?new Date(Date.parse(body.changedOn)+razor.intervalDays*86400000).toISOString().slice(0,10):null;razor.remind=false;razor.status='current';
 }else{
  const entry=data.history.find(h=>h.id===body.changeId);data.corrections.push({changeId:entry.id,previousDate:entry.changedOn,correctedDate:body.changedOn,reason:body.reason});entry.changedOn=body.changedOn;
 }
 razor.version++;requests.add(body.requestId);
 if(scenario==='after'&&!faultUsed){faultUsed=true;throw Error('Fixture response lost after saving.');}
 if(scenario==='refresh'&&!faultUsed){faultUsed=true;refreshFaultPending=true;}
 return {ok:true};
}
const manage=new URLSearchParams(location.search).get('view')!=='form';
createRoot(document.getElementById('root')).render(<main style={{maxWidth:680,margin:'auto',padding:16}}><h2>{manage?'Home OS':'FORM Care'} preview</h2><p>Synthetic fixture only · no production requests. <a style={{color:'#bebeff'}} href={manage?'?view=form':'?view=home'}>Switch app view</a></p><RazorPanel request={request} manage={manage}/></main>);
