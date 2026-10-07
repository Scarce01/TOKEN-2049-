// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// 32-slot minute buckets: each word = minute (high 32 bits) | value (low 224 bits).
/// Slot = minute % 32. Same minute accumulates; a newer minute overwrites; an older one is dropped.
library MinuteRing {
    uint256 internal constant VALUE_MASK = (uint256(1) << 224) - 1;

    function pack(uint256 minute, uint256 value) internal pure returns (uint256) {
        return (minute << 224) | (value & VALUE_MASK);
    }

    function minuteOf(uint256 word) internal pure returns (uint256) {
        return word >> 224;
    }

    function valueOf(uint256 word) internal pure returns (uint256) {
        return word & VALUE_MASK;
    }

    /// Returns false when the slot already holds a newer minute (value not recorded).
    function add(uint256[32] storage ring, uint256 minute, uint256 amount) internal returns (bool) {
        uint256 slot = minute % 32;
        uint256 w = ring[slot];
        uint256 m = w >> 224;
        if (m == minute && w != 0) {
            ring[slot] = pack(minute, (w & VALUE_MASK) + amount);
        } else if (m < minute || w == 0) {
            ring[slot] = pack(minute, amount);
        } else {
            return false;
        }
        return true;
    }

    function bump(uint256[32] storage ring, uint256 minute) internal returns (bool) {
        return add(ring, minute, 1);
    }
}
