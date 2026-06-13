// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 surface. On Arc, USDC is the native gas token AND a 6-decimal ERC-20
///         (Golden Rule #4). Pull the live USDC address from the Circle MCP server / contract
///         pages — NEVER hardcode it (Golden Rule #5).
interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function decimals() external view returns (uint8); // expect 6 for USDC
}
