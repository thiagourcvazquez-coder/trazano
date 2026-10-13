const { expect } = require("chai");
const { ethers } = require("hardhat");

const ROLE = { PRODUCER: 1, ACOPIO: 2, CIGARRERA: 3, INSPECTOR: 4 };
const STAGE = { LEAF: 0, PROCESSED: 1, PACKS: 2 };
const STATUS = { ACTIVE: 0, IN_TRANSIT: 1, CONSUMED: 2 };
const MUSD = (n) => BigInt(n) * 1_000_000n; // 6 decimales
const hash = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));

describe("TRAZANO — cadena de custodia y FET", function () {
  let admin, producer, acopio, cigarrera, inspector, outsider;
  let producersFund, socialFund, municipalitiesFund;
  let actors, batches, token, vault, alerts;

  beforeEach(async function () {
    [
      admin,
      producer,
      acopio,
      cigarrera,
      inspector,
      outsider,
      producersFund,
      socialFund,
      municipalitiesFund,
    ] = await ethers.getSigners();

    actors = await (await ethers.getContractFactory("ActorRegistry")).deploy();
    batches = await (
      await ethers.getContractFactory("BatchRegistry")
    ).deploy(await actors.getAddress());
    token = await (await ethers.getContractFactory("MockUSD")).deploy();
    vault = await (
      await ethers.getContractFactory("FETVault")
    ).deploy(
      await token.getAddress(),
      await batches.getAddress(),
      await actors.getAddress(),
      700, // 7%
      producersFund.address,
      socialFund.address,
      municipalitiesFund.address
    );
    alerts = await (
      await ethers.getContractFactory("AlertRegistry")
    ).deploy(await actors.getAddress());

    await actors.registerActor(producer.address, ROLE.PRODUCER, "Finca El Cardon", hash("prod"));
    await actors.registerActor(acopio.address, ROLE.ACOPIO, "Acopio Rosario", hash("acopio"));
    await actors.registerActor(cigarrera.address, ROLE.CIGARRERA, "Cigarrera Demo SA", hash("cig"));
    await actors.registerActor(inspector.address, ROLE.INSPECTOR, "Auditor Camara", hash("insp"));
  });

  async function fullChain() {
    await batches.connect(producer).createLeafBatch(2000, hash("lote-1"));
    await batches.connect(producer).requestTransfer(1, acopio.address);
    await batches.connect(acopio).acceptTransfer(1);
    await batches.connect(acopio).transformToProcessed([1], 1800, hash("proc"));
    await batches.connect(acopio).requestTransfer(2, cigarrera.address);
    await batches.connect(cigarrera).acceptTransfer(2);
    await batches.connect(cigarrera).transformToPacks([2], 50_000, MUSD(2), hash("packs"));
    return 3;
  }

  it("flujo completo: hoja -> procesado -> packs con custodia firmada", async function () {
    const packLotId = await fullChain();
    expect((await batches.getBatch(1)).status).to.equal(STATUS.CONSUMED);
    const packs = await batches.getBatch(packLotId);
    expect(packs.packs).to.equal(50_000);
    expect(packs.kg).to.equal(1800);
    expect(packs.holder).to.equal(cigarrera.address);
  });

  it("FET: deposito completo reparte 60/30/10 sin discrepancia", async function () {
    const packLotId = await fullChain();
    const expected = (50_000n * MUSD(2) * 700n) / 10_000n;

    await token.mint(cigarrera.address, expected);
    await token.connect(cigarrera).approve(await vault.getAddress(), expected);
    await vault.connect(cigarrera).declareAndDeposit(packLotId, expected);
    await vault.distribute(packLotId);

    expect(await token.balanceOf(producersFund.address)).to.equal((expected * 6000n) / 10_000n);
    expect(await token.balanceOf(socialFund.address)).to.equal((expected * 3000n) / 10_000n);
    expect(await token.balanceOf(municipalitiesFund.address)).to.equal(expected - (expected * 9000n) / 10_000n);
    expect((await vault.contributions(packLotId)).discrepancy).to.equal(false);
  });

  it("subfacturacion: depositar de menos queda registrado como discrepancia", async function () {
    const packLotId = await fullChain();
    const expected = (50_000n * MUSD(2) * 700n) / 10_000n;
    const deposited = expected / 2n;

    await token.mint(cigarrera.address, deposited);
    await token.connect(cigarrera).approve(await vault.getAddress(), deposited);
    await vault.connect(cigarrera).declareAndDeposit(packLotId, deposited);

    expect((await vault.contributions(packLotId)).discrepancy).to.equal(true);
    expect(await vault.shortfall(packLotId)).to.equal(expected - deposited);
  });

  it("reglas de rol: solo productor crea hoja, solo acopio procesa, solo cigarrera declara packs", async function () {
    await expect(batches.connect(outsider).createLeafBatch(1000, hash("x")))
      .to.be.revertedWithCustomError(batches, "NotActor");
    await expect(batches.connect(acopio).createLeafBatch(1000, hash("x")))
      .to.be.revertedWithCustomError(batches, "NotActor");
    await expect(batches.connect(cigarrera).transformToProcessed([1], 900, hash("x")))
      .to.be.revertedWithCustomError(batches, "NotActor");
    await expect(batches.connect(producer).transformToPacks([1], 100, 1, hash("x")))
      .to.be.revertedWithCustomError(batches, "NotActor");
  });

  it("topologia: la hoja solo va al acopio, el procesado solo a la cigarrera", async function () {
    await batches.connect(producer).createLeafBatch(500, hash("a"));
    // la hoja no puede ir directo a la cigarrera ni a otro productor
    await expect(batches.connect(producer).requestTransfer(1, cigarrera.address))
      .to.be.revertedWithCustomError(batches, "InvalidDestination");
    await expect(batches.connect(producer).requestTransfer(1, producer.address))
      .to.be.revertedWithCustomError(batches, "InvalidDestination");
    // al acopio sí
    await batches.connect(producer).requestTransfer(1, acopio.address);
    await batches.connect(acopio).acceptTransfer(1);
    await batches.connect(acopio).transformToProcessed([1], 400, hash("p"));
    // el procesado no puede volver a un productor
    await expect(batches.connect(acopio).requestTransfer(2, producer.address))
      .to.be.revertedWithCustomError(batches, "InvalidDestination");
  });

  it("transferencia requiere aceptacion del destinatario correcto", async function () {
    await batches.connect(producer).createLeafBatch(500, hash("a"));
    await batches.connect(producer).requestTransfer(1, acopio.address);
    await expect(batches.connect(cigarrera).acceptTransfer(1))
      .to.be.revertedWithCustomError(batches, "NotPendingRecipient");
    await batches.connect(acopio).acceptTransfer(1);
    expect((await batches.getBatch(1)).holder).to.equal(acopio.address);
  });

  it("un lote consumido no se puede reutilizar ni transferir", async function () {
    await fullChain();
    await expect(batches.connect(acopio).transformToProcessed([1], 100, hash("x")))
      .to.be.revertedWithCustomError(batches, "InputNotUsable");
    await expect(batches.connect(producer).requestTransfer(1, acopio.address))
      .to.be.revertedWithCustomError(batches, "NotHolder");
  });

  it("el inspector eleva alertas onchain; otros roles no pueden", async function () {
    const packLotId = await fullChain();
    await expect(
      alerts.connect(cigarrera).raiseAlert(packLotId, hash("BALANCE_DE_MASA"), hash("detalle"))
    ).to.be.revertedWithCustomError(alerts, "NotInspector");

    await alerts.connect(inspector).raiseAlert(packLotId, hash("BALANCE_DE_MASA"), hash("detalle-80k-packs"));
    expect(await alerts.alertCount()).to.equal(1);
    const a = await alerts.alerts(0);
    expect(a.packLotId).to.equal(BigInt(packLotId));
    expect(a.inspector).to.equal(inspector.address);
  });

  it("aportes de no-cigarreras o sobre lotes que no son packs rebotan", async function () {
    await fullChain();
    await expect(vault.connect(producer).declareAndDeposit(3, 1))
      .to.be.revertedWithCustomError(vault, "NotCigarrera");
    await expect(vault.connect(cigarrera).declareAndDeposit(1, 1))
      .to.be.revertedWithCustomError(vault, "NotPackLot");
  });
});
