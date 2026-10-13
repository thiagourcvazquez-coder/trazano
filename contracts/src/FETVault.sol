// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./MockUSD.sol";
import "./BatchRegistry.sol";
import "./ActorRegistry.sol";

/// @title FETVault
/// @notice Simulación del Fondo Especial del Tabaco. La cigarrera declara su
///         producción (packs × precio, ya registrados en BatchRegistry) y
///         deposita su aporte. El contrato calcula el esperado con la
///         alícuota configurada, expone públicamente cualquier discrepancia y
///         reparte el depósito entre productores, seguridad social y
///         municipios con porcentajes fijos y visibles. La plataforma no
///         puede retener ni redirigir fondos.
contract FETVault {
    MockUSD public immutable token;
    BatchRegistry public immutable batches;
    ActorRegistry public immutable actors;

    /// @notice Alícuota en puntos básicos (700 = 7%).
    uint256 public immutable fetRateBps;

    /// @notice Reparto en puntos básicos. Deben sumar 10_000.
    uint256 public constant PRODUCERS_BPS = 6_000;
    uint256 public constant SOCIAL_BPS = 3_000;

    address public immutable producersFund;
    address public immutable socialFund;
    address public immutable municipalitiesFund;

    struct Contribution {
        uint256 packLotId;
        address payer;
        uint256 expected;
        uint256 deposited;
        bool discrepancy;
        bool distributed;
    }

    mapping(uint256 => Contribution) public contributions;
    uint256 public contributionCount;

    event ContributionRecorded(
        uint256 indexed packLotId,
        address indexed payer,
        uint256 expected,
        uint256 deposited,
        bool discrepancy
    );
    event Distributed(
        uint256 indexed packLotId,
        uint256 toProducers,
        uint256 toSocial,
        uint256 toMunicipalities
    );

    error NotCigarrera();
    error NotPackLot();
    error AlreadyDeclared();
    error AlreadyDistributed();
    error NothingDeclared();

    constructor(
        MockUSD _token,
        BatchRegistry _batches,
        ActorRegistry _actors,
        uint256 _fetRateBps,
        address _producersFund,
        address _socialFund,
        address _municipalitiesFund
    ) {
        token = _token;
        batches = _batches;
        actors = _actors;
        fetRateBps = _fetRateBps;
        producersFund = _producersFund;
        socialFund = _socialFund;
        municipalitiesFund = _municipalitiesFund;
    }

    /// @notice La cigarrera declara su aporte para un lote de packs y lo
    ///         deposita en stablecoin. Si deposita menos de lo esperado,
    ///         queda registrado como discrepancia — visible para todos.
    function declareAndDeposit(
        uint256 packLotId,
        uint256 deposit
    ) external returns (uint256 expected) {
        if (!actors.hasRole(msg.sender, ActorRegistry.Role.CIGARRERA))
            revert NotCigarrera();
        BatchRegistry.Batch memory b = batches.getBatch(packLotId);
        if (b.stage != BatchRegistry.Stage.PACKS || b.holder != msg.sender)
            revert NotPackLot();
        if (contributions[packLotId].payer != address(0))
            revert AlreadyDeclared();

        expected = (b.packs * b.pricePerPack * fetRateBps) / 10_000;
        bool discrepancy = deposit < expected;

        contributions[packLotId] = Contribution({
            packLotId: packLotId,
            payer: msg.sender,
            expected: expected,
            deposited: deposit,
            discrepancy: discrepancy,
            distributed: false
        });
        contributionCount++;

        if (deposit > 0) {
            require(
                token.transferFrom(msg.sender, address(this), deposit),
                "FETVault: transfer failed"
            );
        }
        emit ContributionRecorded(
            packLotId,
            msg.sender,
            expected,
            deposit,
            discrepancy
        );
    }

    /// @notice Reparte lo depositado. Cualquiera puede ejecutarlo: los
    ///         porcentajes son fijos y nadie puede redirigir los fondos.
    function distribute(uint256 packLotId) external {
        Contribution storage c = contributions[packLotId];
        if (c.payer == address(0)) revert NothingDeclared();
        if (c.distributed) revert AlreadyDistributed();
        c.distributed = true;

        uint256 toProducers = (c.deposited * PRODUCERS_BPS) / 10_000;
        uint256 toSocial = (c.deposited * SOCIAL_BPS) / 10_000;
        uint256 toMunicipalities = c.deposited - toProducers - toSocial;

        if (toProducers > 0)
            require(token.transfer(producersFund, toProducers), "transfer");
        if (toSocial > 0)
            require(token.transfer(socialFund, toSocial), "transfer");
        if (toMunicipalities > 0)
            require(
                token.transfer(municipalitiesFund, toMunicipalities),
                "transfer"
            );

        emit Distributed(packLotId, toProducers, toSocial, toMunicipalities);
    }

    /// @notice Lo que falta: esperado menos depositado.
    function shortfall(uint256 packLotId) external view returns (uint256) {
        Contribution storage c = contributions[packLotId];
        return c.expected > c.deposited ? c.expected - c.deposited : 0;
    }
}
