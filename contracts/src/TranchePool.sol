// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./interfaces/IERC20.sol";

/// @dev Minimal view of the LoanVault's funding entrypoint. We only need `fund(uint256)` to push
///      pooled lender capital into the money layer. We do NOT modify LoanVault — just call it.
interface ILoanVaultFund {
    function fund(uint256 amount) external;
}

/// @title TranchePool (Arc) — senior/junior lender accounting + yield waterfall. Stage 6 lender
///        side + Stage 8 yield waterfall.
/// @notice Lenders deposit USDC and pick a tranche. Senior (~80% of pool): fixed ~6% APY,
///         first-loss protected. Junior (~20%): absorbs defaults FIRST, takes the RESIDUAL
///         interest after senior's fixed share (~26% APY in the docs/01 worked example).
///         Pooled capital is deployed into the {LoanVault} via its existing `fund()`.
/// @dev    USDC = 6 decimals (Golden Rule #4); the USDC address is injected, never hardcoded
///         (Golden Rule #5). Cross-chain deposits (any chain → Arc) arrive via Circle Gateway /
///         CCTP V2 in the full design (Golden Rule #6); this contract is the Arc-native landing
///         pool — bridging is intentionally off the on-chain critical path (Golden Rule #7).
///
/// ─────────────────────────────────────────────────────────────────────────────────────────────
/// ACCOUNTING MODEL (documented): SHARES per tranche.
///   Each tranche is an independent vault with (totalShares, totalAssets). A lender's claim is
///   shares / totalShares of that tranche's totalAssets. This makes interest gains and loss
///   write-downs distribute *pro-rata* across a tranche's lenders automatically, with no per-loan
///   bookkeeping:
///     - deposit(amount): mints shares = amount * totalShares / totalAssets (1:1 for the first
///       depositor, scaled to 1e6 share units so a fresh tranche isn't share-price-1-wei fragile).
///     - withdraw(amount): burns the shares backing `amount` assets; pays out USDC.
///     - distributeInterest: ADDS USDC to tranche totalAssets (waterfall below). totalShares
///       unchanged ⇒ each share is worth more ⇒ that's the yield.
///     - absorbLoss: SUBTRACTS from tranche totalAssets (junior first). totalShares unchanged ⇒
///       each share is worth less ⇒ that's the loss.
///   `assetsOf(lender, tranche)` = the lender's current withdrawable (principal ± yield ∓ loss).
///
/// SENIOR-RATE MODEL (documented + simplification): time-based fixed accrual.
///   Senior targets a fixed `seniorRateBps` APY (default 600 = 6.00%). On each distributeInterest,
///   the senior's entitlement is the simple-interest it earned since the last distribution:
///       seniorAccrual = seniorAssets * seniorRateBps * elapsed / (BPS_DENOMINATOR * SECONDS_PER_YEAR)
///   Senior receives min(seniorAccrual, incomingAmount); JUNIOR receives the residual. If the
///   incoming interest can't cover the senior accrual (rare; thin junior buffer), senior simply
///   takes all of it that distribution and junior gets nothing — senior is never *guaranteed* more
///   cash than arrives, it just has first claim. SIMPLIFICATION: accrual is computed on the senior
///   *assets at distribution time* over wall-clock elapsed since the previous distribution; we do
///   not integrate continuously nor compound intra-period. This is the simplest defensible model
///   and matches the "senior gets its fixed slice first, junior gets the rest" thesis.
/// ─────────────────────────────────────────────────────────────────────────────────────────────
contract TranchePool {
    enum Tranche { Senior, Junior }

    // ── constants ────────────────────────────────────────────────────────────
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    /// @dev Initial shares minted per asset unit for the first depositor of a tranche. Keeps the
    ///      share price away from 1-wei rounding fragility without changing any economics.
    uint256 internal constant INITIAL_SHARE_RATE = 1e6;

    // ── immutables / config ──────────────────────────────────────────────────
    IERC20 public immutable usdc;
    address public owner;

    /// @notice Senior fixed-rate target in bps (e.g. 600 = 6.00% APY). Owner-configurable.
    uint16 public seniorRateBps;

    /// @notice Optional Stage 8 loss reporter (the LoanVault) authorized to call {absorbLoss} when a
    ///         loan defaults. address(0) = only the owner may report losses. Owner-settable.
    address public lossReporter;

    // ── per-tranche vault state ────────────────────────────────────────────────
    struct TrancheState {
        uint256 totalShares;
        uint256 totalAssets; // USDC backing this tranche (6 decimals)
        uint64  lastAccrualAt; // timestamp of the last interest distribution
    }

    mapping(Tranche => TrancheState) internal _tranches;
    mapping(address lender => mapping(Tranche => uint256 shares)) public sharesOf;

    // ── events ───────────────────────────────────────────────────────────────
    event Deposited(address indexed lender, Tranche indexed tranche, uint256 amount, uint256 shares);
    event Withdrawn(address indexed lender, Tranche indexed tranche, uint256 amount, uint256 shares);
    event InterestDistributed(uint256 amount, uint256 toSenior, uint256 toJunior);
    event LossAbsorbed(uint256 amount, uint256 fromJunior, uint256 fromSenior);
    event DeployedToVault(address indexed vault, uint256 amount);
    event SeniorRateUpdated(uint16 previousBps, uint16 newBps);
    event OwnerUpdated(address indexed previousOwner, address indexed newOwner);
    event LossReporterUpdated(address indexed previousReporter, address indexed newReporter);

    // ── errors ───────────────────────────────────────────────────────────────
    error NotOwner();
    error ZeroAmount();
    error TransferFailed();
    error InsufficientShares();
    error InsufficientLiquidity();
    error NothingToDistribute();
    error RateTooHigh();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param _usdc          Injected USDC address (6 decimals). Never hardcoded (Golden Rule #5).
    /// @param _seniorRateBps Senior fixed APY target in bps (e.g. 600 = 6%).
    constructor(address _usdc, uint16 _seniorRateBps) {
        if (_usdc == address(0)) revert ZeroAddress();
        if (_seniorRateBps > BPS_DENOMINATOR) revert RateTooHigh();
        usdc = IERC20(_usdc);
        seniorRateBps = _seniorRateBps;
        owner = msg.sender;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deposit / Withdraw
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Deposit USDC into a tranche. Caller must have approved this pool for `amount`.
    /// @dev    Mints shares at the current tranche share price. First depositor sets the price.
    function deposit(Tranche tranche, uint256 amount) external returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        TrancheState storage t = _tranches[tranche];

        // Lazily anchor the accrual clock the first time a tranche is funded so the senior's first
        // distribution accrues from its first deposit, not from contract deploy.
        if (t.totalShares == 0 && t.lastAccrualAt == 0) {
            t.lastAccrualAt = uint64(block.timestamp);
        }

        shares = _convertToShares(t, amount);

        _safeTransferFrom(msg.sender, address(this), amount);

        t.totalShares += shares;
        t.totalAssets += amount;
        sharesOf[msg.sender][tranche] += shares;

        emit Deposited(msg.sender, tranche, amount, shares);
    }

    /// @notice Withdraw `amount` USDC (principal ± accrued yield ∓ loss) from a tranche by burning
    ///         the backing shares. Reverts if the lender's position or on-hand liquidity is short.
    /// @dev    Liquidity = USDC actually held by this pool. Capital deployed to the LoanVault is NOT
    ///         instantly withdrawable; it returns as the vault is repaid and interest is distributed.
    function withdraw(Tranche tranche, uint256 amount) external returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        TrancheState storage t = _tranches[tranche];

        shares = _convertToSharesRoundUp(t, amount);
        uint256 held = sharesOf[msg.sender][tranche];
        if (shares > held) revert InsufficientShares();
        if (amount > usdc.balanceOf(address(this))) revert InsufficientLiquidity();

        t.totalShares -= shares;
        t.totalAssets -= amount;
        sharesOf[msg.sender][tranche] = held - shares;

        _safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, tranche, amount, shares);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Yield waterfall
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Pull `amount` of interest USDC in and apply the waterfall: senior takes its fixed
    ///         time-based accrual first, junior takes the residual. Caller must have approved this
    ///         pool for `amount`. Typically called by the protocol/owner as the vault is repaid.
    /// @return toSenior interest credited to the senior tranche.
    /// @return toJunior residual interest credited to the junior tranche.
    function distributeInterest(uint256 amount) external returns (uint256 toSenior, uint256 toJunior) {
        if (amount == 0) revert ZeroAmount();
        TrancheState storage senior = _tranches[Tranche.Senior];
        TrancheState storage junior = _tranches[Tranche.Junior];

        if (senior.totalShares == 0 && junior.totalShares == 0) revert NothingToDistribute();

        _safeTransferFrom(msg.sender, address(this), amount);

        // Senior's fixed accrual since its last distribution, capped at the incoming amount.
        uint256 seniorAccrual = _seniorAccrual(senior);
        toSenior = seniorAccrual > amount ? amount : seniorAccrual;

        // If there is no junior to take the residual, senior keeps everything (no idle USDC).
        toJunior = amount - toSenior;
        if (junior.totalShares == 0) {
            toSenior = amount;
            toJunior = 0;
        }

        // Reset senior's accrual clock to now (we've just settled its fixed slice).
        senior.lastAccrualAt = uint64(block.timestamp);

        if (toSenior > 0) senior.totalAssets += toSenior;
        if (toJunior > 0) junior.totalAssets += toJunior;

        emit InterestDistributed(amount, toSenior, toJunior);
    }

    /// @notice Write down `amount` of pool value (a default loss). Junior absorbs FIRST; only the
    ///         spillover once junior is exhausted hits senior. Owner/authorized only.
    /// @dev    This reduces tranche `totalAssets` (share price), not the USDC balance — the USDC
    ///         was already lost when the loan defaulted. Capped at total pool assets.
    /// @return fromJunior loss taken by junior.
    /// @return fromSenior loss taken by senior (only after junior is wiped).
    function absorbLoss(uint256 amount) external returns (uint256 fromJunior, uint256 fromSenior) {
        // Owner OR the wired loss reporter (the LoanVault's default hook) may report a loss. We reuse
        // the {NotOwner} selector for an unauthorized caller to keep the original access-control test
        // and its error surface unchanged.
        if (msg.sender != owner && msg.sender != lossReporter) revert NotOwner();
        if (amount == 0) revert ZeroAmount();
        TrancheState storage senior = _tranches[Tranche.Senior];
        TrancheState storage junior = _tranches[Tranche.Junior];

        fromJunior = amount > junior.totalAssets ? junior.totalAssets : amount;
        junior.totalAssets -= fromJunior;

        uint256 remaining = amount - fromJunior;
        if (remaining > 0) {
            fromSenior = remaining > senior.totalAssets ? senior.totalAssets : remaining;
            senior.totalAssets -= fromSenior;
        }

        emit LossAbsorbed(amount, fromJunior, fromSenior);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Deploy capital into the LoanVault (lender capital → loan capital)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Move `amount` of pooled USDC into the {LoanVault} by approving + calling its existing
    ///         `fund(amount)`. Owner-only. This is how lender deposits become loan capital.
    /// @dev    We do NOT modify LoanVault. The funded USDC leaves this pool's balance; its value is
    ///         still owed to lenders and returns via {distributeInterest} (interest) and repaid
    ///         principal routed back into the pool. A default is recognized via {absorbLoss}.
    function deployToVault(address vault, uint256 amount) external onlyOwner {
        if (vault == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (amount > usdc.balanceOf(address(this))) revert InsufficientLiquidity();

        // Approve exactly `amount`, then fund. Reset to 0 after to avoid lingering allowance.
        if (!usdc.approve(vault, amount)) revert TransferFailed();
        ILoanVaultFund(vault).fund(amount);
        usdc.approve(vault, 0);

        emit DeployedToVault(vault, amount);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Admin
    // ─────────────────────────────────────────────────────────────────────────

    function setSeniorRateBps(uint16 _seniorRateBps) external onlyOwner {
        if (_seniorRateBps > BPS_DENOMINATOR) revert RateTooHigh();
        emit SeniorRateUpdated(seniorRateBps, _seniorRateBps);
        seniorRateBps = _seniorRateBps;
    }

    function setOwner(address _owner) external onlyOwner {
        if (_owner == address(0)) revert ZeroAddress();
        emit OwnerUpdated(owner, _owner);
        owner = _owner;
    }

    /// @notice Set/rotate the Stage 8 loss reporter (the LoanVault) allowed to call {absorbLoss}.
    ///         Owner-only. address(0) disables it, leaving losses owner-only.
    function setLossReporter(address _lossReporter) external onlyOwner {
        emit LossReporterUpdated(lossReporter, _lossReporter);
        lossReporter = _lossReporter;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Views
    // ─────────────────────────────────────────────────────────────────────────

    function seniorTotal() external view returns (uint256) {
        return _tranches[Tranche.Senior].totalAssets;
    }

    function juniorTotal() external view returns (uint256) {
        return _tranches[Tranche.Junior].totalAssets;
    }

    function trancheState(Tranche tranche)
        external
        view
        returns (uint256 totalShares, uint256 totalAssets, uint64 lastAccrualAt)
    {
        TrancheState storage t = _tranches[tranche];
        return (t.totalShares, t.totalAssets, t.lastAccrualAt);
    }

    /// @notice A lender's current asset value (withdrawable, ignoring on-hand liquidity limits) in a
    ///         tranche: principal ± accrued yield ∓ absorbed loss.
    function assetsOf(address lender, Tranche tranche) public view returns (uint256) {
        TrancheState storage t = _tranches[tranche];
        if (t.totalShares == 0) return 0;
        return (sharesOf[lender][tranche] * t.totalAssets) / t.totalShares;
    }

    /// @notice A lender's currently *withdrawable* amount: their asset value capped at on-hand
    ///         pool liquidity (USDC not deployed to the vault).
    function withdrawableOf(address lender, Tranche tranche) external view returns (uint256) {
        uint256 assets = assetsOf(lender, tranche);
        uint256 liquidity = usdc.balanceOf(address(this));
        return assets > liquidity ? liquidity : assets;
    }

    /// @notice Pending senior fixed accrual if interest were distributed right now (informational).
    function pendingSeniorAccrual() external view returns (uint256) {
        return _seniorAccrual(_tranches[Tranche.Senior]);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal: shares math + accrual + safe transfers
    // ─────────────────────────────────────────────────────────────────────────

    function _convertToShares(TrancheState storage t, uint256 amount) internal view returns (uint256) {
        if (t.totalShares == 0 || t.totalAssets == 0) {
            return amount * INITIAL_SHARE_RATE;
        }
        return (amount * t.totalShares) / t.totalAssets;
    }

    /// @dev Round up shares on withdrawal so a withdrawer can never extract more value than their
    ///      shares back (rounding favors the pool / remaining lenders).
    function _convertToSharesRoundUp(TrancheState storage t, uint256 amount) internal view returns (uint256) {
        if (t.totalShares == 0 || t.totalAssets == 0) {
            return amount * INITIAL_SHARE_RATE;
        }
        return (amount * t.totalShares + t.totalAssets - 1) / t.totalAssets;
    }

    function _seniorAccrual(TrancheState storage senior) internal view returns (uint256) {
        if (senior.totalAssets == 0 || senior.lastAccrualAt == 0) return 0;
        uint256 elapsed = block.timestamp - senior.lastAccrualAt;
        if (elapsed == 0) return 0;
        return (senior.totalAssets * seniorRateBps * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
    }

    function _safeTransfer(address to, uint256 amount) internal {
        if (!usdc.transfer(to, amount)) revert TransferFailed();
    }

    function _safeTransferFrom(address from, address to, uint256 amount) internal {
        if (!usdc.transferFrom(from, to, amount)) revert TransferFailed();
    }
}
