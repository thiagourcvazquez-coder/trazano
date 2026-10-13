// TRAZANO — monitor de anomalías
//
// Reconstruye la cadena de custodia desde los eventos de BatchRegistry y
// FETVault y verifica dos invariantes:
//
//   1. Balance de masa: packs declarados <= kg insumidos / KG_POR_PACK.
//   2. FET: el aporte depositado cubre el esperado (packs * precio * alícuota).
//
// Cada inconsistencia se eleva onchain en AlertRegistry con la identidad del
// inspector. La alerta no prueba que hubo fraude: prueba que la inconsistencia
// existe en lo registrado y queda atribuible a un actor identificable.
//
// Uso:
//   node monitor.js            sondea cada POLL_MS (default 5s)
//   node monitor.js --once     una pasada y sale
//   node monitor.js --dry      detecta pero no postea onchain
//
// Config: deployed.json (lo genera contracts/scripts/seed.js) o env:
//   RPC_URL, BATCH_REGISTRY, FET_VAULT, ALERT_REGISTRY, INSPECTOR_KEY

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const KG_POR_PACK = 0.02; // ~20 g por pack de 20 cig. Supuesto declarado.
const POLL_MS = Number(process.env.POLL_MS || 5000);
const DRY = process.argv.includes("--dry");

const BATCHES_ABI = [
  "event BatchCreated(uint256 indexed id, uint8 stage, address indexed holder, uint256 kg, uint256 packs, uint256 pricePerPack, bytes32 dataHash, uint256[] inputs)",
];
const VAULT_ABI = [
  "event ContributionRecorded(uint256 indexed packLotId, address indexed payer, uint256 expected, uint256 deposited, bool discrepancy)",
];
const ALERTS_ABI = [
  "function raiseAlert(uint256 packLotId, bytes32 alertType, bytes32 detailsHash) returns (uint256)",
  "event AlertRaised(uint256 indexed alertIndex, uint256 indexed packLotId, bytes32 alertType, bytes32 detailsHash, address indexed inspector)",
];
const ALERT_TYPES = ["BALANCE_DE_MASA", "FET_INCOMPLETO"];

function loadConfig() {
  const p = path.join(__dirname, "deployed.json");
  const file = fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
  return {
    rpcUrl: process.env.RPC_URL || file.rpcUrl || "http://127.0.0.1:8545",
    batches: process.env.BATCH_REGISTRY || file.batches,
    vault: process.env.FET_VAULT || file.vault,
    alerts: process.env.ALERT_REGISTRY || file.alerts,
    inspectorKey: process.env.INSPECTOR_KEY || file.inspectorKey || null,
    deployBlock:
      Number(process.env.DEPLOY_BLOCK || file.deployBlock || 0) || undefined,
  };
}

// Monad testnet limita eth_getLogs a ~100 bloques por llamada y el RPC
// público a ~25 req/s: una sola pasada paginada con array de addresses +
// topics OR, después decodificamos cada log con su contrato.
const LOG_CHUNK = 99;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function allLogs(provider, addresses, topics0, fromBlock) {
  const latest = await provider.getBlockNumber();
  const out = [];
  for (let from = fromBlock; from <= latest; from += LOG_CHUNK) {
    const to = Math.min(from + LOG_CHUNK - 1, latest);
    out.push(
      ...await provider.getLogs({
        address: addresses,
        topics: [topics0],
        fromBlock: from,
        toBlock: to,
      })
    );
    await sleep(80);
  }
  return out;
}

function detect(batchMap, contribs) {
  const alerts = [];
  for (const b of batchMap.values()) {
    if (b.stage !== 2) continue;
    const soportados = Math.floor(b.kg / KG_POR_PACK);
    if (b.packs > soportados) {
      alerts.push({
        type: "BALANCE_DE_MASA",
        packLotId: b.id,
        detalle: `declaró ${b.packs} packs pero los insumos (${b.kg} kg) soportan ~${soportados}`,
        actor: b.holder,
      });
    }
  }
  for (const c of contribs) {
    if (c.discrepancy) {
      alerts.push({
        type: "FET_INCOMPLETO",
        packLotId: c.packLotId,
        detalle:
          `aportó ${ethers.formatUnits(c.deposited, 6)} mUSD; esperado ` +
          `${ethers.formatUnits(c.expected, 6)} mUSD`,
        actor: c.payer,
      });
    }
  }
  return alerts;
}

