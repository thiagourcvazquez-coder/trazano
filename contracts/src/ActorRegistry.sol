// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ActorRegistry
/// @notice Identidad de los actores de la cadena del tabaco: productor,
///         acopio, cigarrera e inspector. El alta la hace el operador, que es
///         quien verifica la identidad en el mundo real. El registro no crea
///         confianza: la hace visible y atribuible.
contract ActorRegistry {
    enum Role {
        NONE,
        PRODUCER,
        ACOPIO,
        CIGARRERA,
        INSPECTOR
    }

    struct Actor {
        Role role;
        string name;
        bytes32 dataHash; // hash de la documentación off-chain (CUIT, domicilio, habilitaciones)
        bool active;
        uint256 registeredAt;
    }

    address public admin;
    mapping(address => Actor) public actors;
    address[] private _actorList;

    event ActorRegistered(
        address indexed actor,
        Role role,
        string name,
        bytes32 dataHash
    );
    event ActorDeactivated(address indexed actor);

    error NotAdmin();
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidRole();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor() {
        admin = msg.sender;
    }

    function registerActor(
        address actor,
        Role role,
        string calldata name,
        bytes32 dataHash
    ) external onlyAdmin {
        if (role == Role.NONE) revert InvalidRole();
        if (actors[actor].registeredAt != 0) revert AlreadyRegistered();
        actors[actor] = Actor({
            role: role,
            name: name,
            dataHash: dataHash,
            active: true,
            registeredAt: block.timestamp
        });
        _actorList.push(actor);
        emit ActorRegistered(actor, role, name, dataHash);
    }

    function deactivate(address actor) external onlyAdmin {
        if (actors[actor].registeredAt == 0) revert NotRegistered();
        actors[actor].active = false;
        emit ActorDeactivated(actor);
    }

    function hasRole(address actor, Role role) public view returns (bool) {
        return actors[actor].active && actors[actor].role == role;
    }

    function isRegistered(address actor) external view returns (bool) {
        return actors[actor].registeredAt != 0 && actors[actor].active;
    }

    function actorCount() external view returns (uint256) {
        return _actorList.length;
    }

    function actorAt(uint256 i) external view returns (address) {
        return _actorList[i];
    }
}
