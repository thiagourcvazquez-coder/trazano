"use client";
import { useEffect, useMemo, useState } from "react";

const stagePill = (s) =>
  s === "Hoja" ? "leaf" : s === "Procesado" ? "proc" : "packs";
const fmt = (n) => Number(n).toLocaleString("es-AR");

function Bar({ label, value, max, danger }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="barrow">
      <div className="barlabel">{label}</div>
      <div className="bartrack">
        <div
          className={`barfill ${danger ? "danger" : ""}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={`barval ${danger ? "bad" : ""}`}>{fmt(Math.round(value * 100) / 100)}</div>
    </div>
  );
}

export default function Dashboard() {
  const [s, setS] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null); // pack lot seleccionado

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

  const packLots = useMemo(
    () => (s ? s.batches.filter((b) => b.stageN === 2) : []),
    [s]
  );
  // por defecto: el lote con alerta, si no el último
  const lot = useMemo(() => {
    if (!s || packLots.length === 0) return null;
    if (sel != null) return packLots.find((b) => b.id === sel) || packLots[0];
    const conAlerta = packLots.find((b) =>
      s.alerts.some((a) => a.packLotId === b.id)
    );
    return conAlerta || packLots[packLots.length - 1];
  }, [s, packLots, sel]);

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
  if (!s) return <p className="sub">Cargando…</p>;

  // cadena hacia atrás del lote seleccionado
  const chain = [];
  if (lot) {
    let cur = lot;
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      chain.unshift(cur);
      cur = cur.inputs?.length ? s.batches.find((b) => b.id === cur.inputs[0]) : null;
    }
  }
  const leaf = chain.find((b) => b.stageN === 0);
  const proc = chain.find((b) => b.stageN === 1);
  const contrib = lot && s.contributions.find((c) => c.packLotId === lot.id);
  const lotAlerts = lot ? s.alerts.filter((a) => a.packLotId === lot.id) : [];

  const packsEsperados = lot ? Math.floor(lot.kg / s.kgPorPack) : 0;
  const packsSinDeclarar = Math.max(0, (lot?.packs || 0) - packsEsperados);
  const diferenciaFet = contrib
    ? Math.max(0, parseFloat(contrib.expected) - parseFloat(contrib.deposited))
    : 0;
  const hayDiscrepancia = packsSinDeclarar > 0 || (contrib && contrib.discrepancy);
  const pctPrecio = lot
    ? Math.round((1 - parseFloat(lot.pricePerPack) / s.refPricePack) * 100)
    : 0;

  return (
    <>
      <div className="hero">
        <h1>
          {hayDiscrepancia
            ? "Lo declarado no cierra con el tabaco que entró"
            : "La cadena cierra: todo lo declarado tiene respaldo"}
        </h1>
        <div className="sub">
          // lote {lot ? `L-2026-04${lot.id}` : "—"} ·{" "}
          {lot ? lot.holderName : ""} · Monad testnet · refresh 3s
        </div>
        {packLots.length > 1 && (
          <div className="tabs">
            {packLots.map((b) => (
              <button
                key={b.id}
                className={`tab ${lot?.id === b.id ? "on" : ""}`}
                onClick={() => setSel(b.id)}
              >
                Lote #{b.id}
                {s.alerts.some((a) => a.packLotId === b.id) ? " · ⚠" : ""}
              </button>
            ))}
          </div>
        )}
      </div>

      {lot && (
        <div className="duo">
          {/* Discrepancia de balance de masa */}
          <div className={`card big ${hayDiscrepancia ? "discrep" : ""}`}>
            <span className={`badge ${hayDiscrepancia ? "red" : "green"}`}>
              {hayDiscrepancia ? "Discrepancia activa" : "Sin discrepancias"}
            </span>
            <div className="bignum">
              {hayDiscrepancia
                ? `${fmt(packsSinDeclarar)} packs sin respaldo`
                : `${fmt(lot.packs)} packs verificados`}
            </div>
            <p className="meta">
              Entraron {fmt(lot.kg)} kg de tabaco; con {s.kgPorPack} kg/pack se
              esperaban ~{fmt(packsEsperados)} packs. La cigarrera declaró{" "}
              {fmt(lot.packs)} a {lot.pricePerPack} mUSD c/u
              {pctPrecio !== 0 &&
                ` — ${Math.abs(pctPrecio)}% por ${
                  pctPrecio > 0 ? "debajo" : "encima"
                } de la referencia`}
              .
            </p>
            <Bar label="Packs esperados" value={packsEsperados} max={packsEsperados} />
            <Bar
              label="Packs declarados"
              value={lot.packs}
              max={Math.max(packsEsperados, lot.packs)}
              danger={lot.packs !== packsEsperados}
            />
            <Bar label="Precio de referencia" value={s.refPricePack} max={s.refPricePack} />
            <Bar
              label="Precio declarado"
              value={parseFloat(lot.pricePerPack)}
              max={s.refPricePack}
              danger={pctPrecio !== 0}
            />
            {lotAlerts.some((a) => a.onchainTx) && (
              <a
                className="btnlink"
                href={`${s.explorerBase}${lotAlerts.find((a) => a.onchainTx).onchainTx}`}
                target="_blank"
                rel="noreferrer"
              >
                Ver firma en el explorador →
              </a>
            )}
          </div>

          {/* FET */}
          <div className="card big">
            <h3>Fondo Especial del Tabaco</h3>
            <p className="meta">Aporte del {s.fetRateBps}% sobre packs × precio.</p>
            {contrib ? (
              <>
                <div className="fetnums">
                  <div>
                    <div className="l">Correspondía</div>
                    <div className="v">${fmt(contrib.expected)}</div>
                  </div>
                  <div>
                    <div className="l">Depositado</div>
                    <div className="v">${fmt(contrib.deposited)}</div>
                  </div>
                  <div>
                    <div className="l">Diferencia</div>
                    <div className="v" style={{ color: diferenciaFet > 0 ? "#f87171" : "#b49dff" }}>
                      ${fmt(diferenciaFet)}
                    </div>
                  </div>
                </div>
                <div className="splitbar">
                  <span style={{ width: `${s.split.productores}%`, background: "#836ef9" }} />
                  <span style={{ width: `${s.split.social}%`, background: "#34d399" }} />
                  <span style={{ width: `${s.split.municipios}%`, background: "#565280" }} />
                </div>
                <div className="splitlabels">
                  <span>Productores {s.split.productores}%</span>
                  <span>Seguridad social {s.split.social}%</span>
                  <span>Municipios {s.split.municipios}%</span>
                </div>
                <p className="meta">Los porcentajes están fijos en el contrato. Nadie — ni la plataforma — puede retener ni redirigir el depósito.</p>
              </>
            ) : (
              <p className="meta">Este lote todavía no declaró aporte al FET.</p>
            )}
          </div>
        </div>
      )}

      {lot && (
        <div className="card big">
          <h3>Cadena del lote</h3>
          <p className="meta">Cada paso lo firman quien entrega y quien recibe.</p>
          <div className={`chainline ${hayDiscrepancia ? "withred" : ""}`} />
          <div className="chaincols">
            <div>
              <b>Productor</b>
              <div className="meta">{leaf ? `${fmt(leaf.kg)} kg` : "—"}</div>
              <div className="mono dim">{leaf ? leaf.holder.slice(0, 10) + "…" : ""}</div>
            </div>
            <div>
              <b>Acopio</b>
              <div className="meta">{proc ? `Recibió · salió ${fmt(proc.kg)} kg` : "—"}</div>
              <div className="mono dim">{proc ? proc.holder.slice(0, 10) + "…" : ""}</div>
            </div>
            <div>
              <b>Cigarrera</b>
              <div className="meta">{fmt(lot.packs)} packs declarados</div>
              <div className="mono dim">{lot.holder.slice(0, 10)}…</div>
            </div>
            <div>
              <b>Pack con QR</b>
              <div className="meta"><a href={`/lote/${lot.id}`}>/lote/SLT-{String(lot.id).padStart(4, "0")}</a></div>
              <div className="meta">verificable por cualquiera</div>
            </div>
          </div>
        </div>
      )}

      <h2>Todos los lotes</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>#</th><th>Etapa</th><th>Titular</th><th>Kg</th><th>Packs</th><th>Estado</th><th>Insumos</th></tr>
          </thead>
          <tbody>
            {s.batches.map((b) => (
              <tr key={b.id}>
                <td><a href={`/lote/${b.id}`}>#{b.id}</a></td>
                <td><span className={`pill ${stagePill(b.stage)}`}>{b.stage}</span></td>
                <td>{b.holderName}</td>
                <td>{b.kg || "—"}</td>
                <td>{b.packs ? fmt(b.packs) : "—"}</td>
                <td>{b.status}</td>
                <td className="mono">{b.inputs.length ? b.inputs.map((i) => `#${i}`).join(", ") : "—"}</td>
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
    </>
  );
}
