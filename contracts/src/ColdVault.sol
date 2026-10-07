// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {OfficerAuth} from "./lib/OfficerAuth.sol";
import {OfficerSet} from "./OfficerSet.sol";
import {Kinds} from "./lib/Kinds.sol";
import {IQuorumReceiverView} from "./interfaces/IQuorum.sol";

interface IFundable {
    function fund(address token, uint256 amount) external payable;
}

/// Cold vault: the last, slow, human-only channel (10_interfaces.md 3.4).
contract ColdVault is OfficerAuth {
    using SafeERC20 for IERC20;

    error NotReceiver();
    error OverMax();
    error NotQueued();
    error NotReady();
    error NotLower();
    error NativeSendFailed();

    event DelayRaised(uint64 delay);
    event DelayLowered(uint64 delay);
    event Queued(bytes32 indexed id, uint8 kind, address token, address to, uint256 amount, uint64 readyAt);
    event QueuedExecuted(bytes32 indexed id);
    event QueuedCancelled(bytes32 indexed id);

    struct Item {
        uint8 kind;
        bool done;
        uint64 readyAt;
        address token;
        address to;
        uint256 amount; // COLD_LOWER_DELAY: new delay
    }

    IQuorumReceiverView public immutable receiver;
    uint64 public immutable maxDelay;
    uint64 public delay;
    mapping(bytes32 => Item) public items;

    constructor(OfficerSet officerSet_, address receiver_, uint64 initialDelay, uint64 maxDelay_)
        OfficerAuth(officerSet_)
    {
        receiver = IQuorumReceiverView(receiver_);
        delay = initialDelay;
        maxDelay = maxDelay_;
    }

    receive() external payable {}

    /// Only up; same or lower value is a no-op so repeated reports stay idempotent.
    function raiseDelay(uint64 newDelay) external {
        if (msg.sender != address(receiver)) revert NotReceiver();
        if (newDelay > maxDelay) revert OverMax();
        if (newDelay > delay) {
            delay = newDelay;
            emit DelayRaised(newDelay);
        }
    }

    function queue(
        address token,
        address to,
        uint256 amount,
        uint256 nonce,
        uint64 deadline,
        bytes[] calldata sigs
    ) external returns (bytes32 id) {
        bytes32 subject = keccak256(abi.encode(token, to, amount));
        id = _consumeOfficers(Kinds.OA_COLD_QUEUE, subject, 0, nonce, deadline, sigs, 0);
        uint64 readyAt = uint64(block.timestamp) + delay;
        items[id] = Item(Kinds.OA_COLD_QUEUE, false, readyAt, token, to, amount);
        emit Queued(id, Kinds.OA_COLD_QUEUE, token, to, amount, readyAt);
    }

    /// Runs even at CONFIRMED alert. Our registered vaults are paid via fund() (asset conservation).
    function executeQueued(bytes32 id) external {
        Item storage it = _ready(id, Kinds.OA_COLD_QUEUE);
        it.done = true;
        if (receiver.isVault(it.to)) {
            if (it.token == address(0)) {
                IFundable(it.to).fund{value: it.amount}(address(0), it.amount);
            } else {
                IERC20(it.token).forceApprove(it.to, it.amount);
                IFundable(it.to).fund(it.token, it.amount);
            }
        } else if (it.token == address(0)) {
            (bool ok,) = it.to.call{value: it.amount}("");
            if (!ok) revert NativeSendFailed();
        } else {
            IERC20(it.token).safeTransfer(it.to, it.amount);
        }
        emit QueuedExecuted(id);
    }

    function queueLowerDelay(uint64 newDelay, uint256 nonce, uint64 deadline, bytes[] calldata sigs)
        external
        returns (bytes32 id)
    {
        if (newDelay >= delay) revert NotLower();
        id = _consumeOfficers(
            Kinds.OA_COLD_LOWER_DELAY, bytes32(uint256(uint160(address(this)))), newDelay, nonce, deadline, sigs, 0
        );
        uint64 readyAt = uint64(block.timestamp) + delay;
        items[id] = Item(Kinds.OA_COLD_LOWER_DELAY, false, readyAt, address(0), address(0), newDelay);
        emit Queued(id, Kinds.OA_COLD_LOWER_DELAY, address(0), address(0), newDelay, readyAt);
    }

    function executeLowerDelay(bytes32 id) external {
        Item storage it = _ready(id, Kinds.OA_COLD_LOWER_DELAY);
        it.done = true;
        if (it.amount < delay) {
            delay = uint64(it.amount);
            emit DelayLowered(delay);
        }
        emit QueuedExecuted(id);
    }

    function cancelQueued(bytes32 id, uint256 nonce, uint64 deadline, bytes[] calldata sigs) external {
        Item storage it = items[id];
        if (it.readyAt == 0 || it.done) revert NotQueued();
        _consumeOfficers(Kinds.OA_CANCEL_QUEUED, id, 0, nonce, deadline, sigs, 1);
        it.done = true;
        emit QueuedCancelled(id);
    }

    function _ready(bytes32 id, uint8 kind) private view returns (Item storage it) {
        it = items[id];
        if (it.readyAt == 0 || it.done || it.kind != kind) revert NotQueued();
        if (block.timestamp < it.readyAt) revert NotReady();
    }
}
