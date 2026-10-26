// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// Pays only obligations the owner committed at openRun, each once, and only when the operator calls.
/// No upgrade path, no arbitrary withdraw, no function edits a paid or open-run entry.
contract PayrollGuard {
    struct Entry {
        bytes32 runKey; // zero = never committed
        address recipient;
        uint256 amount;
        bool paid;
    }

    struct Run {
        bool exists;
        bool open;
        uint256 unpaid;
    }

    IERC20 public immutable usdc;
    address public immutable owner;
    address public operator;

    mapping(bytes32 => Entry) public entries;
    mapping(bytes32 => Run) public runs;

    event RunOpened(bytes32 indexed runKey, uint256 total, uint256 count);
    event ObligationPaid(bytes32 indexed runKey, bytes32 indexed obligationKey, address recipient, uint256 amount);
    event RunClosed(bytes32 indexed runKey, uint256 returned);
    event OperatorReplaced(address indexed newOperator);

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    constructor(address usdc_, address owner_, address operator_) {
        require(usdc_ != address(0) && owner_ != address(0) && operator_ != address(0), "zero address");
        require(owner_ != operator_, "owner = operator");
        usdc = IERC20(usdc_);
        owner = owner_;
        operator = operator_;
    }

    function openRun(
        bytes32 runKey,
        bytes32[] calldata keys,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external onlyOwner {
        require(runKey != bytes32(0) && !runs[runKey].exists, "run key used");
        require(keys.length > 0 && keys.length == recipients.length && keys.length == amounts.length, "bad lengths");
        runs[runKey] = Run({exists: true, open: true, unpaid: 0});
        uint256 total;
        for (uint256 i = 0; i < keys.length; i++) {
            Entry storage e = entries[keys[i]];
            require(keys[i] != bytes32(0) && recipients[i] != address(0) && amounts[i] > 0, "bad entry");
            // a key is free only if never committed, or its run closed with the key unpaid
            require(e.runKey == bytes32(0) || (!e.paid && !runs[e.runKey].open), "key committed");
            e.runKey = runKey;
            e.recipient = recipients[i];
            e.amount = amounts[i];
            total += amounts[i];
        }
        runs[runKey].unpaid = total;
        require(usdc.transferFrom(msg.sender, address(this), total), "funding failed");
        emit RunOpened(runKey, total, keys.length);
    }

    function pay(bytes32 obligationKey) external {
        require(msg.sender == operator, "not operator");
        Entry storage e = entries[obligationKey];
        require(e.runKey != bytes32(0) && runs[e.runKey].open, "run not open");
        require(!e.paid, "already paid");
        e.paid = true;
        runs[e.runKey].unpaid -= e.amount;
        require(usdc.transfer(e.recipient, e.amount), "transfer failed");
        emit ObligationPaid(e.runKey, obligationKey, e.recipient, e.amount);
    }

    function closeRun(bytes32 runKey) external onlyOwner {
        Run storage r = runs[runKey];
        require(r.open, "run not open");
        r.open = false;
        uint256 back = r.unpaid;
        r.unpaid = 0;
        if (back > 0) require(usdc.transfer(owner, back), "return failed");
        emit RunClosed(runKey, back);
    }

    function replaceOperator(address newOperator) external onlyOwner {
        require(newOperator != address(0) && newOperator != owner, "bad operator");
        operator = newOperator;
        emit OperatorReplaced(newOperator);
    }

    function isPaid(bytes32 obligationKey) external view returns (bool) {
        return entries[obligationKey].paid;
    }
}
