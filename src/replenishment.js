const POLICIES = new Set(["manual", "auto_replenish", "do_not_order"]);

export function replenishmentPolicyFor(item = {}) {
  if (POLICIES.has(item.replenishmentPolicy)) return item.replenishmentPolicy;
  return item.status === "do_not_order" ? "do_not_order" : "manual";
}

export function editableItemValues(initial = {}) {
  return {
    name: initial.name ?? "",
    brand: initial.brand ?? "",
    category: initial.category ?? "Skin Care",
    location: initial.location ?? "Walk-in Closet",
    size: initial.size ?? "",
    form: initial.form ?? "",
    quantity: initial.quantity ?? 1,
    reorder_at: initial.reorder_at ?? 1,
    replenishmentPolicy: replenishmentPolicyFor(initial),
    notes: initial.notes ?? "",
  };
}
