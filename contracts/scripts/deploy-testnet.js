// TRAZANO — deploy a Monad testnet + escenario de demo
//
// Requisitos:
//   1. Wallet NUEVA exclusiva de la hackathon (nunca personal)
//   2. Testnet MON del faucet: https://faucet.monad.xyz
//   3. .env en contracts/ con DEPLOYER_KEY=0x... (sin comillas)
//
// Uso: npx hardhat run scripts/deploy-testnet.js --network monadTestnet
//
// Genera 4 keys nuevas para los actores (productor, acopio, cigarrera,
// inspector), las fondea con gas desde el deployer, despliega los contratos
// y corre el escenario completo. Las keys quedan en
// ../worker/keys-testnet.json — archivo gitignored, exclusivo de testnet,
// vacío de fondos reales al finalizar la demo.

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ROLE = { PRODUCER: 1, ACOPIO: 2, CIGARRERA: 3, INSPECTOR: 4 };
const MUSD = (n) => BigInt(n) * 1_000_000n;
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const GAS_TOPUP = ethers.parseEther("0.25"); // MON por actor (gas ~102 gwei)

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${ethers.formatEther(await provider.getBalance(deployer.address))} MON`);

  // 1. Wallets de actores — nuevas, solo testnet
  const mk = () => ethers.Wallet.createRandom().connect(provider);
  const producer = mk(), acopio = mk(), cigarrera = mk(), inspector = mk();
  const actorsW = { producer, acopio, cigarrera, inspector };
  for (const [name, w] of Object.entries(actorsW)) {
    const tx = await deployer.sendTransaction({ to: w.address, value: GAS_TOPUP });
    await tx.wait();
    console.log(`  ${name}: ${w.address} (fondeado)`);
  }

  // 2. Deploy
  console.log("Desplegando contratos...");
  const actors = await (await ethers.getContractFactory("ActorRegistry")).deploy();
  await actors.waitForDeployment();
  const batches = await (await ethers.getContractFactory("BatchRegistry")).deploy(
    await actors.getAddress()
  );
  await batches.waitForDeployment();
  const token = await (await ethers.getContractFactory("MockUSD")).deploy();
  await token.waitForDeployment();
  const vault = await (await ethers.getContractFactory("FETVault")).deploy(
    await token.getAddress(),
    await batches.getAddress(),
    await actors.getAddress(),
    700,
    // fondos del reparto: por ahora direcciones del equipo de demo
    producer.address, acopio.address, inspector.address
  );
  await vault.waitForDeployment();
  const alerts = await (await ethers.getContractFactory("AlertRegistry")).deploy(
    await actors.getAddress()
  );
  await alerts.waitForDeployment();
  console.log("Contratos desplegados.");

  // 3. Actores
  console.log("Registrando actores...");
  await actors.registerActor(producer.address, ROLE.PRODUCER, "Finca El Cardon — Rosario de Lerma", hash("cuit-30-71000001-9"));
  await actors.registerActor(acopio.address, ROLE.ACOPIO, "Acopio Tabacos del Valle", hash("cuit-30-71000002-7"));
  await actors.registerActor(cigarrera.address, ROLE.CIGARRERA, "Cigarrera Demo SA", hash("cuit-30-71000003-5"));
  await actors.registerActor(inspector.address, ROLE.INSPECTOR, "Auditoria Camara del Tabaco", hash("inspector-doc"));

  // 4. Escenario (los actores firman con sus wallets nuevas)
  console.log("Lote honesto...");
  const bP = batches.connect(producer), bA = batches.connect(acopio),
        bC = batches.connect(cigarrera), tC = token.connect(cigarrera),
        vC = vault.connect(cigarrera);

  await (await bP.createLeafBatch(2000, hash("finca-cardon-lote-1"))).wait();
  await (await bP.requestTransfer(1, acopio.address)).wait();
  await (await bA.acceptTransfer(1)).wait();
  await (await bA.transformToProcessed([1], 1800, hash("proc-a"))).wait();
  await (await bA.requestTransfer(2, cigarrera.address)).wait();
  await (await bC.acceptTransfer(2)).wait();
  await (await bC.transformToPacks([2], 50_000, MUSD(2), hash("packs-honesto"))).wait();

  console.log("Lote fraudulento...");
  await (await bP.createLeafBatch(1000, hash("finca-cardon-lote-2"))).wait();
  await (await bP.requestTransfer(4, acopio.address)).wait();
  await (await bA.acceptTransfer(4)).wait();
  await (await bA.transformToProcessed([4], 900, hash("proc-b"))).wait();
  await (await bA.requestTransfer(5, cigarrera.address)).wait();
  await (await bC.acceptTransfer(5)).wait();
  await (await bC.transformToPacks([5], 80_000, MUSD(2), hash("packs-trucho"))).wait();

  console.log("Aportes al FET...");
  const expectedH = (50_000n * MUSD(2) * 700n) / 10_000n;
  const expectedT = (80_000n * MUSD(2) * 700n) / 10_000n;
  await (await token.mint(cigarrera.address, expectedH + expectedT)).wait();
  await (await tC.approve(await vault.getAddress(), expectedH + expectedT)).wait();
  await (await vC.declareAndDeposit(3, expectedH)).wait();
  await (await vault.distribute(3)).wait();
  await (await vC.declareAndDeposit(6, expectedT / 2n)).wait();
  await (await vault.distribute(6)).wait();

  // 5. Salidas
  const deployed = {
    rpcUrl: "https://testnet-rpc.monad.xyz",
    deployBlock: await provider.getBlockNumber() - 60,
    explorerBase: "https://testnet.monadexplorer.com/tx/",
    actors: await actors.getAddress(),
    batches: await batches.getAddress(),
    token: await token.getAddress(),
    vault: await vault.getAddress(),
    alerts: await alerts.getAddress(),
    inspectorKey: inspector.privateKey, // key nueva de testnet, solo la demo
    cuentas: {
      admin: deployer.address,
      productor: producer.address,
      acopio: acopio.address,
      cigarrera: cigarrera.address,
      inspector: inspector.address,
    },
    packLotes: { honesto: 3, fraudulento: 6 },
  };
  fs.writeFileSync(
    path.join(__dirname, "..", "..", "worker", "deployed.json"),
    JSON.stringify(deployed, null, 2)
  );

  // keys de actores por separado — para operar roles desde la app en testnet
  const keys = {
    productor: producer.privateKey,
    acopio: acopio.privateKey,
    cigarrera: cigarrera.privateKey,
    inspector: inspector.privateKey,
  };
  fs.writeFileSync(
    path.join(__dirname, "..", "..", "worker", "keys-testnet.json"),
    JSON.stringify(keys, null, 2)
  );

  console.log("\nListo en Monad testnet:");
  console.log(`  BatchRegistry: ${deployed.batches}`);
  console.log(`  FETVault:      ${deployed.vault}`);
  console.log(`  AlertRegistry: ${deployed.alerts}`);
  console.log(`  Explorador:    https://testnet.monadexplorer.com/address/${deployed.batches}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
