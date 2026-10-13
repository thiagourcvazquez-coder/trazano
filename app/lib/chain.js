// Acceso a la chain: lecturas y escrituras.
// En demo local el nodo hardhat tiene las cuentas desbloqueadas: el servidor
// firma directo con la address del actor. En testnet se reemplaza por la
// wallet del usuario (Privy/passkey).

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const BATCHES_ABI = [
  "event BatchCreated(uint256 indexed id, uint8 stage, address indexed holder, uint256 kg, uint256 packs, uint256 pricePerPack, bytes32 dataHash, uint256[] inputs)",
  "event TransferRequested(uint256 indexed id, address indexed from, address indexed to)",
  "event TransferAccepted(uint256 indexed id, address indexed from, address indexed to)",
  "function createLeafBatch(uint256 kg, bytes32 dataHash) returns (uint256)",
  "function transformToProcessed(uint256[] inputIds, uint256 kgOut, bytes32 dataHash) returns (uint256)",
  "function transformToPacks(uint256[] inputIds, uint256 packs, uint256 pricePerPack, bytes32 dataHash) returns (uint256)",
  "function requestTransfer(uint256 id, address to)",
  "function acceptTransfer(uint256 id)",
  "function cancelTransfer(uint256 id)",
  "function getBatch(uint256 id) view returns (tuple(uint256 id, uint8 stage, address holder, uint256 kg, uint256 packs, uint256 pricePerPack, bytes32 dataHash, uint256[] inputs, uint8 status, uint256 createdAt))",
  "function batchCount() view returns (uint256)",
];
const ACTORS_ABI = [
  "event ActorRegistered(address indexed actor, uint8 role, string name, bytes32 dataHash)",
  "function actors(address) view returns (uint8 role, string name, bytes32 dataHash, bool active, uint256 registeredAt)",
];
const VAULT_ABI = [
  "event ContributionRecorded(uint256 indexed packLotId, address indexed payer, uint256 expected, uint256 deposited, bool discrepancy)",
  "event Distributed(uint256 indexed packLotId, uint256 toProducers, uint256 toSocial, uint256 toMunicipalities)",
  "function declareAndDeposit(uint256 packLotId, uint256 deposit) returns (uint256)",
  "function distribute(uint256 packLotId)",
  "function fetRateBps() view returns (uint256)",
];
const ALERTS_ABI = [
  "event AlertRaised(uint256 indexed alertIndex, uint256 indexed packLotId, bytes32 alertType, bytes32 detailsHash, address indexed inspector)",
];
const TOKEN_ABI = [
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount)",
  "function balanceOf(address) view returns (uint256)",
];

const STAGE_NAME = { 0: "Hoja", 1: "Procesado", 2: "Packs" };
const STATUS_NAME = { 0: "Activo", 1: "En tránsito", 2: "Consumido" };
const ROLE_NAME = { 1: "Productor", 2: "Acopio", 3: "Cigarrera", 4: "Inspector" };
const KG_POR_PACK = 0.02; // mismo supuesto declarado del monitor

let _cfg;
function cfg() {
  if (!_cfg) {
    const p = path.join(process.cwd(), "..", "worker", "deployed.json");
    _cfg = fs.existsSync(p)
      ? JSON.parse(fs.readFileSync(p, "utf8"))
      : {
          rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
          actors: process.env.ACTOR_REGISTRY,
          batches: process.env.BATCH_REGISTRY,
          vault: process.env.FET_VAULT,
          alerts: process.env.ALERT_REGISTRY,
          token: process.env.TOKEN,
        };
  }
  return _cfg;
}

function provider() {
  return new ethers.JsonRpcProvider(cfg().rpcUrl);
}

const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "?");
const decodeAlertType = (h) => {
  // keccak256 no es reversible; comparamos contra los tipos conocidos
  for (const t of ["BALANCE_DE_MASA", "FET_INCOMPLETO"]) {
    if (ethers.keccak256(ethers.toUtf8Bytes(t)) === h) return t;
  }
  return h;
};

