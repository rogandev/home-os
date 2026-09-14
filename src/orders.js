export function suggestedOrderQuantity(item = {}) {
  const onHand = Number(item.quantity) || 0;
  const reorderAt = Number(item.reorder_at) || 0;
  return Math.max(1, reorderAt + 1 - onHand);
}

export function receivedOrderQuantity(order = {}) {
  return Math.max(0, (Number(order.orderedQuantity) || 0) - (Number(order.remainingQuantity) || 0));
}

export function validateOrderCorrection(order, quantity) {
  const next = Number(quantity);
  const received = receivedOrderQuantity(order);
  if (!Number.isInteger(next) || next <= received) {
    throw new Error(`Order quantity must be a whole number greater than the ${received} already received.`);
  }
  return next;
}

export function validateReceipt(order, quantity, containerId) {
  const next = Number(quantity);
  const remaining = Number(order?.remainingQuantity) || 0;
  if (!Number.isInteger(next) || next <= 0) throw new Error("Receipt quantity must be a whole number greater than zero.");
  if (next > remaining) throw new Error(`Only ${remaining} units remain on this order.`);
  if (!containerId) throw new Error("Choose the container where the received stock was stored.");
  return { quantity: next, containerId };
}

export function openOrderMap(orders = []) {
  return new Map(orders.filter(order => order.status === "open").map(order => [order.itemId, order]));
}
