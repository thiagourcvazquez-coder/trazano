// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ActorRegistry.sol";

/// @title AlertRegistry
/// @notice Registro onchain de alertas de inconsistencia, emitidas por el
///         inspector. La firma del inspector no prueba que hubo fraude: prueba
///         que la inconsistencia existe en los datos registrados y queda
///         atribuible a una identidad. El detalle (kg, packs, montos) vive
///         off-chain; acá queda el hash, verificable por cualquiera.
contract AlertRegistry {
    ActorRegistry public immutable actors;

    struct Alert {
        uint256 packLotId;
        bytes32 alertType; // keccak256("BALANCE_DE_MASA"), etc.
        bytes32 detailsHash; // hash del detalle off-chain (alerts.json)
        address inspector;
        uint256 createdAt;
    }

    Alert[] public alerts;

    event AlertRaised(
        uint256 indexed alertIndex,
        uint256 indexed packLotId,
        bytes32 alertType,
        bytes32 detailsHash,
        address indexed inspector
    );

    error NotInspector();

    constructor(ActorRegistry _actors) {
        actors = _actors;
    }

    /// @notice El inspector eleva una alerta sobre un lote de packs.
    function raiseAlert(
        uint256 packLotId,
        bytes32 alertType,
        bytes32 detailsHash
    ) external returns (uint256 index) {
        if (!actors.hasRole(msg.sender, ActorRegistry.Role.INSPECTOR))
            revert NotInspector();
        index = alerts.length;
        alerts.push(
            Alert({
                packLotId: packLotId,
                alertType: alertType,
                detailsHash: detailsHash,
                inspector: msg.sender,
                createdAt: block.timestamp
            })
        );
        emit AlertRaised(index, packLotId, alertType, detailsHash, msg.sender);
    }

    function alertCount() external view returns (uint256) {
        return alerts.length;
    }
}