async function getState() {
  const c = cfg();
  const p = provider();
  const actors = new ethers.Contract(c.actors, ACTORS_ABI, p);
  const batches = new ethers.Contract(c.batches, BATCHES_ABI, p);
  const vault = new ethers.Contract(c.vault, VAULT_ABI, p);
  const alertsC = c.alerts ? new ethers.Contract(c.alerts, ALERTS_ABI, p) : null;

  const [actorEvents, created, requested, contribs, dists, raised] =
    await Promise.all([
      actors.queryFilter(actors.filters.ActorRegistered()),
      batches.queryFilter(batches.filters.BatchCreated()),
      batches.queryFilter(batches.filters.TransferRequested()),
      vault.queryFilter(vault.filters.ContributionRecorded()),
      vault.queryFilter(vault.filters.Distributed()),
      alertsC ? alertsC.queryFilter(alertsC.filters.AlertRaised()) : [],
    ]);

  const actorMap = {};
  for (const e of actorEvents) {
    const [addr, role, name] = e.args;
    actorMap[addr.toLowerCase()] = { address: addr, role: ROLE_NAME[role], name };
  }

  const batchList = [];
  const byId = {};
  for (const e of created) {
    const [id, stage, holder, kg, packs, pricePerPack, , inputs] = e.args;
    const b = {
      id: Number(id),
      stage: STAGE_NAME[Number(stage)],
      stageN: Number(stage),
      holder,
      holderName: actorMap[holder.toLowerCase()]?.name || short(holder),
      kg: Number(kg),
      packs: Number(packs),
      pricePerPack: ethers.formatUnits(pricePerPack, 6),
      inputs: inputs.map(Number),
      status: "Activo",
      txHash: e.transactionHash,
    };
    batchList.push(b);
    byId[b.id] = b;
  }
  for (const b of batchList) {
    const onchain = await batches.getBatch(b.id);
    b.holder = onchain.holder;
    b.holderName =
      actorMap[onchain.holder.toLowerCase()]?.name || short(onchain.holder);
    b.status = STATUS_NAME[Number(onchain.status)];
  }

  const pending = requested
    .map((e) => ({ id: Number(e.args[0]), from: e.args[1], to: e.args[2] }))
    .filter((r) => byId[r.id] && byId[r.id].status === "En tránsito");

  const contributions = contribs.map((e) => {
    const [packLotId, payer, expected, deposited, discrepancy] = e.args;
    return {
      packLotId: Number(packLotId),
      payer,
      payerName: actorMap[payer.toLowerCase()]?.name || short(payer),
      expected: ethers.formatUnits(expected, 6),
      deposited: ethers.formatUnits(deposited, 6),
      discrepancy,
      txHash: e.transactionHash,
    };
  });
  const distMap = {};
  for (const e of dists) {
    const [id, toProd, toSocial, toMun] = e.args;
    distMap[Number(id)] = {
      productores: ethers.formatUnits(toProd, 6),
      social: ethers.formatUnits(toSocial, 6),
      municipios: ethers.formatUnits(toMun, 6),
    };
  }
  for (const con of contributions) con.reparto = distMap[con.packLotId] || null;

  // alertas detectadas en vivo (misma lógica del monitor)
  const alerts = [];
  for (const b of batchList) {
    if (b.stageN === 2) {
      const soportados = Math.floor(b.kg / KG_POR_PACK);
      if (b.packs > soportados) {
        alerts.push({
          type: "BALANCE_DE_MASA",
          packLotId: b.id,
          detalle: `Declaró ${b.packs.toLocaleString("es-AR")} packs pero los insumos registrados (${b.kg} kg) soportan ~${soportados.toLocaleString("es-AR")}`,
          actor: b.holderName,
        });
      }
    }
  }
  for (const con of contributions) {
    if (con.discrepancy) {
      const falta = (parseFloat(con.expected) - parseFloat(con.deposited)).toFixed(2);
      alerts.push({
        type: "FET_INCOMPLETO",
        packLotId: con.packLotId,
        detalle: `Aportó ${con.deposited} mUSD; esperado ${con.expected} mUSD (faltan ${falta})`,
        actor: con.payerName,
      });
    }
  }

  // alertas elevadas onchain por el inspector (verificables en el explorador)
  const onchainAlerts = raised.map((e) => {
    const [idx, packLotId, typeHash, , inspector] = e.args;
    return {
      index: Number(idx),
      packLotId: Number(packLotId),
      type: decodeAlertType(typeHash),
      inspector,
      inspectorName: actorMap[inspector.toLowerCase()]?.name || short(inspector),
      txHash: e.transactionHash,
    };
  });
  // marcar cuáles alertas detectadas ya están onchain
  for (const a of alerts) {
    const on = onchainAlerts.find(
      (o) => o.packLotId === a.packLotId && o.type === a.type
    );
    a.onchainTx = on?.txHash || null;
  }

  return {
    actors: Object.values(actorMap),
    batches: batchList,
    pendingTransfers: pending,
    contributions,
    alerts,
    onchainAlerts,
    contracts: {
      actors: c.actors, batches: c.batches, vault: c.vault,
      alerts: c.alerts, token: c.token,
    },
    fetRateBps: Number(await vault.fetRateBps()) / 100,
  };
}

async function doAction(action, params) {
  const c = cfg();
  const p = provider();
  const signer = await p.getSigner(params.from); // cuenta desbloqueada (local)
  const batches = new ethers.Contract(c.batches, BATCHES_ABI, signer);
  const vault = new ethers.Contract(c.vault, VAULT_ABI, signer);
  const token = new ethers.Contract(c.token, TOKEN_ABI, signer);

  const h = (s) => ethers.keccak256(ethers.toUtf8Bytes(s || "doc"));
  let tx;
  switch (action) {
    case "crearHoja":
      tx = await batches.createLeafBatch(Number(params.kg), h(params.ref));
      break;
    case "proponerTransferencia":
      tx = await batches.requestTransfer(Number(params.id), params.to);
      break;
    case "aceptarTransferencia":
      tx = await batches.acceptTransfer(Number(params.id));
      break;
    case "procesar":
      tx = await batches.transformToProcessed(
        params.inputIds.map(Number), Number(params.kgOut), h(params.ref));
      break;
    case "declararPacks":
      tx = await batches.transformToPacks(
        params.inputIds.map(Number), Number(params.packs),
        ethers.parseUnits(params.pricePerPack, 6), h(params.ref));
      break;
    case "aportarFET": {
      const amount = ethers.parseUnits(params.amount, 6);
      await (await token.mint(params.from, amount)).wait();
      await (await token.approve(c.vault, amount)).wait();
      tx = await vault.declareAndDeposit(Number(params.packLotId), amount);
      break;
    }
    case "repartir":
      tx = await vault.distribute(Number(params.packLotId));
      break;
    default:
      throw new Error(`Acción desconocida: ${action}`);
  }
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

module.exports = { getState, doAction };
