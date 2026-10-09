const DAY = 86400000;
const day = value => Date.parse(`${value}T00:00:00Z`) / DAY;
const after = (date, days) => new Date((day(date) + days) * DAY).toISOString().slice(0,10);
const median = values => {
  const sorted = [...values].sort((a,b) => a-b), mid = Math.floor(sorted.length/2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1]+sorted[mid])/2;
};

export function durationEstimate(profile, usage) {
  const observed = usage.filter(u => u.finishedOn).map(u => day(u.finishedOn)-day(u.openedOn))
    .filter(n => Number.isFinite(n) && n >= 1 && n <= 3650).slice(-6);
  const estimate = profile?.estimatedDaysPerUnit;
  if (observed.length >= 3) return { days:median(observed),source:"observed",samples:observed.length };
  if (!(estimate > 0)) return { days:null,source:"estimate_needed",samples:observed.length };
  return { days:(estimate+observed.reduce((a,b) => a+b,0))/(observed.length+1),
    source:observed.length ? "refining" : "estimate",samples:observed.length };
}

export function nextCadenceDate(date, count, unit) {
  if (unit !== "month") return after(date,count*(unit === "week" ? 7 : 1));
  const [year,month,dom] = date.split("-").map(Number);
  const target = new Date(Date.UTC(year,month-1+count,1));
  const last = new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(dom,last));
  return target.toISOString().slice(0,10);
}

export function supplyForecast({ item,profile,usage=[],subscription,order,linkedOrder,warningDays=7,today }) {
  const rate = durationEstimate(profile,usage);
  const active = usage.find(u => !u.finishedOn);
  const buffer = profile?.warningDays ?? warningDays;
  const base = { ...rate,active,buffer,spares:item.quantity,incoming:order?.remainingQuantity ?? 0,
    effectiveStock:item.quantity+(order?.remainingQuantity ?? 0),targetSpares:1 };
  if (!rate.days) return { ...base,reason:"Enter how many days one container usually lasts to start forecasting." };
  const activeDays = active ? Math.max(0,rate.days-Math.max(0,day(today)-day(active.openedOn))) : 0;
  const coverage = item.quantity*rate.days+activeDays;
  const physicalRunOutDate = after(today,Math.ceil(coverage));
  const result = { ...base,coverage,physicalRunOutDate,runOutDate:physicalRunOutDate,
    warningDate:after(physicalRunOutDate,-buffer),runOutWarning:coverage <= buffer,
    overdueActive:Boolean(active && activeDays === 0),before:null,after:null };
  // Actual orders remain separate; unknown/overdue arrivals cannot be treated as available stock.
  const actualKnown = order?.expectedDeliveryDate && order.expectedDeliveryDate >= today;
  if (actualKnown && day(order.expectedDeliveryDate)-day(today) <= coverage) {
    result.runOutDate = after(today,Math.ceil(coverage+order.remainingQuantity*rate.days));
  }
  if (!subscription || subscription.status !== "active" || item.replenishmentPolicy === "do_not_order") return result;
  if (subscription.nextDeliveryOrderId && linkedOrder?.status !== "open")
    return { ...result,reason:"The linked delivery is closed. Set the next scheduled date and clear its order link." };
  // Without a link, two records may describe one delivery. Ask rather than count it twice or guess.
  if (order && subscription.nextDeliveryOrderId !== order.id)
    return { ...result,reason:"An open order may be this subscription delivery. Link it in tracking before comparing supply; scheduled units are not counted twice." };
  const deliveryDate = order ? order.expectedDeliveryDate : subscription.nextDeliveryDate;
  if (!deliveryDate || deliveryDate < today)
    return { ...result,reason:"Confirm receipt or update the next delivery date. Past or unknown arrivals are not added to supply." };
  const wait = day(deliveryDate)-day(today);
  const beforeDays = Math.max(0,coverage-wait);
  const quantity = order ? order.remainingQuantity : subscription.quantityPerDelivery;
  const before = beforeDays/rate.days, afterUnits = before+quantity;
  const spareCount = units => Math.max(0,Math.ceil(units-1-1e-9));
  const afterSpares = spareCount(afterUnits);
  const mayRunOut = wait > coverage || beforeDays < buffer;
  const likelyOverstock = afterSpares > 1;
  const belowSpareTarget = afterSpares < 1;
  const next = nextCadenceDate(deliveryDate,subscription.intervalCount,subscription.intervalUnit);
  const cadenceShortfall = subscription.quantityPerDelivery*rate.days < day(next)-day(deliveryDate);
  return { ...result,deliveryDate,before,after:afterUnits,beforeDays,beforeSpares:spareCount(before),afterSpares,
    mayRunOut,likelyOverstock,cadenceShortfall,belowSpareTarget,
    label:mayRunOut ? "May run out first" : likelyOverstock ? "Likely overstock" : cadenceShortfall || belowSpareTarget ? "May run out first" : "On track" };
}
