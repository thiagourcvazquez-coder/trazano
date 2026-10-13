// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ActorRegistry.sol";

/// @title BatchRegistry
/// @notice Cadena de custodia de lotes de tabaco. Cada lote registra kg,
///         metadata (hash off-chain: finca, clase, georreferencia) y los lotes
///         de los que proviene, lo que habilita el balance de masa.
///
///         Reglas:
///         - Solo el productor crea lotes HOJA.
///         - Solo el acopio transforma HOJA en PROCESADO.
///         - Solo la cigarrera transforma PROCESADO en PACKS y declara
///           cantidad y precio.
///         - Las transferencias son de firma cruzada: el titular propone y el
///           receptor acepta. La hoja solo puede ir al acopio y el procesado
///           solo a la cigarrera (la topología de la cadena está en el
///           contrato, no en la buena voluntad).
contract BatchRegistry {
    enum Stage {
        LEAF,
        PROCESSED,
        PACKS
    }
    enum Status {
        ACTIVE,
        IN_TRANSIT,
        CONSUMED
    }

    struct Batch {
        uint256 id;
        Stage stage;
        address holder;
        uint256 kg; // HOJA/PROCESADO: kg. En PACKS: kg insumidos.
        uint256 packs; // solo PACKS
        uint256 pricePerPack; // solo PACKS, en unidades del token de pago
        bytes32 dataHash;
        uint256[] inputs; // ids de lotes consumidos
        Status status;
        uint256 createdAt;
    }

    ActorRegistry public immutable actors;

    uint256 public batchCount;
    mapping(uint256 => Batch) private _batches;
    mapping(uint256 => address) public pendingRecipient;

    event BatchCreated(
        uint256 indexed id,
        Stage stage,
        address indexed holder,
        uint256 kg,
        uint256 packs,
        uint256 pricePerPack,
        bytes32 dataHash,
        uint256[] inputs
    );
    event TransferRequested(
        uint256 indexed id,
        address indexed from,
        address indexed to
    );
    event TransferAccepted(
        uint256 indexed id,
        address indexed from,
        address indexed to
    );
    event TransferCancelled(uint256 indexed id);

    error NotHolder();
    error NotActor();
    error NotPendingRecipient();
    error BatchNotActive();
    error InputNotUsable();
    error InvalidDestination();

    modifier onlyHolder(uint256 id) {
        if (_batches[id].holder != msg.sender) revert NotHolder();
        _;
    }

    constructor(ActorRegistry _actors) {
        actors = _actors;
    }

    /// @notice El productor crea un lote de fardos de hoja.
    function createLeafBatch(
        uint256 kg,
        bytes32 dataHash
    ) external returns (uint256) {
        if (!actors.hasRole(msg.sender, ActorRegistry.Role.PRODUCER))
            revert NotActor();
        return _mint(Stage.LEAF, kg, 0, 0, dataHash, new uint256[](0));
    }

    /// @notice El acopio consume lotes HOJA y emite un lote PROCESADO.
    function transformToProcessed(
        uint256[] calldata inputIds,
        uint256 kgOut,
        bytes32 dataHash
    ) external returns (uint256) {
        if (!actors.hasRole(msg.sender, ActorRegistry.Role.ACOPIO))
            revert NotActor();
        _consume(inputIds, Stage.LEAF);
        return _mint(Stage.PROCESSED, kgOut, 0, 0, dataHash, inputIds);
    }

    /// @notice La cigarrera consume lotes PROCESADO y declara packs + precio.
    function transformToPacks(
        uint256[] calldata inputIds,
        uint256 packs,
        uint256 pricePerPack,
        bytes32 dataHash
    ) external returns (uint256) {
        if (!actors.hasRole(msg.sender, ActorRegistry.Role.CIGARRERA))
            revert NotActor();
        uint256 kgIn = _consume(inputIds, Stage.PROCESSED);
        return _mint(Stage.PACKS, kgIn, packs, pricePerPack, dataHash, inputIds);
    }

    /// @notice El titular propone la transferencia. El destino tiene que ser
    ///         coherente con la cadena: HOJA→acopio, PROCESADO→cigarrera,
    ///         PACKS→cualquier actor registrado.
    function requestTransfer(uint256 id, address to) external onlyHolder(id) {
        Batch storage b = _batches[id];
        if (b.status != Status.ACTIVE) revert BatchNotActive();
        _assertDestination(b.stage, to);
        b.status = Status.IN_TRANSIT;
        pendingRecipient[id] = to;
        emit TransferRequested(id, msg.sender, to);
    }

    function acceptTransfer(uint256 id) external {
        if (pendingRecipient[id] != msg.sender) revert NotPendingRecipient();
        Batch storage b = _batches[id];
        address from = b.holder;
        b.holder = msg.sender;
        b.status = Status.ACTIVE;
        delete pendingRecipient[id];
        emit TransferAccepted(id, from, msg.sender);
    }

    function cancelTransfer(uint256 id) external onlyHolder(id) {
        Batch storage b = _batches[id];
        if (b.status != Status.IN_TRANSIT) revert BatchNotActive();
        b.status = Status.ACTIVE;
        delete pendingRecipient[id];
        emit TransferCancelled(id);
    }

    function getBatch(uint256 id) external view returns (Batch memory) {
        return _batches[id];
    }

    function _assertDestination(Stage stage, address to) internal view {
        if (stage == Stage.LEAF) {
            if (!actors.hasRole(to, ActorRegistry.Role.ACOPIO))
                revert InvalidDestination();
        } else if (stage == Stage.PROCESSED) {
            if (!actors.hasRole(to, ActorRegistry.Role.CIGARRERA))
                revert InvalidDestination();
        } else if (!actors.isRegistered(to)) {
            revert InvalidDestination();
        }
    }

    function _mint(
        Stage stage,
        uint256 kg,
        uint256 packs,
        uint256 pricePerPack,
        bytes32 dataHash,
        uint256[] memory inputs
    ) internal returns (uint256 id) {
        id = ++batchCount;
        _batches[id] = Batch({
            id: id,
            stage: stage,
            holder: msg.sender,
            kg: kg,
            packs: packs,
            pricePerPack: pricePerPack,
            dataHash: dataHash,
            inputs: inputs,
            status: Status.ACTIVE,
            createdAt: block.timestamp
        });
        emit BatchCreated(
            id,
            stage,
            msg.sender,
            kg,
            packs,
            pricePerPack,
            dataHash,
            inputs
        );
    }

    function _consume(
        uint256[] calldata inputIds,
        Stage requiredStage
    ) internal returns (uint256 kgIn) {
        for (uint256 i = 0; i < inputIds.length; i++) {
            Batch storage inBatch = _batches[inputIds[i]];
            if (
                inBatch.holder != msg.sender ||
                inBatch.status != Status.ACTIVE ||
                inBatch.stage != requiredStage
            ) revert InputNotUsable();
            inBatch.status = Status.CONSUMED;
            kgIn += inBatch.kg;
        }
    }
}
