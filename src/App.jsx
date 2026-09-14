import { useState, useEffect, useCallback } from "react";
import { editableItemValues, replenishmentPolicyFor } from "./replenishment.js";
import {
  openOrderMap,
  receivedOrderQuantity,
  suggestedOrderQuantity,
  validateOrderCorrection,
  validateReceipt,
} from "./orders.js";
import {
  allocationPayload,
  allocationRows,
  allocationTotal,
  moveStock,
  positiveAllocations,
  setAllocationQuantity,
} from "./storage.js";

const ROGAN_API_URL = (import.meta.env.VITE_ROGAN_API_URL || "").replace(/\/+$/, "");
const API = ROGAN_API_URL ? `${ROGAN_API_URL}/home-os` : (import.meta.env.VITE_API_URL || "http://localhost:3000/home-os").replace(/\/+$/, "");
const API_TOKEN = import.meta.env.VITE_ROGAN_API_TOKEN || import.meta.env.VITE_API_TOKEN || "";

const CATEGORIES = ["Skin Care", "Hair Care", "Personal Care", "Cleaning Supplies"];
const LOCATIONS  = ["Kiehl's Bag", "Walk-in Closet", "Kitchen"];
const STATUSES   = ["normal", "need_to_order", "awaiting_shipment", "do_not_order"];

const STATUS_LABEL = { normal: "In stock / Covered", need_to_order: "Need to order", awaiting_shipment: "Already coming", do_not_order: "Do not replenish" };
const STATUS_COLOR = { normal: "#4ade80", need_to_order: "#f87171", awaiting_shipment: "#facc15", do_not_order: "#94a3b8" };
const REPLENISHMENT_LABEL = { manual: "Manual", auto_replenish: "Auto-replenish", do_not_order: "Do Not Order" };
const REPLENISHMENT_DESCRIPTION = {
  manual: "Flags the item when stock reaches its reorder level.",
  auto_replenish: "Tracks your preference; automated purchasing is not enabled yet.",
  do_not_order: "Keeps the item in inventory without reorder recommendations.",
};
const CAT_COLOR    = { "Skin Care": "#818cf8", "Hair Care": "#06b6d4", "Personal Care": "#f97316", "Cleaning Supplies": "#4ade80" };

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let details;
    try { details = JSON.parse(text); } catch { details = null; }
    const error = new Error(details?.error || text || `Request failed (${res.status})`);
    error.code = details?.code || res.headers.get("X-Error-Code") || "";
    error.status = res.status;
    throw error;
  }
  return res.json();
}

function Modal({ title, onClose, children }) {
  return (
    <div role="dialog" aria-modal="true" aria-label={title} onClick={e => e.target === e.currentTarget && onClose()}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{ background: "#13131a", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 600, maxHeight: "90vh", overflowY: "auto", padding: "20px 20px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{title}</div>
          <button aria-label={`Close ${title}`} onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontFamily: "monospace", letterSpacing: "0.08em", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}

const inputStyle = {
  width: "100%", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
  color: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "monospace", outline: "none",
};

function SelectField({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, appearance: "none" }}>
      {options.map(o => <option key={o} value={o} style={{ background: "#1a1a2e" }}>{o}</option>)}
    </select>
  );
}

