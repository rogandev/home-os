import test from "node:test";
import assert from "node:assert/strict";
import { durationEstimate, supplyForecast, nextCadenceDate } from "../src/supply.js";

const input = overrides => ({today:"2026-10-06",item:{quantity:1,replenishmentPolicy:"auto_replenish"},profile:{estimatedDaysPerUnit:30,warningDays:null},
  usage:[{id:"open",openedOn:"2026-09-16",finishedOn:null}],warningDays:7,
  subscription:{status:"active",quantityPerDelivery:1,intervalCount:1,intervalUnit:"month",nextDeliveryDate:"2026-11-08"},...overrides});

test("explicit estimate starts forecast; observed complete containers refine it",()=>{
  assert.equal(durationEstimate(null,[]).days,null);
  const usage=[{openedOn:"2026-01-01",finishedOn:"2026-01-21"}];
  assert.deepEqual(durationEstimate({estimatedDaysPerUnit:30},usage),{days:25,source:"refining",samples:1});
  assert.equal(durationEstimate(null,usage).days,null);
  usage.push({openedOn:"2026-02-01",finishedOn:"2026-02-21"},{openedOn:"2026-03-01",finishedOn:"2026-03-31"});
  assert.deepEqual(durationEstimate({estimatedDaysPerUnit:90},usage),{days:20,source:"observed",samples:3});
  assert.equal(durationEstimate({estimatedDaysPerUnit:30},[{openedOn:"2026-01-01",finishedOn:"2026-01-01"}]).days,30);
});
test("active remaining duration plus spare stock; buffer equality does not warn at delivery",()=>{
  const f=supplyForecast(input());
  assert.equal(f.coverage,40);assert.equal(f.beforeDays,7);assert.equal(f.mayRunOut,false);
  assert.equal(f.physicalRunOutDate,"2026-11-15");assert.equal(f.warningDate,"2026-11-08");
  assert.equal(f.afterSpares,1);assert.equal(f.label,"On track");
  const next=supplyForecast(input({subscription:{...input().subscription,nextDeliveryDate:"2026-11-09"}}));
  assert.equal(next.mayRunOut,true);assert.equal(next.label,"May run out first");
});
test("deodorant arriving after run-out warns and never invents a stock debt",()=>{
  const f=supplyForecast(input({item:{quantity:0},subscription:{...input().subscription,nextDeliveryDate:"2026-10-20"}}));
  assert.equal(f.physicalRunOutDate,"2026-10-16");assert.equal(f.before,0);assert.equal(f.after,1);assert.equal(f.mayRunOut,true);
});
test("more than one spare gives advisory; exactly one spare does not",()=>{
  assert.equal(supplyForecast(input()).likelyOverstock,false);
  const f=supplyForecast(input({subscription:{...input().subscription,quantityPerDelivery:2}}));
  assert.equal(f.afterSpares,2);assert.equal(f.likelyOverstock,true);
  const empty=supplyForecast(input({item:{quantity:0},usage:[],subscription:{...input().subscription,nextDeliveryDate:"2026-10-06",quantityPerDelivery:2}}));
  assert.equal(empty.afterSpares,1);assert.equal(empty.likelyOverstock,false);
});
test("per-item warning override including zero; paused/cancelled/Do Not Order suppress active subscription advice",()=>{
  assert.equal(supplyForecast(input({profile:{estimatedDaysPerUnit:30,warningDays:8}})).mayRunOut,true);
  assert.equal(supplyForecast(input({profile:{estimatedDaysPerUnit:30,warningDays:0}})).mayRunOut,false);
  for(const status of ["paused","cancelled"]) assert.equal(supplyForecast(input({subscription:{...input().subscription,status}})).label,undefined);
  assert.equal(supplyForecast(input({item:{quantity:1,replenishmentPolicy:"do_not_order"}})).label,undefined);
});
test("scheduled supply is separate from incoming; unlinked order requires reconciliation",()=>{
  const f=supplyForecast(input());assert.equal(f.incoming,0);assert.equal(f.effectiveStock,1);
  const unlinked=supplyForecast(input({order:{id:10,remainingQuantity:2,expectedDeliveryDate:"2026-10-10"}}));
  assert.equal(unlinked.incoming,2);assert.equal(unlinked.effectiveStock,3);assert.equal(unlinked.after,null);assert.match(unlinked.reason,/Link it/);
});
test("linked partial order contributes remaining units once; closed receipt never restores scheduled supply",()=>{
  const order={id:10,status:"open",remainingQuantity:1,expectedDeliveryDate:"2026-11-08"};
  const sub={...input().subscription,quantityPerDelivery:3,nextDeliveryOrderId:10};
  const f=supplyForecast(input({subscription:sub,order,linkedOrder:order}));
  assert.equal(f.after,1+7/30);assert.equal(f.likelyOverstock,false);
  const received=supplyForecast(input({subscription:sub,linkedOrder:{...order,status:"received"}}));
  assert.equal(received.after,null);assert.match(received.reason,/closed/);
});
test("unknown or overdue arrivals do not cover a run-out",()=>{
  for(const expectedDeliveryDate of [null,"2026-10-01"]) {
    const order={id:10,status:"open",remainingQuantity:5,expectedDeliveryDate};
    const f=supplyForecast(input({order,linkedOrder:order,subscription:{...input().subscription,nextDeliveryOrderId:10}}));
    assert.equal(f.runOutDate,f.physicalRunOutDate);assert.equal(f.after,null);assert.match(f.reason,/Past or unknown/);
  }
});
test("cadence comparisons use calendar months, and a depleted active container never disappears",()=>{
  assert.equal(nextCadenceDate("2026-01-31",1,"month"),"2026-02-28");
  assert.equal(nextCadenceDate("2028-01-31",1,"month"),"2028-02-29");
  const f=supplyForecast(input({usage:[{id:"still-open",openedOn:"2026-01-01",finishedOn:null}]}));
  assert.equal(f.active.id,"still-open");assert.equal(f.overdueActive,true);assert.equal(f.coverage,30);
  assert.equal(supplyForecast(input({subscription:{...input().subscription,intervalCount:3}})).cadenceShortfall,true);
});

test("zero-day warning still reports a delivery that leaves no spare",()=>{
  const f=supplyForecast(input({item:{quantity:0},usage:[],profile:{estimatedDaysPerUnit:30,warningDays:0},subscription:{...input().subscription,nextDeliveryDate:"2026-10-06",quantityPerDelivery:1}}));
  assert.equal(f.mayRunOut,false);assert.equal(f.belowSpareTarget,true);assert.equal(f.label,"May run out first");
});
