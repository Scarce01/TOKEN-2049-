// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Report action kinds, decisions and officer action kinds (docs/10_interfaces.md sections 2 and 4).
library Kinds {
    // report actions
    uint8 internal constant PING = 0;
    uint8 internal constant VERDICT = 1;
    uint8 internal constant ALERT = 2;
    uint8 internal constant FREEZE = 3;
    uint8 internal constant SWEEP = 4;
    uint8 internal constant QUOTA_ZERO = 5;
    uint8 internal constant COLD_DELAY = 6;
    uint8 internal constant THREAT = 7;
    uint8 internal constant QUOTA_REFILL = 8;
    uint8 internal constant SCORE = 9;
    uint8 internal constant TOPUP = 10;
    uint8 internal constant THRESHOLD_COMMIT = 11;
    uint8 internal constant THRESHOLD_REVEAL = 12;
    uint8 internal constant PATROL_STATE = 13;
    uint8 internal constant ASSET_CHECKPOINT = 14;

    // decisions
    uint8 internal constant NONE = 0;
    uint8 internal constant APPROVE = 1;
    uint8 internal constant REJECT = 2;
    uint8 internal constant PENDING = 3;

    // alert levels
    uint8 internal constant CONFIRMED = 4;

    // officer action kinds
    uint8 internal constant OA_EXTEND_FREEZE = 1;
    uint8 internal constant OA_MANUAL_APPROVE = 2;
    uint8 internal constant OA_LOWER_ALERT = 3;
    uint8 internal constant OA_COLD_QUEUE = 4;
    uint8 internal constant OA_COLD_LOWER_DELAY = 5;
    uint8 internal constant OA_CANCEL_QUEUED = 6;
    uint8 internal constant OA_CONFIG = 7;
    uint8 internal constant OA_PLANNED_OP = 8;
    uint8 internal constant OA_RESET_ASSET_CHECKPOINT = 9;
    uint8 internal constant OA_HOLD_VERDICT = 10; // one officer, expires (docs/47)
    uint8 internal constant OA_CANCEL_VERDICT = 11; // two officers (docs/47)

    /// Tightening kinds still run when the report is older than REPORT_MAX_AGE (3.2 step 4).
    function isTightening(uint8 k) internal pure returns (bool) {
        return k == ALERT || k == FREEZE || k == SWEEP || k == QUOTA_ZERO || k == COLD_DELAY || k == THREAT;
    }

    /// Actions that emit Tightened(caseId, kind).
    function emitsTightened(uint8 k) internal pure returns (bool) {
        return k == ALERT || k == FREEZE || k == SWEEP || k == QUOTA_ZERO || k == COLD_DELAY || k == THREAT;
    }

    function bit(uint8 k) internal pure returns (uint256) {
        return uint256(1) << k;
    }
}
