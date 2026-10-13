"use client";
import { useEffect, useState } from "react";

const stagePill = (s) =>
  s === "Hoja" ? "leaf" : s === "Procesado" ? "proc" : "packs";

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/state")
        .then((r) => r.json())
        .then((d) => (d.error ? setErr(d.error) : setS(d)))
        .catch((e) => setErr(e.message));
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  if (err)
    return (
      <div className="alert">
        <b>No hay chain disponible.</b>
        <div className="meta">
          Levantá el nodo y el seed: <code>cd contracts && npm run node</code> y{" "}
          <code>npm run seed</code>. Detalle: {err}
        </div>
      </div>
    );
  if (!s) return <p>Cargando…</p>;

  const totalKg = s.batches.filter((b) => b.stageN === 0).reduce((a, b) => a + b.kg, 0);
  const totalPacks = s.batches.filter((b) => b.stageN === 2).reduce((a, b) => a + b.packs, 0);
  const totalFET = s.contributions.reduce((a, c) => a + parseFloat(c.deposited), 0);

  return (
    <>
      <h1>Panel del inspector</h1>
      <div className="sub">Cadena de custodia del tabaco · Monad testnet · actualiza cada 3s</div>

      {s.alerts.length > 0 && (
        <>
          <h2>⚠ Alertas de inconsistencia</h2>
          {s.alerts.map((a, i) => (
            <div className="alert" key={i}>
              <b>{a.type}</b> — lote #{a.packLotId}
              <div className="meta">{a.detalle} · atribuido a: {a.actor}</div>
              {a.onchainTx && (
                <div className="onchain">
                  ✓ elevada onchain por el inspector · tx {a.onchainTx.slice(0, 18)}…
                </div>
              )}
            </div>
          ))}
        </>
      )}

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="kpi"><div className="v">{totalKg.toLocaleString("es-AR")} kg</div><div className="l">Tabaco registrado (hoja)</div></div>
        <div className="kpi"><div className="v">{totalPacks.toLocaleString("es-AR")}</div><div className="l">Packs declarados</div></div>
        <div className="kpi"><div className="v">{totalFET.toLocaleString("es-AR")} mUSD</div><div className="l">Aportado al FET</div></div>
        <div className="kpi"><div className="v" style={{ color: s.alerts.length ? "#ef4444" : "#4ade80" }}>{s.alerts.length}</div><div className="l">Anomalías detectadas</div></div>
      </div>

      <h2>Lotes</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>#</th><th>Etapa</th><th>Titular</th><th>Kg</th><th>Packs</th><th>Precio/pack</th><th>Estado</th><th>Insumos</th></tr>
          </thead>
          <tbody>
            {s.batches.map((b) => (
              <tr key={b.id}>
                <td><a href={`/lote/${b.id}`}>#{b.id}</a></td>
                <td><span className={`pill ${stagePill(b.stage)}`}>{b.stage}</span></td>
                <td>{b.holderName}</td>
                <td>{b.kg || "—"}</td>
                <td>{b.packs ? b.packs.toLocaleString("es-AR") : "—"}</td>
                <td>{b.stageN === 2 ? `${b.pricePerPack} mUSD` : "—"}</td>
                <td>{b.status}</td>
                <td className="mono">{b.inputs.length ? b.inputs.map((i) => `#${i}`).join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Aportes al FET (alícuota {s.fetRateBps}%)</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>Lote packs</th><th>Pagador</th><th>Esperado</th><th>Depositado</th><th>¿Cierra?</th><th>Reparto 60/30/10</th></tr>
          </thead>
          <tbody>
            {s.contributions.map((c) => (
              <tr key={c.packLotId}>
                <td><a href={`/lote/${c.packLotId}`}>#{c.packLotId}</a></td>
                <td>{c.payerName}</td>
                <td>{parseFloat(c.expected).toLocaleString("es-AR")} mUSD</td>
                <td>{parseFloat(c.deposited).toLocaleString("es-AR")} mUSD</td>
                <td className={c.discrepancy ? "bad" : "ok"}>{c.discrepancy ? "DISCREPANCIA" : "OK"}</td>
                <td className="mono">
                  {c.reparto ? `${c.reparto.productores} / ${c.reparto.social} / ${c.reparto.municipios}` : "sin repartir"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Actores registrados</h2>
      <div className="card">
        <table>
          <thead><tr><th>Nombre</th><th>Rol</th><th>Dirección</th></tr></thead>
          <tbody>
            {s.actors.map((a) => (
              <tr key={a.address}>
                <td>{a.name}</td><td>{a.role}</td><td className="mono">{a.address}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="sub" style={{ marginTop: 18 }}>
        Contratos — batches {s.contracts.batches.slice(0, 10)}… · vault {s.contracts.vault.slice(0, 10)}… · alerts {s.contracts.alerts?.slice(0, 10)}…
      </p>
    </>
  );
}
