// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title MultiLevelReward
 * @notice On-chain reward accounting for the LLM Mission Control decentralized
 *         compute swarm. Nodes earn compute credits for contributed inference
 *         work; credits accrue reward tokens at a tier multiplier that scales
 *         with cumulative lifetime contribution (multi-level).
 *
 * @dev Off-chain orchestrator (backend/mesh/p2p_network.go) reports verified
 *      compute units per settlement epoch. Rewards are pull-based: nodes claim
 *      their accrued balance. No external token dependency — the contract mints
 *      an internal reward ledger that a bridge/ERC-20 wrapper can settle later.
 */
contract MultiLevelReward {
    // ----- Roles -----
    address public owner;
    mapping(address => bool) public orchestrators; // authorized work reporters

    // ----- Tiers (multi-level) -----
    // Tier multiplier in basis points (10000 = 1.0x). Higher lifetime
    // contribution => higher tier => more reward per compute unit.
    struct Tier {
        uint256 threshold; // cumulative compute units required to reach tier
        uint256 multiplierBps; // reward multiplier in basis points
    }

    Tier[] public tiers;

    // ----- Per-node accounting -----
    struct Node {
        uint256 lifetimeUnits; // total compute units ever contributed
        uint256 pendingReward; // claimable reward balance
        uint256 epochUnits; // units contributed in current epoch
        bool registered;
    }

    mapping(address => Node) public nodes;
    address[] public nodeList;

    uint256 public rewardPerUnit; // base reward per compute unit (pre-multiplier)
    uint256 public currentEpoch;
    uint256 public totalDistributed;

    // ----- Events -----
    event NodeRegistered(address indexed node);
    event WorkReported(address indexed node, uint256 units, uint256 reward, uint256 tier);
    event RewardClaimed(address indexed node, uint256 amount);
    event EpochSettled(uint256 indexed epoch, uint256 totalUnits);
    event OrchestratorSet(address indexed account, bool authorized);

    // ----- Modifiers -----
    modifier onlyOwner() {
        require(msg.sender == owner, "MLR: not owner");
        _;
    }

    modifier onlyOrchestrator() {
        require(orchestrators[msg.sender], "MLR: not orchestrator");
        _;
    }

    constructor(uint256 _rewardPerUnit) {
        owner = msg.sender;
        orchestrators[msg.sender] = true;
        rewardPerUnit = _rewardPerUnit;

        // Default 4-level reward curve.
        tiers.push(Tier({threshold: 0, multiplierBps: 10000})); // L0 1.0x
        tiers.push(Tier({threshold: 1_000, multiplierBps: 11500})); // L1 1.15x
        tiers.push(Tier({threshold: 10_000, multiplierBps: 13000})); // L2 1.30x
        tiers.push(Tier({threshold: 100_000, multiplierBps: 15000})); // L3 1.50x
    }

    // ----- Admin -----
    function setOrchestrator(address account, bool authorized) external onlyOwner {
        orchestrators[account] = authorized;
        emit OrchestratorSet(account, authorized);
    }

    function setRewardPerUnit(uint256 _rewardPerUnit) external onlyOwner {
        rewardPerUnit = _rewardPerUnit;
    }

    function setTier(uint256 index, uint256 threshold, uint256 multiplierBps) external onlyOwner {
        require(index < tiers.length, "MLR: bad tier index");
        require(multiplierBps >= 10000, "MLR: multiplier < 1.0x");
        tiers[index] = Tier({threshold: threshold, multiplierBps: multiplierBps});
    }

    // ----- Core accounting -----

    /// @notice Resolve the tier index a node currently qualifies for.
    function tierOf(address node) public view returns (uint256) {
        uint256 units = nodes[node].lifetimeUnits;
        uint256 idx = 0;
        for (uint256 i = 0; i < tiers.length; i++) {
            if (units >= tiers[i].threshold) {
                idx = i;
            }
        }
        return idx;
    }

    /// @notice Orchestrator reports verified compute units for a node.
    function reportWork(address node, uint256 units) public onlyOrchestrator {
        require(units > 0, "MLR: zero units");

        Node storage n = nodes[node];
        if (!n.registered) {
            n.registered = true;
            nodeList.push(node);
            emit NodeRegistered(node);
        }

        uint256 tier = tierOf(node);
        uint256 multiplier = tiers[tier].multiplierBps;
        uint256 reward = (units * rewardPerUnit * multiplier) / 10000;

        n.lifetimeUnits += units;
        n.epochUnits += units;
        n.pendingReward += reward;

        emit WorkReported(node, units, reward, tier);
    }

    /// @notice Batch variant for epoch settlement of many nodes at once.
    function reportWorkBatch(address[] calldata batchNodes, uint256[] calldata batchUnits)
        external
        onlyOrchestrator
    {
        require(batchNodes.length == batchUnits.length, "MLR: length mismatch");
        for (uint256 i = 0; i < batchNodes.length; i++) {
            reportWork(batchNodes[i], batchUnits[i]);
        }
    }

    /// @notice Close the current epoch, resetting per-epoch counters.
    function settleEpoch() external onlyOrchestrator {
        uint256 totalUnits = 0;
        for (uint256 i = 0; i < nodeList.length; i++) {
            address node = nodeList[i];
            totalUnits += nodes[node].epochUnits;
            nodes[node].epochUnits = 0;
        }
        emit EpochSettled(currentEpoch, totalUnits);
        currentEpoch += 1;
    }

    /// @notice Node pulls its accrued reward balance.
    function claim() external returns (uint256) {
        Node storage n = nodes[msg.sender];
        uint256 amount = n.pendingReward;
        require(amount > 0, "MLR: nothing to claim");

        n.pendingReward = 0;
        totalDistributed += amount;

        emit RewardClaimed(msg.sender, amount);
        return amount;
    }

    // ----- Views -----
    function pendingReward(address node) external view returns (uint256) {
        return nodes[node].pendingReward;
    }

    function nodeCount() external view returns (uint256) {
        return nodeList.length;
    }

    function tierCount() external view returns (uint256) {
        return tiers.length;
    }
}
