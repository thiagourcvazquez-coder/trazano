// TRAZANO — seed del escenario de demo
//
//   - Lote honesto: 2.000 kg hoja → 1.800 kg procesado → 50.000 packs,
//     aporte FET completo, reparto 60/30/10 ejecutado.
//   - Lote fraudulento: 1.000 kg hoja → 900 kg procesado → declara 80.000
//     packs (los insumos soportan ~45.000) y aporta la mitad del FET.
//     El monitor eleva dos alertas onchain: BALANCE_DE_MASA y FET_INCOMPLETO.
//
// Uso:
//   npm run node     (terminal 1)
//   npm run seed     (terminal 2)
// Escribe ../worker/deployed.json con direcciones y cuentas del escenario.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ROLE = { PRODUCER: 1, ACOPIO: 2, CIGARRERA: 3, INSPECTOR: 4 };
const MUSD = (n) => BigInt(n) * 1_000_000n;
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

async function main() {
  const [
    admin,
    producer,
    acopio,
    cigarrera,
    inspector,
    producersFund,
    socialFund,
    municipalitiesFund,
  ] = await ethers.getSigners();

  console.log("Desplegando contratos...");
  const actors = await (await ethers.getContractFactory("ActorRegistry")).deploy();
  const batches = await (await ethers.getContractFactory("BatchRegistry")).deploy(
    await actors.getAddress()
  );
  const token = await (await ethers.getContractFactory("MockUSD")).deploy();
  const vault = await (await ethers.getContractFactory("FETVault")).deploy(
    await token.getAddress(),
    await batches.getAddress(),
    await actors.getAddress(),
    700,
    producersFund.address,
    socialFund.address,
    municipalitiesFund.address
  );
  const alerts = await (await ethers.getContractFactory("AlertRegistry")).deploy(
    await actors.getAddress()
  );

  console.log("Registrando actores...");
  await actors.registerActor(producer.address, ROLE.PRODUCER, "Finca El Cardon — Rosario de Lerma", hash("cuit-30-71000001-9"));
  await actors.registerActor(acopio.address, ROLE.ACOPIO, "Acopio Tabacos del Valle", hash("cuit-30-71000002-7"));
  await actors.registerActor(cigarrera.address, ROLE.CIGARRERA, "Cigarrera Demo SA", hash("cuit-30-71000003-5"));
  await actors.registerActor(inspector.address, ROLE.INSPECTOR, "Auditoria Camara del Tabaco", hash("inspector-doc"));

  console.log("Lote honesto...");
  await batches.connect(producer).createLeafBatch(2000, hash("finca-cardon-lote-1"));
  await batches.connect(producer).requestTransfer(1, acopio.address);
  await batches.connect(acopio).acceptTransfer(1);
  await batches.connect(acopio).transformToProcessed([1], 1800, hash("proc-a"));
  await batches.connect(acopio).requestTransfer(2, cigarrera.address);
  await batches.connect(cigarrera).acceptTransfer(2);
  await batches.connect(cigarrera).transformToPacks([2], 50_000, MUSD(2), hash("packs-honesto"));

  console.log("Lote fraudulento...");
  await batches.connect(producer).createLeafBatch(1000, hash("finca-cardon-lote-2"));
  await batches.connect(producer).requestTransfer(4, acopio.address);
  await batches.connect(acopio).acceptTransfer(4);
  await batches.connect(acopio).transformToProcessed([4], 900, hash("proc-b"));
  await batches.connect(acopio).requestTransfer(5, cigarrera.address);
  await batches.connect(cigarrera).acceptTransfer(5);
  await batches.connect(cigarrera).transformToPacks([5], 80_000, MUSD(2), hash("packs-trucho"));

  console.log("Aportes al FET...");
  const expectedHonesto = (50_000n * MUSD(2) * 700n) / 10_000n; // 7.000 mUSD
  const expectedTrucho = (80_000n * MUSD(2) * 700n) / 10_000n; // 11.200 mUSD

  await token.mint(cigarrera.address, expectedHonesto + expectedTrucho);
  await token.connect(cigarrera).approve(await vault.getAddress(), expectedHonesto + expectedTrucho);

  await vault.connect(cigarrera).declareAndDeposit(3, expectedHonesto);
  await vault.distribute(3);
  await vault.connect(cigarrera).declareAndDeposit(6, expectedTrucho / 2n);
  await vault.distribute(6);

  const isLocal = (await ethers.provider.getNetwork()).chainId === 31337n;

  const out = {
    rpcUrl: "http://127.0.0.1:8545",
    actors: await actors.getAddress(),
    batches: await batches.getAddress(),
    token: await token.getAddress(),
    vault: await vault.getAddress(),
    alerts: await alerts.getAddress(),
    // Solo en nodo local: la key de prueba de hardhat #4 (inspector) para
    // firmar alertas. Es una cuenta pública de desarrollo, nunca una real.
    inspectorKey: isLocal
      ? "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a"
      : null,
    cuentas: {
      admin: admin.address,
      productor: producer.address,
      acopio: acopio.address,
      cigarrera: cigarrera.address,
      inspector: inspector.address,
    },
    packLotes: { honesto: 3, fraudulento: 6 },
  };

  fs.writeFileSync(
    path.join(__dirname, "..", "..", "worker", "deployed.json"),
    JSON.stringify(out, null, 2)
  );
  console.log("\nListo. worker/deployed.json escrito.");
  console.log(`  packLote honesto: #3 · fraudulento: #6`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
