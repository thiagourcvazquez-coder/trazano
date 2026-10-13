"use client";
import { useEffect, useState } from "react";

// Vista pública: lo que ve cualquiera que escanea el QR de un pack.
export default function LotePage({ params }) {
  const id = Number(params.id);
  const [s, setS] = useState(null);

  useEffect(() => {
    fetch("/api/state").then((r) => r.json()).then(setS);
  }, [id]);

  if (!s) return <p>Cargando…</p>;
  const batch = s.batches.find((b) => b.id === id);
  if (!batch) return <p>Lote #{id} no encontrado.</p>;

  const chain = [];
  let cur = batch;
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.inputs?.length ? s.batches.find((b) => b.id === cur.inputs[0]) : null;
  }

  const contrib = s.contributions.find((c) => c.packLotId === id);
  const alerts = s.alerts.filter((a) => a.packLotId === id);

  return (
    <>
      <h1>Trazabilidad del lote #{id}</h1>
      <div className="sub">Cadena de custodia firmada · verificado onchain</div>

      <div className="steps">
        {chain.map((b, i) => (
          <span key={b.id} style={{ display: "contents" }}>
            <div className="step">
              <span className="who">{b.stage} · #{b.id}</span>
              {b.holderName}
              <span className="who">
                {b.stageN === 2 ? `${b.packs.toLocaleString("es-AR")} packs` : `${b.kg} kg`}
              </span>
            </div>
            {i < chain.length - 1 && <span className="arrow">→</span>}
          </span>
        ))}
      </div>

      {batch.stageN === 2 && (
        <div className="grid">
          <div className="kpi"><div className="v">{batch.packs.toLocaleString("es-AR")}</div><div className="l">Packs declarados</div></div>
          <div className="kpi"><div className="v">{batch.kg.toLocaleString("es-AR")} kg</div><div className="l">Tabaco insumido</div></div>
          <div className="kpi"><div className="v">{batch.pricePerPack} mUSD</div><div className="l">Precio declarado por pack</div></div>
        </div>
      )}

      {alerts.length > 0 && (
        <>
          <h2>⚠ Alertas sobre este lote</h2>
          {alerts.map((a, i) => (
            <div className="alert" key={i}>
              <b>{a.type}</b>
              <div className="meta">{a.detalle} · atribuido a: {a.actor}</div>
              {a.onchainTx && (
                <div className="onchain">✓ elevada onchain por el inspector · tx {a.onchainTx.slice(0, 18)}…</div>
              )}
            </div>
          ))}
        </>
      )}

      {contrib && (
        <>
          <h2>Aporte al FET</h2>
          <div className="card">
            <table>
              <tbody>
                <tr><td>Esperado (packs × precio × {s.fetRateBps}%)</td><td><b>{contrib.expected} mUSD</b></td></tr>
                <tr>
                  <td>Depositado</td>
                  <td className={contrib.discrepancy ? "bad" : "ok"}>
                    {contrib.deposited} mUSD {contrib.discrepancy ? "— DISCREPANCIA" : ""}
                  </td>
                </tr>
                {contrib.reparto && (
                  <tr>
                    <td>Reparto ejecutado</td>
                    <td className="mono">
                      productores {contrib.reparto.productores} · seguridad social {contrib.reparto.social} · municipios {contrib.reparto.municipios} mUSD
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <p className="sub" style={{ marginTop: 20 }}>
        Origen de la hoja: lote #{chain[0]?.id} — {chain[0]?.holderName}. Cada
        tramo quedó registrado con firma cruzada entre quien entrega y quien
        recibe. El QR del pack físico lleva a esta misma vista.
      </p>
    </>
  );
}
