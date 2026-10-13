"use client";
import { useEffect, useState } from "react";

// Panel de acciones por rol. En demo local firma el nodo con la cuenta del
// actor; en producción sería la wallet del usuario (Privy/passkey).
export default function Acciones() {
  const [s, setS] = useState(null);
  const [role, setRole] = useState("Productor");
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => fetch("/api/state").then((r) => r.json()).then(setS);
  useEffect(() => { load(); }, []);

  const actor = s?.actors.find((a) => a.role === role);

  async function send(action, params) {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, params: { ...params, from: actor.address } }),
    }).then((r) => r.json());
    setBusy(false);
    if (res.error) setMsg({ err: res.error });
    else {
      setMsg({ ok: `TX enviada: ${res.txHash.slice(0, 18)}…` });
      setTimeout(load, 800);
    }
  }

  const F = ({ children, onSubmit, label }) => (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(Object.fromEntries(new FormData(e.target)));
      }}
    >
      {children}
      <button disabled={busy}>{label}</button>
    </form>
  );

  if (!s) return <p>Cargando…</p>;

  const myPending = s.pendingTransfers.filter(
    (t) => t.to.toLowerCase() === actor?.address.toLowerCase()
  );
  const myBatches = s.batches.filter(
    (b) => b.holder.toLowerCase() === actor?.address?.toLowerCase() && b.status === "Activo"
  );
  const otrosActores = s.actors.filter((a) => a.address !== actor?.address);

  return (
    <>
      <h1>Acciones por rol</h1>
      <div className="sub">
        // operás como: <b>{actor?.name}</b>{" "}
        <span className="mono">({actor?.address?.slice(0, 10)}…)</span>
      </div>

      <div style={{ marginBottom: 18 }}>
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          <option>Productor</option><option>Acopio</option>
          <option>Cigarrera</option><option>Inspector</option>
        </select>
      </div>

      {myPending.length > 0 && (
        <div className="card">
          <b>Transferencias pendientes para vos:</b>
          {myPending.map((t) => (
            <div key={t.id} style={{ marginTop: 8 }}>
              Lote #{t.id} —{" "}
              <button onClick={() => send("aceptarTransferencia", { id: t.id })}>
                Aceptar recepción
              </button>
            </div>
          ))}
        </div>
      )}

      {role === "Productor" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Registrar entrega de fardos</h2>
          <F label="Crear lote de hoja" onSubmit={(d) => send("crearHoja", d)}>
            <div><label>Kg de tabaco</label><input name="kg" type="number" required /></div>
            <div><label>Referencia (finca/lote)</label><input name="ref" placeholder="finca-cardon-lote-3" /></div>
          </F>
          <h2>Proponer transferencia al acopio</h2>
          <F label="Proponer" onSubmit={(d) => send("proponerTransferencia", d)}>
            <div><label>Lote</label>
              <select name="id">{myBatches.map((b) => <option key={b.id} value={b.id}>#{b.id} · {b.kg} kg</option>)}</select>
            </div>
            <div><label>Destinatario (solo acopio)</label>
              <select name="to">{s.actors.filter((a) => a.role === "Acopio").map((a) => <option key={a.address} value={a.address}>{a.name}</option>)}</select>
            </div>
          </F>
        </div>
      )}

      {role === "Acopio" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Procesar (hoja → procesado)</h2>
          <F label="Emitir procesado" onSubmit={(d) => send("procesar", { ...d, inputIds: d.inputIds.split(",").filter(Boolean) })}>
            <div><label>Lotes de entrada (ids, coma)</label><input name="inputIds" placeholder="1" required /></div>
            <div><label>Kg procesados</label><input name="kgOut" type="number" required /></div>
            <div><label>Referencia</label><input name="ref" placeholder="proc-c" /></div>
          </F>
          <h2>Transferir procesado a la cigarrera</h2>
          <F label="Proponer" onSubmit={(d) => send("proponerTransferencia", d)}>
            <div><label>Lote</label>
              <select name="id">{myBatches.map((b) => <option key={b.id} value={b.id}>#{b.id} · {b.kg} kg</option>)}</select>
            </div>
            <div><label>Destinatario (solo cigarrera)</label>
              <select name="to">{s.actors.filter((a) => a.role === "Cigarrera").map((a) => <option key={a.address} value={a.address}>{a.name}</option>)}</select>
            </div>
          </F>
        </div>
      )}

      {role === "Cigarrera" && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Declarar packs (procesado → packs)</h2>
          <F label="Declarar lote de packs" onSubmit={(d) => send("declararPacks", { ...d, inputIds: d.inputIds.split(",").filter(Boolean) })}>
            <div><label>Lotes de entrada (ids, coma)</label><input name="inputIds" placeholder="2" required /></div>
            <div><label>Packs producidos</label><input name="packs" type="number" required /></div>
            <div><label>Precio por pack (mUSD)</label><input name="pricePerPack" type="number" step="0.01" required /></div>
          </F>

          <h2>Aporte al FET</h2>
          <F label="Declarar y depositar" onSubmit={(d) => send("aportarFET", d)}>
            <div><label>Lote de packs</label>
              <select name="packLotId">{s.batches.filter((b) => b.stageN === 2 && b.holder.toLowerCase() === actor.address.toLowerCase()).map((b) => <option key={b.id} value={b.id}>#{b.id} · {b.packs.toLocaleString("es-AR")} packs</option>)}</select>
            </div>
            <div><label>Monto a depositar (mUSD)</label><input name="amount" type="number" step="0.01" required /></div>
          </F>

          <h2>Ejecutar reparto</h2>
          <F label="Repartir" onSubmit={(d) => send("repartir", d)}>
            <div><label>Lote de packs</label>
              <select name="packLotId">{s.contributions.filter((c) => !c.reparto).map((c) => <option key={c.packLotId} value={c.packLotId}>#{c.packLotId}</option>)}</select>
            </div>
          </F>
        </div>
      )}

      {role === "Inspector" && (
        <div className="card">
          <p>
            El inspector audita desde el <a href="/">panel</a>. Las alertas que
            detecta el monitor se elevan onchain a <code>AlertRegistry</code> con
            su identidad: quedan atribuibles y verificables en el explorador.
          </p>
        </div>
      )}

      {msg?.ok && <div className="flash okm">{msg.ok}</div>}
      {msg?.err && <div className="flash err">{msg.err}</div>}
    </>
  );
}