function ItemForm({ initial = {}, onSave, onClose }) {
  const [form, setForm] = useState(() => editableItemValues(initial));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name.trim()) {
      setSaveError("Give this item a name before saving.");
      return;
    }
    if (!Number.isInteger(form.quantity) || form.quantity < 0) {
      setSaveError("Quantity must be a whole number of zero or more.");
      return;
    }
    if (!Number.isInteger(form.reorder_at) || form.reorder_at < 0) {
      setSaveError("Reorder level must be a whole number of zero or more.");
      return;
    }
    setSaveError("");
    setSaving(true);
    try {
      await onSave(form);
    } catch (error) {
      setSaveError(error.message || "The item could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Field label="PRODUCT NAME *">
        <input style={inputStyle} value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Ultra Facial Cream" />
      </Field>
      <Field label="BRAND">
        <input style={inputStyle} value={form.brand} onChange={e => set("brand", e.target.value)} placeholder="e.g. Kiehl's" />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="CATEGORY"><SelectField value={form.category} onChange={v => set("category", v)} options={CATEGORIES} /></Field>
        <Field label="LOCATION"><SelectField value={form.location} onChange={v => set("location", v)} options={LOCATIONS} /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="SIZE"><input style={inputStyle} value={form.size} onChange={e => set("size", e.target.value)} placeholder="e.g. 1.7 fl oz" /></Field>
        <Field label="FORM"><input style={inputStyle} value={form.form} onChange={e => set("form", e.target.value)} placeholder="e.g. Tube, Jar" /></Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="QUANTITY"><input style={inputStyle} type="number" min={0} value={form.quantity} onChange={e => set("quantity", Number(e.target.value))} /></Field>
        <Field label="REORDER AT (DEFAULT: 1)"><input style={inputStyle} type="number" min={0} value={form.reorder_at} onChange={e => set("reorder_at", Number(e.target.value))} /></Field>
      </div>
      <Field label="REPLENISHMENT">
        <select aria-label="Replenishment" value={form.replenishmentPolicy} onChange={e => set("replenishmentPolicy", e.target.value)} style={{ ...inputStyle, appearance: "none" }}>
          <option value="manual" style={{ background: "#1a1a2e" }}>Manual</option>
          <option value="auto_replenish" style={{ background: "#1a1a2e" }}>Auto-replenish</option>
          <option value="do_not_order" style={{ background: "#1a1a2e" }}>Do Not Order</option>
        </select>
        <div style={{ marginTop: 5, fontSize: 10, color: "rgba(255,255,255,0.32)", fontFamily: "monospace" }}>
          {REPLENISHMENT_DESCRIPTION[form.replenishmentPolicy]}
        </div>
      </Field>
      <Field label="NOTES"><input style={inputStyle} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Optional notes" /></Field>
      {saveError && (
        <div role="alert" style={{ padding: "9px 11px", borderRadius: 8, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.25)", color: "#fca5a5", fontSize: 11, fontFamily: "monospace" }}>
          {saveError}
        </div>
      )}
      <button onClick={handleSave} disabled={saving} style={{
        marginTop: 8, background: "#818cf8", color: "#000", border: "none", borderRadius: 10,
        padding: "12px", fontSize: 13, fontFamily: "monospace", fontWeight: 700,
        cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1,
      }}>{saving ? "Saving..." : "Save Item"}</button>
    </div>
  );
}

function StorageModal({ item, allocations, containers, intent, onSave, onClose }) {
  const [rows, setRows] = useState(() => allocationRows(allocations, containers));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [moveFrom, setMoveFrom] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [moveAmount, setMoveAmount] = useState("1");
  const total = allocationTotal(rows);
  const availableSources = rows.filter(row => row.quantity > 0);
  const availableDestinations = rows.filter(row => row.isActive);

  function changeQuantity(containerId, value) {
    try {
      setRows(current => setAllocationQuantity(current, containerId, value));
      setError("");
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  function applyMove() {
    try {
      setRows(current => moveStock(current, moveFrom, moveTo, moveAmount));
      setError("");
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await onSave(rows, { markReceived: intent === "receive" });
      onClose();
    } catch (nextError) {
      const message = nextError.code === "HOME_OS_ALLOCATION_REQUIRED"
        ? "Choose the exact container whose stock changed. Nothing was updated."
        : nextError.message || "Storage could not be updated.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const guidance = intent === "use"
    ? "Choose the container you used and reduce it by one."
    : intent === "add"
      ? "Choose where the new unit was stored and add one."
      : intent === "receive"
        ? "Put the received stock in its real container, then save the receipt."
        : "Set each physical quantity or move stock without changing the combined total.";

  return (
    <Modal title={`Storage · ${item.name}`} onClose={onClose}>
      <div style={{ padding: "10px 12px", marginBottom: 12, borderRadius: 9, background: "rgba(129,140,248,0.08)", border: "1px solid rgba(129,140,248,0.2)", color: "#c7d2fe", fontSize: 11, fontFamily: "monospace", lineHeight: 1.5 }}>
        {guidance}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map(row => (
          <div key={row.containerId} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center", padding: "10px 11px", borderRadius: 9, background: row.quantity > 0 ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.08)", opacity: row.isActive ? 1 : 0.65 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#fff", fontSize: 12, fontWeight: 650 }}>{row.containerName}</div>
              <div style={{ color: "rgba(255,255,255,0.36)", fontSize: 9, fontFamily: "monospace", marginTop: 2 }}>
                {row.locationName}{row.isCompatibility ? " · Unassigned compatibility stock" : ""}{!row.isActive ? " · Archived" : ""}
              </div>
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <button aria-label={`Remove one from ${row.containerName}`} disabled={row.quantity <= 0 || saving} onClick={() => changeQuantity(row.containerId, row.quantity - 1)} style={{ ...storageStepButton, opacity: row.quantity <= 0 ? 0.35 : 1 }}>−</button>
              <input aria-label={`${row.containerName} quantity`} type="number" min={0} step={1} value={row.quantity} disabled={!row.isActive || saving} onChange={event => changeQuantity(row.containerId, event.target.value)} style={{ ...inputStyle, width: 58, textAlign: "center", padding: "7px 4px" }} />
              <button aria-label={`Add one to ${row.containerName}`} disabled={!row.isActive || saving} onClick={() => changeQuantity(row.containerId, row.quantity + 1)} style={storageStepButton}>+</button>
            </div>
          </div>
        ))}
      </div>

      {availableSources.length > 0 && availableDestinations.length > 1 && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.025)" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,0.45)", fontFamily: "monospace", marginBottom: 8 }}>MOVE STOCK — TOTAL STAYS THE SAME</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
            <select aria-label="Move stock from" value={moveFrom} onChange={event => setMoveFrom(event.target.value)} style={{ ...inputStyle, appearance: "none", fontSize: 10 }}>
              <option value="">From container…</option>
              {availableSources.map(row => <option key={row.containerId} value={row.containerId}>{row.containerName} ({row.quantity})</option>)}
            </select>
            <select aria-label="Move stock to" value={moveTo} onChange={event => setMoveTo(event.target.value)} style={{ ...inputStyle, appearance: "none", fontSize: 10 }}>
              <option value="">To container…</option>
              {availableDestinations.map(row => <option key={row.containerId} value={row.containerId}>{row.containerName}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 7, marginTop: 7 }}>
            <input aria-label="Move quantity" type="number" min={1} step={1} value={moveAmount} onChange={event => setMoveAmount(event.target.value)} style={{ ...inputStyle, flex: 1 }} />
            <button onClick={applyMove} style={{ padding: "8px 13px", borderRadius: 8, border: "1px solid rgba(129,140,248,0.35)", background: "rgba(129,140,248,0.14)", color: "#c7d2fe", fontFamily: "monospace", fontSize: 10 }}>Apply move</button>
          </div>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, padding: "10px 0", borderTop: "1px solid rgba(255,255,255,0.08)" }}>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,0.42)", fontFamily: "monospace" }}>COMBINED ON HAND</span>
        <strong aria-live="polite" style={{ color: total === item.quantity ? "#4ade80" : "#facc15", fontFamily: "monospace", fontSize: 18 }}>{total} units</strong>
      </div>
      {total !== item.quantity && intent === "manage" && (
        <div style={{ marginBottom: 10, color: "#facc15", fontSize: 10, fontFamily: "monospace" }}>Saving will correct the item total from {item.quantity} to {total}.</div>
      )}
      {error && <div role="alert" style={{ marginBottom: 10, padding: "9px 11px", borderRadius: 8, background: "rgba(248,113,113,0.1)", color: "#fca5a5", fontSize: 10, fontFamily: "monospace" }}>{error}</div>}
      <button onClick={save} disabled={saving} style={{ width: "100%", border: "none", borderRadius: 10, padding: 12, background: intent === "receive" ? "#4ade80" : "#818cf8", color: "#000", fontFamily: "monospace", fontWeight: 750, opacity: saving ? 0.6 : 1 }}>
        {saving ? "Saving…" : intent === "receive" ? "Save Receipt" : "Save Storage"}
      </button>
    </Modal>
  );
}

