// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MarketRateEngine — advanced on-chain stablecoin rate/yield logic for Arc (USDC).
/// @notice Computes, FULLY ON-CHAIN, a borrower APR and a single lender EXPECTED YIELD from three
///         live inputs, replacing the fixed senior/junior tranche split with a continuous,
///         market-driven number:
///           1. pool utilization        = totalBorrowed / totalSupplied (a kinked rate curve),
///           2. supply vs demand        = willing lenders vs willing borrowers (a demand premium),
///           3. global market conditions = a benchmark base rate pushed by the market oracle/simulator.
///         `poke()` / `pushAndPoke()` recompute and PERSIST the rates on-chain (a real state change +
///         permissionless automation), and `borrowAprForBand()` feeds the LoanRegistry terms so each
///         loan's APR is genuinely market-priced.
/// @dev    All rates are bps (10_000 = 100.00%). USDC amounts are 6-decimals (Golden Rule #4). No
///         addresses hardcoded (Golden Rule #5). Self-contained: no external feed dependency so it
///         deploys cleanly on Arc; the off-chain simulator supplies realistic global conditions.
contract MarketRateEngine {
    uint256 internal constant BPS = 10_000;

    address public owner;
    address public marketAdmin; // the oracle/simulator allowed to push conditions + poke

    // ── market conditions (pushed by the simulator) ────────────────────────────
    uint16 public baseRateBps;      // global benchmark rate (risk-free + funding), bps
    uint32 public willingLenders;   // lenders willing to supply right now
    uint32 public willingBorrowers; // borrowers seeking capital right now

    // ── pool accounting (reported by the pool/vault or the simulator) ───────────
    uint256 public totalSuppliedUsdc; // lender capital available (6dp)
    uint256 public totalBorrowedUsdc; // outstanding loan principal (6dp)

    // ── model parameters (owner-tunable) ───────────────────────────────────────
    uint16 public kinkBps = 8000;              // utilization kink (80%)
    uint16 public slope1Bps = 400;             // +4% spread across 0..kink
    uint16 public slope2Bps = 6000;            // +60% spread across kink..100% (scarcity)
    uint16 public demandSensitivityBps = 1500; // up to ±15% from supply/demand imbalance
    uint16 public reserveFactorBps = 1000;     // 10% protocol reserve cut from lender yield
    uint16 public maxAprBps = 5000;            // hard cap 50%

    // ── persisted outputs (the on-chain state change) ──────────────────────────
    uint16 public currentBorrowAprBps;
    uint16 public currentSupplyYieldBps;
    uint64 public lastPokeAt;

    event MarketUpdated(uint16 baseRateBps, uint32 willingLenders, uint32 willingBorrowers, uint256 supplied, uint256 borrowed);
    event RatesPoked(uint16 borrowAprBps, uint16 supplyYieldBps, uint256 utilizationBps, int256 demandPremiumBps);
    event ParamsUpdated();
    event MarketAdminUpdated(address indexed previous, address indexed current);
    event OwnerUpdated(address indexed previous, address indexed current);

    error NotOwner();
    error NotAdmin();
    error ZeroAddress();
    error BadParams();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyAdmin() { if (msg.sender != owner && msg.sender != marketAdmin) revert NotAdmin(); _; }

    constructor(uint16 _baseRateBps) {
        owner = msg.sender;
        marketAdmin = msg.sender;
        baseRateBps = _baseRateBps;
    }

    // ── admin: push market conditions ──────────────────────────────────────────
    function setMarket(uint16 _baseRateBps, uint32 _willingLenders, uint32 _willingBorrowers) external onlyAdmin {
        baseRateBps = _baseRateBps;
        willingLenders = _willingLenders;
        willingBorrowers = _willingBorrowers;
        emit MarketUpdated(_baseRateBps, _willingLenders, _willingBorrowers, totalSuppliedUsdc, totalBorrowedUsdc);
    }

    function setPool(uint256 _supplied, uint256 _borrowed) external onlyAdmin {
        totalSuppliedUsdc = _supplied;
        totalBorrowedUsdc = _borrowed;
        emit MarketUpdated(baseRateBps, willingLenders, willingBorrowers, _supplied, _borrowed);
    }

    /// @notice The simulator's one-shot call: push the full market snapshot AND recompute+persist rates.
    function pushAndPoke(
        uint16 _baseRateBps,
        uint32 _willingLenders,
        uint32 _willingBorrowers,
        uint256 _supplied,
        uint256 _borrowed
    ) external onlyAdmin {
        baseRateBps = _baseRateBps;
        willingLenders = _willingLenders;
        willingBorrowers = _willingBorrowers;
        totalSuppliedUsdc = _supplied;
        totalBorrowedUsdc = _borrowed;
        emit MarketUpdated(_baseRateBps, _willingLenders, _willingBorrowers, _supplied, _borrowed);
        _poke();
    }

    /// @notice Recompute + persist current borrow APR and supply yield. Permissionless automation —
    ///         anyone may call; it only reads stored inputs.
    function poke() external { _poke(); }

    function _poke() internal {
        (uint16 borrowApr, uint16 supplyYield, uint256 util, int256 premium) = _compute();
        currentBorrowAprBps = borrowApr;
        currentSupplyYieldBps = supplyYield;
        lastPokeAt = uint64(block.timestamp);
        emit RatesPoked(borrowApr, supplyYield, util, premium);
    }

    // ── the formula (pure view; poke() persists it) ────────────────────────────
    function previewRates()
        external
        view
        returns (uint16 borrowAprBps, uint16 supplyYieldBps, uint256 utilizationBpsOut, int256 demandPremiumBps)
    {
        return _compute();
    }

    function utilizationBps() public view returns (uint256) {
        if (totalSuppliedUsdc == 0) return 0;
        uint256 u = (totalBorrowedUsdc * BPS) / totalSuppliedUsdc;
        return u > BPS ? BPS : u;
    }

    function _compute()
        internal
        view
        returns (uint16 borrowApr, uint16 supplyYield, uint256 util, int256 premium)
    {
        util = utilizationBps();

        // 1. kinked utilization curve
        uint256 curve;
        if (util <= kinkBps) {
            curve = kinkBps == 0 ? 0 : (uint256(slope1Bps) * util) / kinkBps;
        } else {
            uint256 over = util - kinkBps;
            uint256 span = BPS - kinkBps;
            curve = uint256(slope1Bps) + (span == 0 ? 0 : (uint256(slope2Bps) * over) / span);
        }

        // 2. supply/demand premium: (borrowers - lenders)/(borrowers + lenders) × sensitivity (signed)
        premium = 0;
        uint256 tot = uint256(willingLenders) + uint256(willingBorrowers);
        if (tot > 0) {
            int256 net = int256(uint256(willingBorrowers)) - int256(uint256(willingLenders));
            premium = (net * int256(uint256(demandSensitivityBps))) / int256(tot);
        }

        // 3. base rate + curve + premium, floored at 0 and capped at maxApr
        int256 apr = int256(uint256(baseRateBps)) + int256(curve) + premium;
        if (apr < 0) apr = 0;
        uint256 aprU = uint256(apr);
        if (aprU > maxAprBps) aprU = maxAprBps;
        borrowApr = uint16(aprU);

        // lender expected yield = borrowApr × utilization × (1 − reserveFactor)
        uint256 y = (aprU * util) / BPS;
        y = (y * (BPS - reserveFactorBps)) / BPS;
        supplyYield = uint16(y);
    }

    /// @notice Borrower APR for a risk band (0=A..3=D), built on the live market borrow APR. This is
    ///         what the underwriter writes into LoanRegistry terms, so loans are market-priced.
    function borrowAprForBand(uint8 band) external view returns (uint16) {
        (uint16 borrowApr,,,) = _compute();
        uint16[4] memory addOn = [uint16(0), 200, 500, 900]; // A,B,C,D risk add-ons
        uint256 a = uint256(borrowApr) + (band < 4 ? addOn[band] : 900);
        if (a > maxAprBps) a = maxAprBps;
        return uint16(a);
    }

    // ── admin ──────────────────────────────────────────────────────────────────
    function setParams(
        uint16 _kink,
        uint16 _slope1,
        uint16 _slope2,
        uint16 _demandSens,
        uint16 _reserve,
        uint16 _maxApr
    ) external onlyOwner {
        if (_kink > BPS || _reserve > BPS || _maxApr > BPS) revert BadParams();
        kinkBps = _kink;
        slope1Bps = _slope1;
        slope2Bps = _slope2;
        demandSensitivityBps = _demandSens;
        reserveFactorBps = _reserve;
        maxAprBps = _maxApr;
        emit ParamsUpdated();
    }

    function setMarketAdmin(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        emit MarketAdminUpdated(marketAdmin, a);
        marketAdmin = a;
    }

    function setOwner(address a) external onlyOwner {
        if (a == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, a);
        owner = a;
    }
}