async function scan(cfg, provider, knownAlerts) {
  const batches = new ethers.Contract(cfg.batches, BATCHES_ABI, provider);
  const vault = cfg.vault ? new ethers.Contract(cfg.vault, VAULT_ABI, provider) : null;
  const inspectorWallet = cfg.inspectorKey
    ? new ethers.Wallet(cfg.inspectorKey, provider)
    : null;
  const alertContract =
    cfg.alerts && inspectorWallet && !DRY
      ? new ethers.Contract(cfg.alerts, ALERTS_ABI, inspectorWallet)
      : null;
  // nonce explícito: hardhat con automining puede devolver un nonce viejo
  let nonce = inspectorWallet
    ? await provider.getTransactionCount(inspectorWallet.address, "pending")
    : null;

  const batchTopic = batches.interface.getEvent("BatchCreated").topicHash;
  const contribTopic = vault
    ? vault.interface.getEvent("ContributionRecorded").topicHash
    : null;
  const alertTopic = alertContract
    ? alertContract.interface.getEvent("AlertRaised").topicHash
    : null;

  const addrs = [cfg.batches, cfg.vault, alertContract ? cfg.alerts : null].filter(Boolean);
  const topics = [batchTopic, contribTopic, alertTopic].filter(Boolean);
  const logs = await allLogs(provider, addrs, topics, cfg.deployBlock || 0);

  const created = [], contribsEv = [], raisedEv = [];
  for (const l of logs) {
    const t = l.topics[0];
    if (t === batchTopic) {
      created.push({ args: batches.interface.parseLog(l).args });
    } else if (t === contribTopic) {
      contribsEv.push({ args: vault.interface.parseLog(l).args });
    } else if (t === alertTopic) {
      raisedEv.push({ args: alertContract.interface.parseLog(l).args });
    }
  }

  const batchMap = new Map();
  for (const e of created) {
    const [id, stage, holder, kg, packs, pricePerPack, , inputs] = e.args;
    batchMap.set(Number(id), {
      id: Number(id), stage: Number(stage), holder,
      kg: Number(kg), packs: Number(packs), inputs: inputs.map(Number),
    });
  }
  const contribs = contribsEv.map((e) => ({
    packLotId: Number(e.args[0]), payer: e.args[1],
    expected: e.args[2], deposited: e.args[3], discrepancy: e.args[4],
  }));

  const alerts = detect(batchMap, contribs);

  // Ya elevadas onchain (dedupe entre corridas)
  for (const e of raisedEv) {
    const packLotId = Number(e.args[1]);
    const typeHash = e.args[2];
    for (const t of ALERT_TYPES) {
      if (ethers.keccak256(ethers.toUtf8Bytes(t)) === typeHash) {
        knownAlerts.add(`${t}:${packLotId}`);
      }
    }
  }

  // Elevar onchain solo las nuevas (clave = tipo+lote)
  if (alertContract) {
    for (const a of alerts) {
      const key = `${a.type}:${a.packLotId}`;
      if (knownAlerts.has(key)) {
        a.onchain = "ya emitida";
        continue;
      }
      const detailsHash = ethers.keccak256(
        ethers.toUtf8Bytes(JSON.stringify(a))
      );
      const tx = await alertContract.raiseAlert(
        a.packLotId,
        ethers.keccak256(ethers.toUtf8Bytes(a.type)),
        detailsHash,
        { nonce: nonce++ }
      );
      await tx.wait();
      knownAlerts.add(key);
      a.onchain = tx.hash;
    }
  } else {
    for (const a of alerts) {
      const key = `${a.type}:${a.packLotId}`;
      a.onchain = knownAlerts.has(key) ? "ya emitida" : DRY ? "dry-run" : null;
      knownAlerts.add(key);
    }
  }

  const report = {
    generado: new Date().toISOString(),
    lotes: batchMap.size,
    aportes: contribs.length,
    alertas: alerts,
  };
  fs.writeFileSync(
    path.join(__dirname, "alerts.json"),
    JSON.stringify(report, null, 2)
  );
  return report;
}

async function main() {
  const cfg = loadConfig();
  if (!cfg.batches) {
    console.error("Falta BatchRegistry. Corré `npm run seed` en contracts/ primero.");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
  const knownAlerts = new Set();

  const run = async () => {
    const r = await scan(cfg, provider, knownAlerts);
    console.log(
      `[${r.generado}] lotes=${r.lotes} aportes=${r.aportes} alertas=${r.alertas.length}`
    );
    for (const a of r.alertas) {
      console.log(
        `  ⚠ ${a.type} · lote #${a.packLotId}: ${a.detalle}` +
          (a.onchain ? ` → onchain ${String(a.onchain).slice(0, 18)}…` : "")
      );
    }
  };

  if (process.argv.includes("--once")) return run();
  console.log(
    `Monitor TRAZANO — ${cfg.rpcUrl} cada ${POLL_MS}ms` +
      (DRY ? " (dry-run)" : cfg.inspectorKey ? " (posteando onchain)" : "")
  );
  await run();
  setInterval(() => run().catch(console.error), POLL_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
