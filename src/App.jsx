import { useState, useEffect, useCallback } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:3000/home-os";

const CATEGORIES = ["Skin Care", "Hair Care", "Personal Care", "Cleaning Supplies"];
const LOCATIONS  = ["Kiehl's Bag", "Walk-in Closet", "Kitchen"];
const STATUSES   = ["normal", "need_to_order", "awaiting_shipment"];

const STATUS_LABEL  = { normal: "In Stock", need_to_order: "Need to Order", awaiting_shipment: "Awaiting Shipment" };
const STATUS_COLOR  = { normal: "#4ade80", need_to_order: "#f87171", awaiting_shipment: "#facc15" };
const CAT_COLOR     = { "Skin Care": "#818cf8", "Hair Care": "#06b6d4", "Personal Care": "#f97316", "Cleaning Supplies": "#4ade80" };

// ── API helpers ───────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: "#13131a", borderRadius: "16px 16px 0 0", width: "100%", maxWidth: 600, maxHeight: "90vh", overflow: "auto", padding: "20px 20px 40px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#fff" }}>{title}</div>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 8, width: 32, height: 32, fontSize: 16, cursor: "pointer" }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── Form field ────────────────────────────────────────────────────────────────
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
  color: "#fff", borderRadius: 8, padding: "9px 12px", fontSize: 13, fontFamily: "monospace",
  outline: "none",
};

function Select({ value, onChange, options }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{ ...inputStyle, appearance: "none" }}>
      {options.map(o => <option key={o} value={o} style={{ background: "#1a1a2e" }}>{o}</option>)}
    </select>
  );
}

