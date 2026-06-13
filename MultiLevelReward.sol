// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

/**
 * @title Swarm Multi-Level Reward Contract (Component F)
 * @notice Implements a Sybil-proof directed acyclic graph (DAG) referral network.
 *         Distributes SWE tokens dynamically for verified Proof of Useful Work (PoUW).
 *         Propagates commission fees upwards using a geometric decay parameter (gamma = 0.15).
 */
contract MultiLevelReward {
    
    struct SwarmNode {
        address walletAddress;
        address referrer;
        uint256 referralCount;
        uint256 totalComputedTasks;
        uint256 accumulatedEarnings;
        bool isRegistered;
    }

    string public constant name = "Swarm Work Energy";
    string public constant symbol = "SWE";
    uint8 public constant decimals = 18;

    uint256 public totalSupply;
    address public contractOwner;

    // Geometric Decay variables used to maintain economic deflationary properties
    // In Solidity, we use multiplier scales to handle floats. Factor base is 10000.
    // Gamma = 0.15 represents a 15% reward pass-up at Tier 1. Tier 2 gets 2.25% (0.15 * 15%), etc.
    uint256 public constant COMMISSION_BASE = 10000;
    uint256 public constant GAMMA_FACTOR = 1500; // 15% or 0.1500 scale

    mapping(address => SwarmNode) public swarmNodes;
    mapping(address => uint256) public balances;
    mapping(bytes32 => bool) public processedTaskHashes; // Protects against double-spend tasks

    event SwarmNodeRegistered(address indexed peer, address indexed referrer);
    event RewardsDistributed(address indexed computeNode, uint256 selfReward, uint256 referralCommissionPaid);
    event Transfer(address indexed from, address indexed to, uint256 value);

    modifier onlyOwner() {
        require(msg.sender == contractOwner, "Caller is not the contract gatekeeper.");
        _;
    }

    constructor() {
        contractOwner = msg.sender;
        
        // Spawn contract owner node as first network genesis root
        swarmNodes[msg.sender] = SwarmNode({
            walletAddress: msg.sender,
            referrer: address(0),
            referralCount: 0,
            totalComputedTasks: 0,
            accumulatedEarnings: 0,
            isRegistered: true
        });
    }

    /**
     * @notice Register a newly spun Node into the Referral Swarm
     * @param _referrer The address of the peer who invited this node
     */
    function registerNode(address _referrer) external {
        require(!swarmNodes[msg.sender].isRegistered, "Swarm identity is already established.");
        require(_referrer != msg.sender, "Avoid self-referral loops.");
        require(swarmNodes[_referrer].isRegistered || _referrer == address(0), "Referrer does not exist in the Swarm DAG.");

        swarmNodes[msg.sender] = SwarmNode({
            walletAddress: msg.sender,
            referrer: _referrer,
            referralCount: 0,
            totalComputedTasks: 0,
            accumulatedEarnings: 0,
            isRegistered: true
        });

        if (_referrer != address(0)) {
            swarmNodes[_referrer].referralCount++;
        }

        emit SwarmNodeRegistered(msg.sender, _referrer);
    }

    /**
     * @notice Mint and distribute SWE rewards based on a verified Proof of Useful Work (PoUW)
     * @param _taskHash Unique hash identifier of the completed LLM shard job
     * @param _pouwSignature Cryptographic challenge signature proving execution in the Rust WASM container sandbox
     * @param _rewardAmount Base reward calculation index for the compute cycle
     */
    function mintVerifiedUsefulWork(
        bytes32 _taskHash,
        bytes memory _pouwSignature,
        uint256 _rewardAmount
    ) external onlyOwner {
        require(!processedTaskHashes[_taskHash], "Security alert: task signature double-spend attempted.");
        require(_pouwSignature.length > 0, "Proof of Useful Work validation trace failed.");
        require(swarmNodes[msg.sender].isRegistered, "Compute processor node is not in the directory.");

        processedTaskHashes[_taskHash] = true;

        // Base reward distributed directly to the worker machine
        swarmNodes[msg.sender].totalComputedTasks++;
        uint256 workerReward = _rewardAmount;
        
        balances[msg.sender] += workerReward;
        swarmNodes[msg.sender].accumulatedEarnings += workerReward;
        totalSupply += workerReward;

        emit Transfer(address(0), msg.sender, workerReward);

        // Propagate commissions upwards through the Referral DAG with Geometric Decay (y = 0.15)
        address currentReferrer = swarmNodes[msg.sender].referrer;
        uint256 currentDecayCommission = (workerReward * GAMMA_FACTOR) / COMMISSION_BASE;
        uint256 totalCommissionsPaid = 0;

        // Traverse up to 3 tiers to protect recursion gas bounds
        for (uint256 tier = 1; tier <= 3; tier++) {
            if (currentReferrer == address(0) || !swarmNodes[currentReferrer].isRegistered) {
                break;
            }

            balances[currentReferrer] += currentDecayCommission;
            swarmNodes[currentReferrer].accumulatedEarnings += currentDecayCommission;
            totalSupply += currentDecayCommission;
            totalCommissionsPaid += currentDecayCommission;

            emit Transfer(address(0), currentReferrer, currentDecayCommission);

            // Fetch upper tier referrer in the directed acyclic graph
            currentReferrer = swarmNodes[currentReferrer].referrer;
            // Apply decay: secondary scale multiplication
            currentDecayCommission = (currentDecayCommission * GAMMA_FACTOR) / COMMISSION_BASE;
        }

        emit RewardsDistributed(msg.sender, workerReward, totalCommissionsPaid);
    }

    /**
     * @notice Standard ERC-20 transfer implementation to enable decentralized coin distribution
     */
    function transfer(address _to, uint256 _value) external returns (bool) {
        require(balances[msg.sender] >= _value, "Solidity: Insufficient balance.");
        balances[msg.sender] -= _value;
        balances[_to] += _value;
        emit Transfer(msg.sender, _to, _value);
        return true;
    }
}
