// Calendar dates belong to the user's local day, not a UTC timestamp.
export function localDate(date = new Date()) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export function deliveryDatePayload({ orderedDate, expectedDeliveryDate }, { existingOrder = null } = {}) {
  // Old orders can have no known order date. Omitting it preserves that fact.
  const preserveUnknown = existingOrder && !existingOrder.orderedDate && !orderedDate;
  if (!preserveUnknown && !isCalendarDate(orderedDate)) throw new Error("Enter a valid order date.");
  if (expectedDeliveryDate && !isCalendarDate(expectedDeliveryDate)) throw new Error("Enter a valid expected delivery date or leave it blank.");
  if (orderedDate && expectedDeliveryDate && expectedDeliveryDate < orderedDate) {
    throw new Error("Expected delivery cannot be before the order date.");
  }
  return {
    ...(!preserveUnknown ? { orderedDate } : {}),
    expectedDeliveryDate: expectedDeliveryDate || null,
  };
}

export function receiptDatePayload(receivedDate) {
  if (!isCalendarDate(receivedDate)) throw new Error("Enter the date this stock arrived.");
  return { receivedDate };
}

// A delivery check-in only corrects the expected date. Do not include quantities,
// receipt fields, or a guessed order date when a legacy order has none.
export function expectedDeliveryDatePayload(order, expectedDeliveryDate) {
  if (!order || order.status !== "open" || !(Number(order.remainingQuantity) > 0)) {
    throw new Error("This order is no longer awaiting delivery. Reload order data.");
  }
  if (expectedDeliveryDate && !isCalendarDate(expectedDeliveryDate)) {
    throw new Error("Enter a valid expected delivery date or leave it blank.");
  }
  if (order.orderedDate && expectedDeliveryDate && expectedDeliveryDate < order.orderedDate) {
    throw new Error("Expected delivery cannot be before the order date.");
  }
  return { expectedDeliveryDate: expectedDeliveryDate || null };
}

function calendarDayNumber(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return date.getTime() / 86400000;
}

export function deliveryStatus(order, today = localDate()) {
  if (!order || order.status !== "open" || !(Number(order.remainingQuantity) > 0)) return null;
  if (!isCalendarDate(order.expectedDeliveryDate) || !isCalendarDate(today)) return null;
  const days = calendarDayNumber(today) - calendarDayNumber(order.expectedDeliveryDate);
  if (days > 0) return { kind: "overdue", label: `${days} ${days === 1 ? "day" : "days"} overdue`, needsConfirmation: true };
  if (days === 0) return { kind: "due", label: "Expected today", needsConfirmation: true };
  return { kind: "upcoming", label: `Expected ${order.expectedDeliveryDate}`, needsConfirmation: false };
}

export function dueDeliveryOrders(orders = [], today = localDate()) {
  return orders
    .filter(order => deliveryStatus(order, today)?.needsConfirmation)
    // Date-only strings sort in calendar order without timezone conversion.
    // Oldest overdue first; equal dates retain the API's ordering.
    .sort((first, second) => first.expectedDeliveryDate.localeCompare(second.expectedDeliveryDate));
}

export function millisecondsUntilTomorrow(now = new Date()) {
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  return Math.max(1, tomorrow.getTime() - now.getTime());
}
