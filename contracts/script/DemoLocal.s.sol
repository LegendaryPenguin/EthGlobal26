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

/// @title DemoLocal — full Vouch lifecycle against a LOCAL anvil node (no Arc, no Circle creds).
/// @notice Deploys the test-double USDC + World ID verifier and all five protocol contracts, then
///         drives the entire happy path end to end with readable logs:
///
///           lender funds senior/junior tranches  →  capital deployed into the LoanVault  →
///           borrower onboards via World ID (passport minted)  →  CRE Forwarder writes the
///           attested verdict to the seam  →  borrower claims the loan  →  employer payouts are
///           income-routed (repayment slice → vault, remainder → borrower)  →  loan repaid in
///           full  →  reputation ladders up.
///
/// @dev    Runs with `--broadcast` against anvil. Uses the deterministic anvil keys and switches
///         the acting account per step via `vm.startBroadcast(pk)`, so each call is signed by the
///         right persona (deployer / lender / borrower / employer). NOT for any live network — it
///         deploys a mock USDC. The shell wrapper is `scripts/demo-local.sh`.
///
///         Contracts + personas are stored as state variables (not locals) so the phase logic stays
///         readable without tripping Solidity's "stack too deep" in a single big function.
contract DemoLocal is Script {
    // Deterministic anvil accounts (account 0..3). These keys are public test keys baked into anvil.
    uint256 constant DEPLOYER_PK = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80; // #0
    uint256 constant LENDER_PK   = 0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6; // #3
    uint256 constant BORROWER_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d; // #1
    uint256 constant EMPLOYER_PK = 0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a; // #2

    uint256 constant USDC = 1e6; // 6-decimal unit (Golden Rule #4)

    MockERC20 usdc;
    MockWorldID worldId;
    LoanRegistry registry;
    PassportRegistry passport;
    LoanVault vault;
    IncomeRouter router;
    TranchePool pool;

    address deployer;
    address lender;
    address borrower;
    address employer;

    function run() external {
        deployer = vm.addr(DEPLOYER_PK);
        lender   = vm.addr(LENDER_PK);
        borrower = vm.addr(BORROWER_PK);
        employer = vm.addr(EMPLOYER_PK);

        _deploy();
        _lenderFunds();
        _deployCapital();
        _onboard();
        _writeVerdict();
        _claim();
        _repay();
        _result();
    }

    // ── Phase 0: deploy mocks + protocol, wire it up (as deployer) ───────────────────────────────
    function _deploy() internal {
        vm.startBroadcast(DEPLOYER_PK);

        usdc = new MockERC20("USD Coin", "USDC", 6);
        worldId = new MockWorldID();

        registry = new LoanRegistry(deployer); // forwarder = deployer (the CRE stand-in)
        passport = new PassportRegistry(IWorldID(address(worldId)), "app_vouch_demo", "mint-credit-passport");
        vault = new LoanVault(address(registry), address(usdc), address(0));
        router = new IncomeRouter(address(vault), address(usdc));
        pool = new TranchePool(address(usdc), 600); // senior targets 6% APY

        vault.setRouter(address(router));
        vault.setPassportRegistry(address(passport)); // Stage 4 anti-respawn gate ON
        passport.setReputationOracle(address(vault));  // vault drives standing from repayment
        pool.setLossReporter(address(vault));
        vault.setTranchePool(address(pool));

        // Seed test balances: lender has capital to deposit, employer has future income to route.
        usdc.mint(lender, 1_000 * USDC);
        usdc.mint(employer, 600 * USDC);

        vm.stopBroadcast();

        _h("Phase 0 - deployed + wired");
        console2.log("  USDC (mock) ", address(usdc));
        console2.log("  LoanRegistry", address(registry));
        console2.log("  Passport    ", address(passport));
        console2.log("  LoanVault   ", address(vault));
        console2.log("  IncomeRouter", address(router));
        console2.log("  TranchePool ", address(pool));
    }

    // ── Phase 1: lender funds the senior + junior tranches ───────────────────────────────────────
    function _lenderFunds() internal {
        vm.startBroadcast(LENDER_PK);
        usdc.approve(address(pool), type(uint256).max);
        pool.deposit(TranchePool.Tranche.Senior, 700 * USDC);
        pool.deposit(TranchePool.Tranche.Junior, 300 * USDC);
        vm.stopBroadcast();

        _h("Phase 1 - lender funded tranches");
        _usd("  senior total", pool.seniorTotal());
        _usd("  junior total", pool.juniorTotal());
    }

    // ── Phase 2: owner deploys pooled capital into the LoanVault (lender capital -> loan capital) ──
    function _deployCapital() internal {
        vm.startBroadcast(DEPLOYER_PK);
        pool.deployToVault(address(vault), 500 * USDC);
        vm.stopBroadcast();

        _h("Phase 2 - capital deployed to vault");
        _usd("  vault USDC balance", usdc.balanceOf(address(vault)));
    }

    // ── Phase 3: borrower onboards with World ID -> passport minted ────────────────────────────────
    function _onboard() internal {
        uint256 nullifier = uint256(keccak256("human:demo-borrower"));
        uint256[8] memory proof; // MockWorldID accepts any proof; the real verifier runs Groth16
        vm.startBroadcast(DEPLOYER_PK);
        passport.verifyAndMint(borrower, 1, nullifier, proof);
        vm.stopBroadcast();

        _h("Phase 3 - World ID verified, passport minted");
        console2.log("  passportId   ", vm.toString(passport.passportIdOf(borrower)));
        _usd("  credit limit ", passport.limitOf(borrower));
        console2.log("  good standing", passport.isInGoodStanding(borrower));
    }

    // ── Phase 4: the CRE Forwarder writes the attested verdict to the seam ─────────────────────────
    function _writeVerdict() internal {
        ILoanRegistry.Terms memory t = ILoanRegistry.Terms({
            borrower: borrower,
            passportId: passport.passportIdOf(borrower),
            principal: 500 * USDC,
            aprBps: 1000, // 10.00% APR
            riskBand: 1,
            attestationRef: keccak256("chainlink-confidential-attestation-demo"),
            expiry: uint64(block.timestamp + 1 days),
            approved: true
        });
        vm.startBroadcast(DEPLOYER_PK); // deployer == forwarder
        registry.setTerms(t);
        vm.stopBroadcast();

        _h("Phase 4 - verdict written to LoanRegistry (the seam)");
        _usd("  principal", t.principal);
        console2.log("  aprBps   ", t.aprBps);
        console2.log("  riskBand ", t.riskBand);
    }

    // ── Phase 5: borrower claims the loan -> USDC disbursed on (mock) Arc ──────────────────────────
    function _claim() internal {
        vm.startBroadcast(BORROWER_PK);
        vault.claim();
        vm.stopBroadcast();

        _h("Phase 5 - borrower claimed; loan disbursed");
        _usd("  borrower USDC balance", usdc.balanceOf(borrower));
        _usd("  outstanding (P+interest)", vault.outstandingOf(borrower));
    }

    // ── Phase 6: employer income payouts are routed -> loan repaid in installments ─────────────────
    function _repay() internal {
        _h("Phase 6 - income-routed repayment");
        for (uint256 i = 1; i <= 4; i++) {
            vm.startBroadcast(EMPLOYER_PK);
            usdc.approve(address(router), 150 * USDC);
            router.onPayout(borrower, 150 * USDC); // 150 USDC paycheck; router skims the scheduled slice
            vm.stopBroadcast();
            console2.log("  payout", i);
            _usd("    outstanding after", vault.outstandingOf(borrower));
        }
    }

    // ── Done: loan repaid, reputation healed + laddered up ─────────────────────────────────────────
    function _result() internal view {
        _h("Result");
        console2.log("  loan fully repaid", vault.isRepaid(borrower));
        _usd("  credit limit now ", passport.limitOf(borrower)); // ladders up after full repayment
        console2.log("  good standing    ", passport.isInGoodStanding(borrower));
        _usd("  borrower USDC end", usdc.balanceOf(borrower));
        _usd("  vault USDC end   ", usdc.balanceOf(address(vault)));
    }

    function _h(string memory s) internal pure {
        console2.log("");
        console2.log(string.concat("== ", s, " =="));
    }

    /// @dev Log a 6-decimal USDC amount as a human dollar string, e.g. 504109589 -> "504.109589".
    function _usd(string memory label, uint256 amount) internal pure {
        console2.log(string.concat(label, ": ", _fmt(amount), " USDC"));
    }

    function _fmt(uint256 amount) internal pure returns (string memory) {
        uint256 whole = amount / USDC;
        string memory fracStr = vm.toString(amount % USDC);
        while (bytes(fracStr).length < 6) {
            fracStr = string.concat("0", fracStr); // zero-pad fractional part to 6 digits
        }
        return string.concat(vm.toString(whole), ".", fracStr);
    }
}