// ── Item Form (Add / Edit) ────────────────────────────────────────────────────
function ItemForm({ initial = {}, onSave, onClose }) {
  const [form, setForm] = useState({
    name: "", brand: "", category: "Skin Care", location: "Walk-in Closet",
    size: "", form: "", quantity: 1, reorder_at: 1, notes: "",
    ...initial,
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  async function handleSave() {
    if (!form.name.trim()) return alert("Name is required");
    setSaving(true);
    try { await onSave(form); }
    finally { setSaving(false); }
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
        <Field label="CATEGORY">
          <Select value={form.category} onChange={v => set("category", v)} options={CATEGORIES} />
        </Field>
        <Field label="LOCATION">
          <Select value={form.location} onChange={v => set("location", v)} options={LOCATIONS} />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="SIZE">
          <input style={inputStyle} value={form.size} onChange={e => set("size", e.target.value)} placeholder="e.g. 1.7 fl oz" />
        </Field>
        <Field label="FORM">
          <input style={inputStyle} value={form.form} onChange={e => set("form", e.target.value)} placeholder="e.g. Tube, Jar, Bottle" />
        </Field>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <Field label="QUANTITY">
          <input style={inputStyle} type="number" min={0} value={form.quantity} onChange={e => set("quantity", Number(e.target.value))} />
        </Field>
        <Field label="REORDER AT (DEFAULT: 1)">
          <input style={inputStyle} type="number" min={0} value={form.reorder_at} onChange={e => set("reorder_at", Number(e.target.value))} />
        </Field>
      </div>
      <Field label="NOTES">
        <input style={inputStyle} value={form.notes} onChange={e => set("notes", e.target.value)} placeholder="Optional notes" />
      </Field>
      <button onClick={handleSave} disabled={saving} style={{
        marginTop: 8, background: "#818cf8", color: "#000", border: "none", borderRadius: 10,
        padding: "12px", fontSize: 13, fontFamily: "monospace", fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
        opacity: saving ? 0.6 : 1,
      }}>{saving ? "Saving..." : "Save Item"}</button>
    </div>
  );
}

// ── Item Card ─────────────────────────────────────────────────────────────────
function ItemCard({ item, onUpdate, onDelete }) {
  const [showActions, setShowActions] = useState(false);
  const [editing, setEditing] = useState(false);
  const [receivedQty, setReceivedQty] = useState("");
  const [showReceive, setShowReceive] = useState(false);

  const statusColor = STATUS_COLOR[item.status] || "#fff";
  const catColor = CAT_COLOR[item.category] || "#fff";
  const isLow = item.status === "need_to_order";
  const isAwaiting = item.status === "awaiting_shipment";

  async function decrement() {
    try { const updated = await apiFetch(`/items/${item.id}/decrement`, { method: "PATCH", body: JSON.stringify({ amount: 1 }) }); onUpdate(updated); }
    catch (e) { alert(e.message); }
  }

  async function increment() {
    try { const updated = await apiFetch(`/items/${item.id}/increment`, { method: "PATCH", body: JSON.stringify({ amount: 1 }) }); onUpdate(updated); }
    catch (e) { alert(e.message); }
  }

  async function setStatus(status) {
    try { const updated = await apiFetch(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify({ status }) }); onUpdate(updated); setShowActions(false); }
    catch (e) { alert(e.message); }
  }

  async function handleReceive() {
    if (!receivedQty) return;
    try {
      const updated = await apiFetch(`/items/${item.id}/received`, { method: "PATCH", body: JSON.stringify({ quantity: Number(receivedQty) }) });
      onUpdate(updated); setShowReceive(false); setReceivedQty("");
    } catch (e) { alert(e.message); }
  }

  async function handleEdit(form) {
    try { const updated = await apiFetch(`/items/${item.id}`, { method: "PATCH", body: JSON.stringify(form) }); onUpdate(updated); setEditing(false); }
    catch (e) { alert(e.message); }
  }

  async function handleDelete() {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    try { await apiFetch(`/items/${item.id}`, { method: "DELETE" }); onDelete(item.id); }
    catch (e) { alert(e.message); }
  }

  return (
    <>
      <div style={{
        background: isLow ? "rgba(248,113,113,0.06)" : isAwaiting ? "rgba(250,204,21,0.06)" : "rgba(255,255,255,0.03)",
        border: `1px solid ${isLow ? "rgba(248,113,113,0.2)" : isAwaiting ? "rgba(250,204,21,0.2)" : "rgba(255,255,255,0.07)"}`,
        borderRadius: 12, padding: "12px 14px",
      }}>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
          <div style={{ width: 3, height: 40, borderRadius: 2, background: catColor, flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#fff", lineHeight: 1.3 }}>{item.name}</div>
                {item.brand && <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", fontFamily: "monospace", marginTop: 1 }}>{item.brand}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                {/* Quantity controls */}
                <button onClick={decrement} style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 6, width: 28, height: 28, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>−</button>
                <span style={{ fontSize: 16, fontWeight: 700, color: statusColor, fontFamily: "monospace", minWidth: 20, textAlign: "center" }}>{item.quantity}</span>
                <button onClick={increment}
                  style={{ background: "rgba(255,255,255,0.08)", border: "none", color: "#fff", borderRadius: 6, width: 28, height: 28, fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>+</button>
              </div>
            </div>

            <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: `${catColor}20`, color: catColor, fontFamily: "monospace" }}>{item.category}</span>
              <span style={{ fontSize: 9, padding: "2px 7px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", fontFamily: "monospace" }}>{item.location}</span>
              {item.size && <span style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", fontFamily: "monospace" }}>{item.size}</span>}
              <span style={{ marginLeft: "auto", fontSize: 9, padding: "2px 7px", borderRadius: 4, background: `${statusColor}20`, color: statusColor, fontFamily: "monospace", fontWeight: 600 }}>
                {STATUS_LABEL[item.status]}
              </span>
            </div>

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              {item.status === "need_to_order" && (
                <button onClick={() => setStatus("awaiting_shipment")} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(250,204,21,0.15)", border: "1px solid rgba(250,204,21,0.3)", color: "#facc15", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
                  Mark Ordered →
                </button>
              )}
              {item.status === "awaiting_shipment" && (
                <button onClick={() => setShowReceive(true)} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(74,222,128,0.15)", border: "1px solid rgba(74,222,128,0.3)", color: "#4ade80", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
                  Mark Received →
                </button>
              )}
              {item.status === "normal" && (
                <button onClick={() => setStatus("need_to_order")} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", color: "#f87171", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
                  Need to Order
                </button>
              )}
              <button onClick={() => setEditing(true)} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(255,255,255,0.4)", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
                Edit
              </button>
              <button onClick={handleDelete} style={{ fontSize: 10, padding: "4px 8px", background: "rgba(255,0,0,0.06)", border: "1px solid rgba(255,0,0,0.12)", color: "rgba(255,80,80,0.5)", borderRadius: 6, cursor: "pointer", fontFamily: "monospace" }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Receive modal */}
      {showReceive && (
        <Modal title="Mark as Received" onClose={() => setShowReceive(false)}>
          <div style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", fontFamily: "monospace", marginBottom: 14 }}>
            Enter the new quantity for <span style={{ color: "#fff" }}>{item.name}</span>
          </div>
          <Field label="NEW QUANTITY">
            <input style={inputStyle} type="number" min={0} value={receivedQty} onChange={e => setReceivedQty(e.target.value)} autoFocus placeholder="e.g. 3" />
          </Field>
          <button onClick={handleReceive} style={{ width: "100%", background: "#4ade80", color: "#000", border: "none", borderRadius: 10, padding: 12, fontSize: 13, fontFamily: "monospace", fontWeight: 700, cursor: "pointer", marginTop: 8 }}>
            Confirm Receipt
          </button>
        </Modal>
      )}

      {/* Edit modal */}
      {editing && (
        <Modal title="Edit Item" onClose={() => setEditing(false)}>
          <ItemForm initial={item} onSave={handleEdit} onClose={() => setEditing(false)} />
        </Modal>
      )}
    </>
  );
}

// ── Main App ──────────────────────────────────────────────────────────────────
export default function HomeOS() {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterCat, setFilterCat] = useState("all");
  const [filterLoc, setFilterLoc] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState("inventory");

  const loadItems = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filterCat !== "all") params.set("category", filterCat);
      if (filterLoc !== "all") params.set("location", filterLoc);
      if (filterStatus !== "all") params.set("status", filterStatus);
      const [data, statsData] = await Promise.all([
        apiFetch(`/items?${params}`),
        apiFetch("/stats"),
      ]);
      setItems(data);
      setStats(statsData);
      setError(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [filterCat, filterLoc, filterStatus]);

  useEffect(() => { loadItems(); }, [loadItems]);

  function updateItem(updated) {
    setItems(prev => prev.map(i => i.id === updated.id ? updated : i));
    apiFetch("/stats").then(setStats).catch(() => {});
  }

  function deleteItem(id) {
    setItems(prev => prev.filter(i => i.id !== id));
    apiFetch("/stats").then(setStats).catch(() => {});
  }

  async function addItem(form) {
    const created = await apiFetch("/items", { method: "POST", body: JSON.stringify(form) });
    setItems(prev => [created, ...prev]);
    setAdding(false);
    apiFetch("/stats").then(setStats).catch(() => {});
  }

  const filtered = items.filter(i => {
    if (search && !i.name.toLowerCase().includes(search.toLowerCase()) && !i.brand?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Group by status for the order list
  const needToOrder = items.filter(i => i.status === "need_to_order");
  const awaitingShipment = items.filter(i => i.status === "awaiting_shipment");

  const tabs = [
    { key: "inventory", label: "Inventory" },
    { key: "orders", label: `Orders ${needToOrder.length + awaitingShipment.length > 0 ? `(${needToOrder.length + awaitingShipment.length})` : ""}` },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#09090e", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" }}>
      <style>{`* { box-sizing: border-box; margin: 0; padding: 0; } ::-webkit-scrollbar { width: 3px; } ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); } input, select { outline: none; }`}</style>

      {/* Header */}
      <div style={{ padding: "18px 16px 0", borderBottom: "1px solid rgba(255,255,255,0.06)", position: "sticky", top: 0, background: "#09090e", zIndex: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", letterSpacing: "-0.02em" }}>Home <span style={{ color: "#818cf8" }}>OS</span></div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,0.2)", fontFamily: "monospace", letterSpacing: "0.1em", marginTop: 1 }}>
              {stats ? `${stats.total_items} items · ${stats.total_units} units` : "Loading..."}
            </div>
          </div>
          <button onClick={() => setAdding(true)} style={{ background: "#818cf8", color: "#000", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontFamily: "monospace", fontWeight: 700, cursor: "pointer" }}>+ Add Item</button>
        </div>

        {/* Stats pills */}
        {stats && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {[
              { label: "In Stock", val: stats.in_stock, color: "#4ade80" },
              { label: "Need to Order", val: stats.need_to_order, color: "#f87171" },
              { label: "Awaiting", val: stats.awaiting_shipment, color: "#facc15" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", background: `${color}12`, border: `1px solid ${color}30`, borderRadius: 20 }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: color }} />
                <span style={{ fontSize: 10, color, fontFamily: "monospace" }}>{val} {label}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: "flex" }}>
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              background: "none", border: "none", padding: "7px 12px", fontSize: 11, fontFamily: "monospace",
              color: tab === t.key ? "#fff" : "rgba(255,255,255,0.3)",
              borderBottom: tab === t.key ? "2px solid #818cf8" : "2px solid transparent",
              cursor: "pointer", transition: "all 0.15s",
            }}>{t.label}</button>
          ))}
        </div>
      </div>

      <div style={{ padding: "14px 16px", maxWidth: 680, margin: "0 auto" }}>

        {/* INVENTORY TAB */}
        {tab === "inventory" && (
          <>
            {/* Search + filters */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search items or brands..." style={{ ...inputStyle, fontSize: 12 }} />
              <div style={{ display: "flex", gap: 8 }}>
                <select value={filterCat} onChange={e => setFilterCat(e.target.value)} style={{ ...inputStyle, flex: 1, appearance: "none", fontSize: 11 }}>
                  <option value="all">All Categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c} style={{ background: "#1a1a2e" }}>{c}</option>)}
                </select>
                <select value={filterLoc} onChange={e => setFilterLoc(e.target.value)} style={{ ...inputStyle, flex: 1, appearance: "none", fontSize: 11 }}>
                  <option value="all">All Locations</option>
                  {LOCATIONS.map(l => <option key={l} value={l} style={{ background: "#1a1a2e" }}>{l}</option>)}
                </select>
                <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ ...inputStyle, flex: 1, appearance: "none", fontSize: 11 }}>
                  <option value="all">All Status</option>
                  {STATUSES.map(s => <option key={s} value={s} style={{ background: "#1a1a2e" }}>{STATUS_LABEL[s]}</option>)}
                </select>
              </div>
            </div>

            {loading && <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>Loading...</div>}
            {error && <div style={{ padding: 16, background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: 10, color: "#f87171", fontFamily: "monospace", fontSize: 12 }}>⚠ {error}</div>}

            {!loading && !error && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {filtered.length === 0 && (
                  <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>No items found</div>
                )}
                {filtered.map(item => (
                  <ItemCard key={item.id} item={item} onUpdate={updateItem} onDelete={deleteItem} />
                ))}
              </div>
            )}
          </>
        )}

        {/* ORDERS TAB */}
        {tab === "orders" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {needToOrder.length === 0 && awaitingShipment.length === 0 && (
              <div style={{ textAlign: "center", padding: 60 }}>
                <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#fff", marginBottom: 4 }}>All stocked up</div>
                <div style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", fontFamily: "monospace" }}>Nothing needs to be ordered right now</div>
              </div>
            )}

            {needToOrder.length > 0 && (
              <>
                <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", fontFamily: "monospace" }}>NEED TO ORDER ({needToOrder.length})</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {needToOrder.map(item => <ItemCard key={item.id} item={item} onUpdate={updateItem} onDelete={deleteItem} />)}
                </div>
              </>
            )}

            {awaitingShipment.length > 0 && (
              <>
                <div style={{ fontSize: 9, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(255,255,255,0.2)", fontFamily: "monospace", marginTop: 8 }}>AWAITING SHIPMENT ({awaitingShipment.length})</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {awaitingShipment.map(item => <ItemCard key={item.id} item={item} onUpdate={updateItem} onDelete={deleteItem} />)}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Add Item Modal */}
      {adding && (
        <Modal title="Add Item" onClose={() => setAdding(false)}>
          <ItemForm onSave={addItem} onClose={() => setAdding(false)} />
        </Modal>
      )}
    </div>
  );
}
