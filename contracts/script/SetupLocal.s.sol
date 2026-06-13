// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {LoanRegistry} from "../src/LoanRegistry.sol";
import {LoanVault} from "../src/LoanVault.sol";
import {IncomeRouter} from "../src/IncomeRouter.sol";
import {PassportRegistry} from "../src/PassportRegistry.sol";
import {TranchePool} from "../src/TranchePool.sol";
import {ILoanRegistry} from "../src/interfaces/ILoanRegistry.sol";
import {IWorldID} from "../src/interfaces/IWorldID.sol";
import {MockERC20} from "../test/MockERC20.sol";
import {MockWorldID} from "../test/MockWorldID.sol";

/// @title SetupLocal — stand up a PERSISTENT local devnet for FRONTEND testing (not a full run).
/// @notice Deploys mock USDC + mock World ID + all five protocol contracts, seeds balances, and
///         leaves the system mid-flow so the /app UI has real buttons to press:
///           - mints USDC to every default anvil account (any connected wallet has funds to spend);
///           - funds the LoanVault with lending capital so a claim can disburse;
///           - PRE-ONBOARDS the borrower (passport minted) and writes APPROVED terms to the seam,
///             because the World ID UI step (IDKit) needs the real World sequencer and can't run
///             against a local mock — so we seed it and the Borrow tab's "Claim" works directly.
///         Finally it writes `app/.env` with the freshly-deployed addresses + the local RPC.
///
/// @dev    Run via `scripts/devnet.sh` (which boots a persistent anvil first). The borrower address
///         defaults to anvil account #1 and can be overridden with the DEMO_BORROWER env var.
///         Deploys with mock USDC — LOCAL ONLY, never a live network.
contract SetupLocal is Script {
    uint256 constant DEPLOYER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // anvil #0
    // anvil account #1 — the default pre-onboarded borrower. Import this key into MetaMask to claim.
    address constant DEFAULT_BORROWER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    uint256 constant USDC = 1e6;

    MockERC20 usdc;
    MockWorldID worldId;
    LoanRegistry registry;
    PassportRegistry passport;
    LoanVault vault;
    IncomeRouter router;
    TranchePool pool;

    address deployer;
    address borrower;

    function run() external {
        deployer = vm.addr(DEPLOYER_PK);
        borrower = vm.envOr("DEMO_BORROWER", DEFAULT_BORROWER);

        vm.startBroadcast(DEPLOYER_PK);
        _deploy();
        _seedBalances();
        _onboardBorrower();
        vm.stopBroadcast();

        _writeEnv();
        _report();
    }

    function _deploy() internal {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        worldId = new MockWorldID();

        registry = new LoanRegistry(deployer); // forwarder = deployer (CRE stand-in)
        passport = new PassportRegistry(IWorldID(address(worldId)), "app_vouch_local", "mint-credit-passport");
        vault = new LoanVault(address(registry), address(usdc), address(0));
        router = new IncomeRouter(address(vault), address(usdc));
        pool = new TranchePool(address(usdc), 600);

        vault.setRouter(address(router));
        vault.setPassportRegistry(address(passport));
        passport.setReputationOracle(address(vault));
        pool.setLossReporter(address(vault));
        vault.setTranchePool(address(pool));
    }

    function _seedBalances() internal {
        // Mint USDC to every default anvil account so whichever one you connect has funds to spend
        // on the Earn (deposit) and Payout (cash out) tabs.
        address[10] memory accounts = [
            0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266,
            0x70997970C51812dc3A010C7d01b50e0d17dc79C8,
            0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC,
            0x90F79bf6EB2c4f870365E785982E1f101E93b906,
            0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65,
            0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,
            0x976EA74026E726554dB657fA54763abd0C3a0aa9,
            0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,
            0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f,
            0xa0Ee7A142d267C1f36714E4a8F75612F20a79720
        ];
        for (uint256 i = 0; i < accounts.length; i++) {
            usdc.mint(accounts[i], 100_000 * USDC);
        }

        // Fund the vault with lending capital so the borrower's claim can disburse immediately.
        usdc.approve(address(vault), 5_000 * USDC);
        vault.fund(5_000 * USDC);
    }

    function _onboardBorrower() internal {
        // 1) Mint the borrower's passport (World ID step is pre-seeded — see contract notes).
        uint256 nullifier = uint256(keccak256(abi.encodePacked("vouch-local:", borrower)));
        uint256[8] memory proof; // MockWorldID accepts any proof
        passport.verifyAndMint(borrower, 1, nullifier, proof);

        // 2) Write APPROVED terms to the seam (deployer == forwarder), so the Borrow tab shows live
        //    terms and the Claim button is enabled.
        ILoanRegistry.Terms memory t = ILoanRegistry.Terms({
            borrower: borrower,
            passportId: passport.passportIdOf(borrower),
            principal: 500 * USDC,
            aprBps: 1000,
            riskBand: 1,
            attestationRef: keccak256("chainlink-confidential-attestation-local"),
            expiry: uint64(block.timestamp + 30 days),
            approved: true
        });
        registry.setTerms(t);
    }

    /// @dev Generate `app/.env` so the frontend reads the just-deployed addresses on `npm run dev`.
    ///      VITE_WORLD_APP_ID is left blank on purpose: the World ID UI can't run against the local
    ///      mock, and the borrower's passport is already seeded, so you skip straight to Claim.
    function _writeEnv() internal {
        // Build incrementally with an accumulator — a single big string.concat trips "stack too deep".
        string memory env = "# Generated by scripts/devnet.sh (SetupLocal.s.sol) - LOCAL anvil devnet, chain 5042002.\n";
        env = string.concat(env, "# Do not commit. Re-run the devnet to regenerate after a fresh anvil.\n");
        env = string.concat(env, "VITE_LOAN_REGISTRY_ADDRESS=", vm.toString(address(registry)), "\n");
        env = string.concat(env, "VITE_LOAN_VAULT_ADDRESS=", vm.toString(address(vault)), "\n");
        env = string.concat(env, "VITE_INCOME_ROUTER_ADDRESS=", vm.toString(address(router)), "\n");
        env = string.concat(env, "VITE_TRANCHE_POOL_ADDRESS=", vm.toString(address(pool)), "\n");
        env = string.concat(env, "VITE_PASSPORT_REGISTRY_ADDRESS=", vm.toString(address(passport)), "\n");
        env = string.concat(env, "VITE_USDC_ADDRESS=", vm.toString(address(usdc)), "\n");
        env = string.concat(env, "VITE_WORLD_APP_ID=\n");
        env = string.concat(env, "VITE_WORLD_ACTION_ID=mint-credit-passport\n");
        env = string.concat(env, "VITE_ARC_RPC_URL=http://127.0.0.1:8545\n");
        vm.writeFile("../app/.env", env);
    }

    function _report() internal view {
        console2.log("");
        console2.log("== Local devnet ready ==");
        console2.log("  USDC (mock) ", address(usdc));
        console2.log("  LoanRegistry", address(registry));
        console2.log("  Passport    ", address(passport));
        console2.log("  LoanVault   ", address(vault));
        console2.log("  IncomeRouter", address(router));
        console2.log("  TranchePool ", address(pool));
        console2.log("  Borrower    ", borrower, "(pre-onboarded, 500 USDC approved)");
        console2.log("  Wrote app/.env. Start the UI with: cd app && npm install && npm run dev");
    }
}