const storageStepButton = {
  width: 32,
  height: 32,
  borderRadius: 7,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.06)",
  color: "#fff",
  fontSize: 16,
};

const orderButtonStyle = {
  minHeight: 38,
  padding: "9px 12px",
  borderRadius: 8,
  fontFamily: "monospace",
  fontSize: 11,
  fontWeight: 700,
};

function OrderModal({ item, order, containers, onChanged, onClose }) {
  const [orderedQuantity, setOrderedQuantity] = useState(() => order?.orderedQuantity ?? suggestedOrderQuantity(item));
  const [receiptQuantity, setReceiptQuantity] = useState(() => order?.remainingQuantity ?? 1);
  const [containerId, setContainerId] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const activeContainers = containers.filter(container => container.isActive);
  const legacyAwaiting = !order && item.status === "awaiting_shipment";
  const received = order ? receivedOrderQuantity(order) : 0;

  async function run(action) {
    if (working) return;
    setWorking(true);
    setError("");
    try {
      await action();
      await onChanged();
      onClose();
    } catch (nextError) {
      setError(nextError.message || "The order could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  function createOrder() {
    const quantity = Number(orderedQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Order quantity must be a whole number greater than zero.");
      return;
    }
    run(() => apiFetch(`/items/${item.id}/orders`, { method: "POST", body: JSON.stringify({ quantity }) }));
  }

  function saveCorrection() {
    try {
      const quantity = validateOrderCorrection(order, orderedQuantity);
      run(() => apiFetch(`/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ quantity }) }));
    } catch (nextError) { setError(nextError.message); }
  }

  function receiveOrder() {
    try {
      const receipt = validateReceipt(order, receiptQuantity, containerId);
      run(() => apiFetch(`/orders/${order.id}/receive`, { method: "POST", body: JSON.stringify(receipt) }));
    } catch (nextError) { setError(nextError.message); }
  }

  function cancelOrder() {
    if (!window.confirm(`Cancel the remaining ${order.remainingQuantity} incoming units? On-hand stock will not change.`)) return;
    run(() => apiFetch(`/orders/${order.id}/cancel`, { method: "POST" }));
  }

  function removeOrder() {
    if (!window.confirm("Mark this order as entered incorrectly? Its audit history will be retained.")) return;
    run(() => apiFetch(`/orders/${order.id}`, { method: "DELETE" }));
  }

  function clearLegacyAwaiting() {
    const status = item.quantity <= item.reorder_at ? "need_to_order" : "normal";
    run(() => apiFetch(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }));
  }

  return (
    <Modal title={`Order · ${item.name}`} onClose={onClose}>
      {!order ? (
        <>
          {legacyAwaiting && (
            <div style={{ padding: 11, marginBottom: 12, borderRadius: 9, background: "rgba(250,204,21,0.09)", border: "1px solid rgba(250,204,21,0.24)", color: "#fde68a", fontSize: 11, lineHeight: 1.5 }}>
              This item has the old Awaiting Shipment flag but no incoming order. Enter the real incoming quantity or clear the incorrect state.
            </div>
          )}
          <Field label="HOW MANY ARE COMING?">
            <input aria-label="Incoming quantity" style={inputStyle} type="number" min={1} step={1} value={orderedQuantity} onChange={event => setOrderedQuantity(event.target.value)} />
          </Field>
          {error && <div role="alert" style={{ marginBottom: 10, color: "#fca5a5", fontSize: 10, fontFamily: "monospace" }}>{error}</div>}
          <button disabled={working} onClick={createOrder} style={{ ...orderButtonStyle, width: "100%", border: 0, background: "#facc15", color: "#111827", opacity: working ? 0.6 : 1 }}>
            {working ? "Saving…" : "Save as already coming"}
          </button>
          {legacyAwaiting && (
            <button disabled={working} onClick={clearLegacyAwaiting} style={{ ...orderButtonStyle, width: "100%", marginTop: 8, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "rgba(255,255,255,0.66)" }}>
              Clear incorrect Awaiting Shipment
            </button>
          )}
        </>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 14 }}>
            {[
              ["ORDERED", order.orderedQuantity],
              ["RECEIVED", received],
              ["STILL COMING", order.remainingQuantity],
            ].map(([label, value]) => (
              <div key={label} style={{ padding: "10px 8px", borderRadius: 9, background: "rgba(255,255,255,0.05)", textAlign: "center" }}>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,0.35)", fontFamily: "monospace" }}>{label}</div>
                <div style={{ marginTop: 3, color: label === "STILL COMING" ? "#facc15" : "#fff", fontSize: 20, fontFamily: "monospace", fontWeight: 750 }}>{value}</div>
              </div>
            ))}
          </div>

          <Field label="CORRECT TOTAL ORDER QUANTITY">
            <div style={{ display: "flex", gap: 7 }}>
              <input aria-label="Corrected order quantity" style={{ ...inputStyle, flex: 1 }} type="number" min={received + 1} step={1} value={orderedQuantity} onChange={event => setOrderedQuantity(event.target.value)} />
              <button disabled={working || Number(orderedQuantity) === order.orderedQuantity} onClick={saveCorrection} style={{ ...orderButtonStyle, border: "1px solid rgba(129,140,248,0.35)", background: "rgba(129,140,248,0.14)", color: "#c7d2fe" }}>Save correction</button>
            </div>
          </Field>

          <div style={{ marginTop: 14, padding: 12, borderRadius: 10, background: "rgba(74,222,128,0.06)", border: "1px solid rgba(74,222,128,0.18)" }}>
            <div style={{ fontSize: 10, color: "#86efac", fontFamily: "monospace", fontWeight: 700, marginBottom: 9 }}>RECEIVE STOCK</div>
            <div style={{ display: "grid", gridTemplateColumns: "90px 1fr", gap: 7 }}>
              <input aria-label="Quantity received" style={inputStyle} type="number" min={1} max={order.remainingQuantity} step={1} value={receiptQuantity} onChange={event => setReceiptQuantity(event.target.value)} />
              <select aria-label="Received into container" style={{ ...inputStyle, appearance: "none" }} value={containerId} onChange={event => setContainerId(event.target.value)}>
                <option value="">Choose its real container…</option>
                {activeContainers.map(container => <option key={container.id} value={container.id}>{container.locationName} · {container.name}</option>)}
              </select>
            </div>
            <button disabled={working} onClick={receiveOrder} style={{ ...orderButtonStyle, width: "100%", marginTop: 8, border: 0, background: "#4ade80", color: "#052e16" }}>
              {working ? "Saving…" : `Receive ${receiptQuantity || 0} into stock`}
            </button>
          </div>

          {error && <div role="alert" style={{ marginTop: 10, color: "#fca5a5", fontSize: 10, fontFamily: "monospace" }}>{error}</div>}
          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button disabled={working} onClick={cancelOrder} style={{ ...orderButtonStyle, flex: 1, border: "1px solid rgba(250,204,21,0.28)", background: "rgba(250,204,21,0.08)", color: "#fde68a" }}>Cancel remaining</button>
            <button disabled={working} onClick={removeOrder} style={{ ...orderButtonStyle, flex: 1, border: "1px solid rgba(248,113,113,0.25)", background: "transparent", color: "#fca5a5" }}>Entered incorrectly</button>
          </div>
        </>
      )}
    </Modal>
  );
}

function ItemCard({ item, order = null, allocations = [], allocationError = false, containers = [], onUpdate, onDelete, onReplaceAllocations, onOrderChanged, onReload }) {
  const [editing, setEditing] = useState(false);
  const [showStorage, setShowStorage] = useState(false);
  const [showOrder, setShowOrder] = useState(false);
  const [storageIntent, setStorageIntent] = useState("manage");
  const [working, setWorking] = useState(false);
  const [actionError, setActionError] = useState("");

  const statusColor = order ? STATUS_COLOR.awaiting_shipment : STATUS_COLOR[item.status] || "#fff";
  const catColor = CAT_COLOR[item.category] || "#fff";
  const replenishmentPolicy = replenishmentPolicyFor(item);
  const isLow = item.status === "need_to_order";
  const isAwaiting = Boolean(order) || item.status === "awaiting_shipment";
  const isDoNotOrder = replenishmentPolicy === "do_not_order";
  const statusLabel = order ? `Already coming · ${order.remainingQuantity}` : STATUS_LABEL[item.status];
  const rows = allocationRows(allocations, containers);
  const stored = positiveAllocations(rows);

  function openStorage(intent = "manage") {
    setActionError("");
    if (allocationError) {
      setActionError("Storage details are unavailable. Reload before changing stock.");
      return;
    }
    setStorageIntent(intent);
    setShowStorage(true);
  }

  async function saveAllocations(nextRows, options = {}) {
    return onReplaceAllocations(item, nextRows, options);
  }

  async function changeSingleAllocation(delta) {
    if (working) return;
    if (allocationError) {
      setActionError("Storage details are unavailable. Reload before changing stock.");
      return;
    }
    if (stored.length !== 1 || !stored[0].isActive) {
      openStorage(delta < 0 ? "use" : "add");
      return;
    }
    if (delta < 0 && stored[0].quantity <= 0) return;
    setWorking(true);
    setActionError("");
    try {
      const nextRows = setAllocationQuantity(rows, stored[0].containerId, Math.max(0, stored[0].quantity + delta));
      await saveAllocations(nextRows);
    } catch (e) {
      setActionError(e.message || "Quantity could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  async function decrement() {
    if (working || item.quantity <= 0) return;
    await changeSingleAllocation(-1);
  }

  async function increment() {
    await changeSingleAllocation(1);
  }

  async function setStatus(status) {
    if (working) return;
    setWorking(true);
    setActionError("");
    try {
      const updated = await apiFetch(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      onUpdate(updated);
    } catch (e) {
      setActionError(e.message || "Status could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  async function setReplenishmentPolicy(policy) {
    if (working) return;
    setWorking(true);
    setActionError("");
    try {
      const updated = await apiFetch(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ replenishmentPolicy: policy }) });
      onUpdate(updated);
    } catch (e) {
      setActionError(e.message || "Replenishment preference could not be updated.");
    } finally {
      setWorking(false);
    }
  }

  async function handleEdit(form) {
    try {
      const updated = await apiFetch(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify(form) });
      onUpdate(updated); setEditing(false);
    } catch (e) { alert(e.message); }
  }

  async function handleDelete() {
    if (!window.confirm(`Permanently delete "${item.name}"? This cannot be undone.`)) return;
    try { await apiFetch(`/items/${item.id}`, { method: "DELETE" }); onDelete(item.id); }
    catch (e) { setActionError(e.message || "Item could not be deleted."); }
  }

  return (
    <>
      <div style={{
        background: isLow ? "rgba(248,113,113,0.06)" : isAwaiting ? "rgba(250,204,21,0.06)" : isDoNotOrder ? "rgba(148,163,184,0.05)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${isLow ? "rgba(248,113,113,0.2)" : isAwaiting ? "rgba(250,204,21,0.2)" : isDoNotOrder ? "rgba(148,163,184,0.18)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 12, padding: "12px 14px", contentVisibility: "auto", containIntrinsicSize: "150px",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 3, height: 40, borderRadius: 2, background: catColor, flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", lineHeight: 1.3 }}>{item.name}</div>
                {item.brand && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", marginTop: 1 }}>{item.brand}</div>}
              </div>
              <div aria-label={`${item.quantity} units in stock`} style={{ display: "flex", alignItems: "baseline", gap: 4, flexShrink: 0 }}>
                <span style={{ fontSize: 18, fontWeight: 750, color: statusColor, fontFamily: "monospace", minWidth: 20, textAlign: "right" }}>{item.quantity}</span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>units</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: `${catColor}20`, color: catColor, fontFamily: "monospace" }}>{item.category}</span>
              {item.size && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{item.size}</span>}
              {replenishmentPolicy === "auto_replenish" && <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(129,140,248,0.12)", color: "#a5b4fc", fontFamily: "monospace" }}>{REPLENISHMENT_LABEL[replenishmentPolicy]}</span>}
              {isAwaiting ? (
                <button aria-label={`Manage incoming order for ${item.name}`} onClick={() => setShowOrder(true)} style={{ marginLeft: "auto", fontSize: 9, padding: "3px 7px", borderRadius: 4, border: `1px solid ${statusColor}45`, background: `${statusColor}20`, color: statusColor, fontFamily: "monospace", fontWeight: 700 }}>
                  {statusLabel} →
                </button>
              ) : (
                <span style={{ marginLeft: "auto", fontSize: 9, padding: "2px 7px", borderRadius: 4, background: `${statusColor}20`, color: statusColor, fontFamily: "monospace", fontWeight: 600 }}>
                  {statusLabel}
                </span>
              )}
            </div>

            <button disabled={allocationError} onClick={() => openStorage("manage")} aria-label={`Manage storage for ${item.name}`} style={{ width: "100%", marginTop: 8, padding: "8px 9px", textAlign: "left", borderRadius: 8, border: "1px solid rgba(129,140,248,0.18)", background: "rgba(129,140,248,0.06)", color: "inherit", opacity: allocationError ? 0.65 : 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 9, fontFamily: "monospace", letterSpacing: "0.08em", color: "rgba(255,255,255,0.35)" }}>STORED IN</span>
                <span style={{ fontSize: 9, fontFamily: "monospace", color: "#a5b4fc" }}>Manage →</span>
              </div>
              {allocationError ? (
                <div style={{ fontSize: 11, marginTop: 4, color: "#fca5a5" }}>Storage unavailable · reload before editing</div>
              ) : stored.length === 0 ? (
                <div style={{ fontSize: 11, marginTop: 4, color: "#facc15" }}>No container allocation · {item.location}</div>
              ) : (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                  {stored.map(row => (
                    <span key={row.containerId} style={{ padding: "3px 7px", borderRadius: 5, background: "rgba(255,255,255,0.06)", color: row.isCompatibility ? "#cbd5e1" : "#fff", fontSize: 10, fontFamily: "monospace" }}>
                      {row.containerName} · {row.locationName} · {row.quantity}
                    </span>
                  ))}
                </div>
              )}
            </button>

            <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
              <button disabled={working || item.quantity <= 0} aria-label={`Use one ${item.name}`} onClick={decrement} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(129,140,248,0.14)", border: "1px solid rgba(129,140,248,0.32)", color: "#a5b4fc", borderRadius: 7, cursor: item.quantity <= 0 ? "not-allowed" : "pointer", opacity: working || item.quantity <= 0 ? 0.45 : 1, fontFamily: "monospace", fontWeight: 700 }}>
                Use 1
              </button>
              <button disabled={working} aria-label={`Add one ${item.name}`} onClick={increment} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.72)", borderRadius: 7, cursor: "pointer", opacity: working ? 0.45 : 1, fontFamily: "monospace" }}>
                +1
              </button>
              <button onClick={() => openStorage("manage")} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.55)", borderRadius: 7, cursor: "pointer", fontFamily: "monospace" }}>
                Adjust
              </button>
              {item.status === "normal" && (
                <button onClick={() => setStatus("need_to_order")} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", borderRadius: 7, cursor: "pointer", fontFamily: "monospace" }}>
                  Need to order
                </button>
              )}
              {item.status === "need_to_order" && (
                <button onClick={() => setShowOrder(true)} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(250,204,21,0.15)", border: "1px solid rgba(250,204,21,0.3)", color: "#facc15", borderRadius: 7, cursor: "pointer", fontFamily: "monospace" }}>
                  Add order →
                </button>
              )}
              {item.status === "awaiting_shipment" && (
                <button onClick={() => setShowOrder(true)} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(250,204,21,0.15)", border: "1px solid rgba(250,204,21,0.3)", color: "#facc15", borderRadius: 7, cursor: "pointer", fontFamily: "monospace" }}>
                  Manage order →
                </button>
              )}
              {!isDoNotOrder ? (
                <button disabled={working} aria-label={`Do not reorder ${item.name}`} onClick={() => setReplenishmentPolicy("do_not_order")} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(148,163,184,0.08)", border: "1px solid rgba(148,163,184,0.2)", color: "#cbd5e1", borderRadius: 7, cursor: working ? "not-allowed" : "pointer", opacity: working ? 0.45 : 1, fontFamily: "monospace" }}>
                  Do not replenish
                </button>
              ) : (
                <button disabled={working} aria-label={`Switch ${item.name} to manual replenishment`} onClick={() => setReplenishmentPolicy("manual")} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(74,222,128,0.1)", border: "1px solid rgba(74,222,128,0.22)", color: "#86efac", borderRadius: 7, cursor: working ? "not-allowed" : "pointer", opacity: working ? 0.45 : 1, fontFamily: "monospace" }}>
                  Resume manual ordering
                </button>
              )}
              <button onClick={() => setEditing(true)} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.5)", borderRadius: 7, cursor: "pointer", fontFamily: "monospace" }}>Edit</button>
              <button onClick={handleDelete} style={{ fontSize: 10, padding: "6px 10px", minHeight: 30, background: "transparent", border: "1px solid rgba(248,113,113,0.15)", color: "rgba(248,113,113,0.58)", borderRadius: 7, cursor: "pointer", fontFamily: "monospace" }}>Delete permanently</button>
            </div>
            {actionError && (
              <div role="alert" style={{ marginTop: 8, color: "#fca5a5", fontSize: 10, fontFamily: "monospace" }}>
                {actionError} {allocationError && <button onClick={onReload} style={{ marginLeft: 5, border: 0, background: "transparent", color: "#c7d2fe", fontFamily: "monospace", textDecoration: "underline" }}>Reload</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      {showStorage && (
        <StorageModal
          item={item}
          allocations={allocations}
          containers={containers}
          intent={storageIntent}
          onSave={saveAllocations}
          onClose={() => setShowStorage(false)}
        />
      )}

      {editing && (
        <Modal title="Edit Item" onClose={() => setEditing(false)}>
          <ItemForm initial={item} onSave={handleEdit} onClose={() => setEditing(false)} />
        </Modal>
      )}

      {showOrder && (
        <OrderModal
          item={item}
          order={order}
          containers={containers}
          onChanged={onOrderChanged}
          onClose={() => setShowOrder(false)}
        />
      )}
    </>
  );
}

export default function HomeOS() {
  const [items, setItems] = useState([]);
  const [locations, setLocations] = useState([]);
  const [containers, setContainers] = useState([]);
  const [orders, setOrders] = useState([]);
  const [allocationsByItem, setAllocationsByItem] = useState({});
  const [allocationErrors, setAllocationErrors] = useState({});
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterCat, setFilterCat] = useState("all");
  const [filterLoc, setFilterLoc] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("inventory");

  const loadAll = useCallback(async () => {
    try {
      const [data, statsData, locationData, containerData, orderData] = await Promise.all([
        apiFetch("/items"),
        apiFetch("/stats"),
        apiFetch("/locations"),
        apiFetch("/containers"),
        apiFetch("/orders?status=open").catch(nextError => nextError.status === 404 ? [] : Promise.reject(nextError)),
      ]);
      const allocationResults = await Promise.allSettled(
        data.map(item => apiFetch(`/items/${item.id}/stock-allocations`)),
      );
      const nextAllocations = {};
      const nextAllocationErrors = {};
      data.forEach((item, index) => {
        nextAllocations[item.id] = allocationResults[index].status === "fulfilled" ? allocationResults[index].value : [];
        if (allocationResults[index].status === "rejected") nextAllocationErrors[item.id] = true;
      });
      setItems(data);
      setStats(statsData);
      setLocations(locationData);
      setContainers(containerData);
      setOrders(orderData);
      setAllocationsByItem(nextAllocations);
      setAllocationErrors(nextAllocationErrors);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  function updateItem(updated) {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    apiFetch("/stats").then(setStats).catch(() => {});
  }

  function deleteItem(id) {
    setItems(prev => prev.filter(i => i.id !== id));
    setAllocationsByItem(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setAllocationErrors(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    apiFetch("/stats").then(setStats).catch(() => {});
  }

  async function addItem(form) {
    const created = await apiFetch("/items", { method: "POST", body: JSON.stringify(form) });
    const allocations = await apiFetch(`/items/${created.id}/stock-allocations`);
    setItems(prev => [created, ...prev]);
    setAllocationsByItem(prev => ({ ...prev, [created.id]: allocations }));
    setAllocationErrors(prev => ({ ...prev, [created.id]: false }));
    setAdding(false);
    apiFetch("/stats").then(setStats).catch(() => {});
  }

  async function replaceItemAllocations(item, rows, { markReceived = false } = {}) {
    const savedAllocations = await apiFetch(`/items/${item.id}/stock-allocations`, {
      method: "PUT",
      body: JSON.stringify({ allocations: allocationPayload(rows) }),
    });
    const total = allocationTotal(savedAllocations);
    const updated = markReceived
      ? await apiFetch(`/items/${item.id}/received`, { method: "PATCH", body: JSON.stringify({ quantity: total }) })
      : await apiFetch(`/items/${item.id}`);
    setAllocationsByItem(prev => ({ ...prev, [item.id]: savedAllocations }));
    setAllocationErrors(prev => ({ ...prev, [item.id]: false }));
    updateItem(updated);
    return { item: updated, allocations: savedAllocations };
  }

  const ordersByItem = openOrderMap(orders);
  const filtered = items.filter(i => {
    if (filterCat !== "all" && i.category !== filterCat) return false;
    const effectiveStatus = ordersByItem.has(i.id) ? "awaiting_shipment" : i.status;
    if (filterStatus !== "all" && effectiveStatus !== filterStatus) return false;
    if (filterLoc !== "all") {
      const itemRows = positiveAllocations(allocationRows(allocationsByItem[i.id] || [], containers));
      if (!itemRows.some(row => row.locationName === filterLoc) && i.location !== filterLoc) return false;
    }
    if (!search) return true;
    const query = search.toLowerCase();
    const storageText = positiveAllocations(allocationRows(allocationsByItem[i.id] || [], containers))
      .map(row => `${row.containerName} ${row.locationName}`).join(" ").toLowerCase();
    return i.name.toLowerCase().includes(query) ||
           (i.brand || "").toLowerCase().includes(query) ||
           storageText.includes(query);
  });
  const hasFilters = Boolean(search) || filterCat !== "all" || filterLoc !== "all" || filterStatus !== "all";

  function clearFilters() {
    setSearch("");
    setFilterCat("all");
    setFilterLoc("all");
    setFilterStatus("all");
  }

  const needToOrder = items.filter(i => i.status === "need_to_order" && !ordersByItem.has(i.id));
  const awaitingShipment = items.filter(i => i.status === "awaiting_shipment" || ordersByItem.has(i.id));

  const tabs = [
    { key: "inventory", label: "Inventory" },
    { key: "orders", label: `Orders${needToOrder.length + awaitingShipment.length > 0 ? ` (${needToOrder.length + awaitingShipment.length})` : ""}` },
  ];

  const locationNames = locations.filter(location => location.isActive).map(location => location.name);
  const itemCardProps = item => ({
    item,
    order: ordersByItem.get(item.id) || null,
    allocations: allocationsByItem[item.id] || [],
    allocationError: Boolean(allocationErrors[item.id]),
    containers,
    onUpdate: updateItem,
    onDelete: deleteItem,
    onReplaceAllocations: replaceItemAllocations,
    onOrderChanged: loadAll,
    onReload: loadAll,
  });

  // Clickable status pill handler — toggles filter
  function toggleStatusFilter(status) {
    setFilterStatus(prev => prev === status ? "all" : status);
  }

  return (
    <div style={{ minHeight: "100vh", background: "#09090e", color: "#e2e8f0", fontFamily: "system-ui, sans-serif", overflowY: "auto" }}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 3px; }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
        html, body, #root { height: 100%; }
        input, select { outline: none; }
        button { cursor: pointer; }
      `}</style>

      {/* Sticky header */}
      <div style={{ padding: "18px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", top: 0, background: "#09090e", zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>
              Home <span style={{ color: "#818cf8" }}>OS</span>
            </div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "monospace", letterSpacing: "0.1em", marginTop: 1 }}>
              {stats ? `${stats.total_items} items · ${stats.total_units} units` : "Loading..."}
            </div>
          </div>
          <button onClick={() => setAdding(true)} style={{
            background: "#818cf8", color: "#000", border: "none", borderRadius: 8,
            padding: "8px 16px", fontSize: 12, fontFamily: "monospace", fontWeight: 700,
          }}>+ Add Item</button>
        </div>

        {/* Clickable status pills — clicking filters the list */}
        {stats && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[
              { label: "In stock / Covered", val: stats.in_stock, status: "normal", color: "#4ade80" },
              { label: "Need to order", val: stats.need_to_order, status: "need_to_order", color: "#f87171" },
              { label: "Already coming", val: awaitingShipment.length, status: "awaiting_shipment", color: "#facc15" },
              { label: "Do not replenish", val: stats.do_not_order ?? 0, status: "do_not_order", color: "#94a3b8" },
            ].map(({ label, val, status, color }) => {
              const active = filterStatus === status;
              return (
                <button key={status} onClick={() => toggleStatusFilter(status)} style={{
                  display: "flex", alignItems: "center", gap: 5,
                  padding: "4px 10px",
                  background: active ? `${color}25` : `${color}12`,
                  border: `1px solid ${active ? color : `${color}30`}`,
                  borderRadius: 20, cursor: "pointer",
                  transform: active ? "scale(1.04)" : "scale(1)",
                  transition: "all 0.15s",
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                  <span style={{ fontSize: 10, color, fontFamily: "monospace", fontWeight: active ? 700 : 400 }}>
                    {val} {label}
                  </span>
                  {active && <span style={{ fontSize: 9, color, fontFamily: "monospace", marginLeft: 2 }}>✕</span>}
                </button>
              );
            })}
            {filterStatus !== "all" && (
              <button onClick={() => setFilterStatus("all")} style={{
                fontSize: 10, padding: "4px 10px", background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.1)", borderRadius: 20,
                color: "rgba(255,255,255,0.4)", fontFamily: "monospace", cursor: "pointer",
              }}>Clear filter</button>
            )}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              background: "none", border: "none", padding: "7px 12px", fontSize: 11,
              fontFamily: "monospace", color: tab === t.key ? "#fff" : "rgba(255,255,255,0.3)",
              borderBottom: tab === t.key ? "2px solid #818cf8" : "2px solid transparent",
              transition: "all 0.15s", letterSpacing: "0.04em",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      {/* Scrollable content */}
      <div style={{ padding: "14px 16px 40px", maxWidth: 680, margin: "0 auto" }}>

        {/* INVENTORY TAB */}
        {tab === "inventory" && (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              <input aria-label="Search inventory" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search items, brands, or containers..."
                style={{ ...inputStyle, fontSize: 12 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <select aria-label="Filter by category" value={filterCat} onChange={e => setFilterCat(e.target.value)}
                  style={{ ...inputStyle, flex: 1, appearance: "none", fontSize: 11 }}>
                  <option value="all">All Categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c} style={{ background: "#1a1a2e" }}>{c}</option>)}
                </select>
                <select aria-label="Filter by location" value={filterLoc} onChange={e => setFilterLoc(e.target.value)}
                  style={{ ...inputStyle, flex: 1, appearance: "none", fontSize: 11 }}>
                  <option value="all">All Locations</option>
                  {locationNames.map(l => <option key={l} value={l} style={{ background: "#1a1a2e" }}>{l}</option>)}
                </select>
                <select aria-label="Filter by status" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  style={{ ...inputStyle, flex: 1, appearance: "none", fontSize: 11 }}>
                  <option value="all">All Status</option>
                  {STATUSES.map(s => <option key={s} value={s} style={{ background: "#1a1a2e" }}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", minHeight: 24, gap: 12 }}>
                <span aria-live="polite" style={{ fontSize: 10, color: "rgba(255,255,255,0.32)", fontFamily: "monospace" }}>
                  Showing {filtered.length} of {items.length} items
                </span>
                {hasFilters && (
                  <button onClick={clearFilters} style={{ fontSize: 10, padding: "4px 8px", background: "transparent", border: "none", color: "#a5b4fc", fontFamily: "monospace", cursor: "pointer" }}>
                    Clear all filters
                  </button>
                )}
              </div>
            </div>

            {loading && <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>Loading...</div>}
            {error && <div style={{ padding: 16, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, color: "#f87171", fontFamily: "monospace", fontSize: 12 }}>⚠ {error}</div>}

            {!loading && !error && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 && (
                  <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>
                    <div style={{ fontSize: 14, color: "rgba(255,255,255,0.7)", marginBottom: 8 }}>{items.length === 0 ? "Your inventory is empty" : "No items match these filters"}</div>
                    <button onClick={items.length === 0 ? () => setAdding(true) : clearFilters} style={{ background: "rgba(129,140,248,0.14)", border: "1px solid rgba(129,140,248,0.3)", color: "#a5b4fc", borderRadius: 8, padding: "8px 12px", fontFamily: "monospace", fontSize: 11 }}>
                      {items.length === 0 ? "Add your first item" : "Clear filters"}
                    </button>
                  </div>
                )}
                {filtered.map(item => (
                  <ItemCard key={item.id} {...itemCardProps(item)} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ORDERS TAB */}
        {tab === "orders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {needToOrder.length === 0 && awaitingShipment.length === 0 ? (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 4 }}>All stocked up</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>Nothing needs to be ordered</div>
              </div>
            ) : (
              <>
                {needToOrder.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>
                      NEED TO ORDER ({needToOrder.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {needToOrder.map(item => <ItemCard key={item.id} {...itemCardProps(item)} />)}
                    </div>
                  </>
                )}
                {awaitingShipment.length > 0 && (
                  <>
                    <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", fontFamily: "monospace", marginTop: 8 }}>
                      ALREADY COMING ({awaitingShipment.length})
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {awaitingShipment.map(item => <ItemCard key={item.id} {...itemCardProps(item)} />)}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {adding && (
        <Modal title="Add Item" onClose={() => setAdding(false)}>
          <ItemForm onSave={addItem} onClose={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  );
}
