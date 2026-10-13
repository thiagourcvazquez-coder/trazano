"use client";
import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";

// Vista pública del pack: lo que ve cualquiera que escanea el QR.
export default function LotePage({ params }) {
  const id = Number(params.id);
  const [s, setS] = useState(null);
  const [origin, setOrigin] = useState("");

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/state").then((r) => r.json()).then(setS);
  }, [id]);

  if (!s) return <p className="sub">Cargando…</p>;
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
  const verified = alerts.length === 0;
  const packCode = `SLT-${String(id).padStart(4, "0")}`;

  // FET por pack: aporte del lote repartido entre los packs declarados
  const perPack = contrib
    ? {
        correspondia: parseFloat(contrib.expected) / batch.packs,
        depositado: parseFloat(contrib.deposited) / batch.packs,
      }
    : null;

  return (
    <div className="packwrap">
      <div className="packcard">
        <div className="packhead">
          <div className="qrbox">
            <QRCodeSVG
              value={`${origin}/lote/${id}`}
              size={110}
              bgColor="#ffffff"
              fgColor="#0b0a14"
              level="M"
            />
          </div>
          <div>
            <span className={`badge ${verified ? "green" : "red"}`}>
              {verified ? "Verificado" : "No cierra con el fondo"}
            </span>
            <h1 style={{ marginTop: 8 }}>Pack {packCode}</h1>
            <div className="sub" style={{ marginBottom: 0 }}>
              // lote L-2026-04{id}
            </div>
          </div>
        </div>

        <div className="timeline">
          {chain.map((b) => (
            <div className="tlitem" key={b.id}>
              <div className={`tldot ${b.stageN === 2 && !verified ? "red" : ""}`} />
              <div>
                <b>
                  {b.holderName} <span className="dimrole">· {b.stage}</span>
                </b>
                <div className="meta">
                  {b.stageN === 0 && `Entregó ${fmt(b.kg)} kg`}
                  {b.stageN === 1 && `Recibió y reexpidió ${fmt(b.kg)} kg`}
                  {b.stageN === 2 &&
                    `Declaró este pack a ${b.pricePerPack} mUSD`}
                </div>
                <div className="mono dim">{b.holder.slice(0, 10)}…{b.holder.slice(-4)}</div>
              </div>
            </div>
          ))}
        </div>

        {perPack && (
          <>
            <h3 style={{ marginTop: 6 }}>Fondo del tabaco por este pack</h3>
            <div className="fetduo">
              <div className="fetcell">
                <div className="l">Correspondía</div>
                <div className="v">${perPack.correspondia.toFixed(2)}</div>
              </div>
              <div className={`fetcell ${!verified ? "red" : ""}`}>
                <div className="l">Se depositó</div>
                <div className="v">${perPack.depositado.toFixed(2)}</div>
              </div>
            </div>
          </>
        )}

        {alerts.map((a, i) => (
          <div className="alert" key={i} style={{ marginTop: 12 }}>
            <b>{a.type}</b>
            <div className="meta">{a.detalle}</div>
          </div>
        ))}

        <a
          className="btnlink block"
          href={`${s.explorerBase}${batch.txHash}`}
          target="_blank"
          rel="noreferrer"
        >
          Verificar en el explorador de Monad →
        </a>
      </div>
      <p className="sub" style={{ textAlign: "center", marginTop: 14 }}>
        Cada tramo de la cadena quedó firmado por quien entrega y quien recibe.
      </p>
    </div>
  );
}

const fmt = (n) => Number(n).toLocaleString("es-AR");
