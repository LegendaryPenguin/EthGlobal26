// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title WalletLink — binds an external wallet to a single World ID human (anti-Sybil).
/// @notice One wallet ↔ one World ID nullifier, and one nullifier ↔ one wallet. Re-linking either
///         side reverts, so a wallet already tied to one human CANNOT be attached to a different
///         World ID — the "one human, can't escape with a new wallet" guarantee, enforced on-chain.
/// @dev    `linker` (the World-ID-verifying server / relayer) is the only address allowed to record a
///         link, since it has verified the human's session. Reads are public.
contract WalletLink {
    address public owner;
    address public linker; // authorized to record links (the server after World ID verification)

    mapping(address wallet => bytes32 worldId) public worldIdOf;
    mapping(bytes32 worldId => address wallet) public walletOf;

    event Linked(address indexed wallet, bytes32 indexed worldId);
    event LinkerUpdated(address indexed previous, address indexed current);

    error NotOwner();
    error NotLinker();
    error ZeroValue();
    error WalletAlreadyLinked(bytes32 existingWorldId);
    error WorldIdAlreadyLinked(address existingWallet);

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor() {
        owner = msg.sender;
        linker = msg.sender;
    }

    function setLinker(address _linker) external onlyOwner {
        emit LinkerUpdated(linker, _linker);
        linker = _linker;
    }

    /// @notice Record that `wallet` belongs to the human identified by `worldId`. Reverts if the
    ///         wallet is already linked to a DIFFERENT World ID, or the World ID already has a
    ///         different wallet. Idempotent for an identical (wallet, worldId) pair.
    function link(address wallet, bytes32 worldId) external {
        if (msg.sender != owner && msg.sender != linker) revert NotLinker();
        if (wallet == address(0) || worldId == bytes32(0)) revert ZeroValue();

        bytes32 existingWorld = worldIdOf[wallet];
        if (existingWorld != bytes32(0)) {
            if (existingWorld == worldId) return; // already linked to this same human — no-op
            revert WalletAlreadyLinked(existingWorld);
        }
        address existingWallet = walletOf[worldId];
        if (existingWallet != address(0) && existingWallet != wallet) revert WorldIdAlreadyLinked(existingWallet);

        worldIdOf[wallet] = worldId;
        walletOf[worldId] = wallet;
        emit Linked(wallet, worldId);
    }

    /// @notice True if `wallet` is already bound to some World ID (so it can't be linked to another).
    function isLinked(address wallet) external view returns (bool) {
        return worldIdOf[wallet] != bytes32(0);
    }
}
