export function allocationTotal(allocations = []) {
  return allocations.reduce((total, allocation) => total + (Number(allocation.quantity) || 0), 0);
}

export function allocationRows(allocations = [], containers = []) {
  const allocationByContainer = new Map(
    allocations.map(allocation => [allocation.containerId, allocation]),
  );
  const containerById = new Map(containers.map(container => [container.id, container]));
  const ids = new Set([
    ...containers.filter(container => container.isActive).map(container => container.id),
    ...allocations.map(allocation => allocation.containerId),
  ]);

  return [...ids].map(containerId => {
    const container = containerById.get(containerId) || {};
    const allocation = allocationByContainer.get(containerId) || {};
    return {
      containerId,
      containerName: allocation.containerName || container.name || containerId,
      locationId: allocation.locationId || container.locationId || "",
      locationName: allocation.locationName || container.locationName || "Unknown location",
      isCompatibility: Boolean(container.isCompatibility),
      isActive: container.isActive !== false,
      quantity: Number(allocation.quantity) || 0,
    };
  }).sort((a, b) =>
    a.locationName.localeCompare(b.locationName) ||
    Number(a.isCompatibility) - Number(b.isCompatibility) ||
    a.containerName.localeCompare(b.containerName),
  );
}

export function setAllocationQuantity(rows, containerId, quantity) {
  const nextQuantity = Number(quantity);
  if (!Number.isInteger(nextQuantity) || nextQuantity < 0) {
    throw new Error("Container quantities must be whole numbers of zero or more.");
  }
  return rows.map(row => row.containerId === containerId ? { ...row, quantity: nextQuantity } : row);
}

export function moveStock(rows, fromContainerId, toContainerId, amount) {
  const quantity = Number(amount);
  if (!fromContainerId || !toContainerId || fromContainerId === toContainerId) {
    throw new Error("Choose two different containers.");
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("Move quantity must be a whole number greater than zero.");
  }
  const source = rows.find(row => row.containerId === fromContainerId);
  if (!source || source.quantity < quantity) {
    throw new Error("The source container does not have enough stock.");
  }
  return rows.map(row => {
    if (row.containerId === fromContainerId) return { ...row, quantity: row.quantity - quantity };
    if (row.containerId === toContainerId) return { ...row, quantity: row.quantity + quantity };
    return row;
  });
}

export function allocationPayload(rows = []) {
  return rows
    .filter(row => Number(row.quantity) > 0)
    .map(row => ({ containerId: row.containerId, quantity: Number(row.quantity) }));
}

export function positiveAllocations(rows = []) {
  return rows.filter(row => Number(row.quantity) > 0);
}

