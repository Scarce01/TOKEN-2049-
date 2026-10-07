// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// Officer list and threshold. Changes only via ConfigTimelock (10_interfaces.md section 10).
/// The timelock address is bound once with `initialize` (deploy-order cycle, D20).
contract OfficerSet {
    error NotTimelock();
    error AlreadyInitialized();
    error NotDeployer();
    error BadOfficers();

    event OfficersSet(address[] officers, uint256 threshold);

    address private immutable deployer;
    address public timelock;
    address[] private _officers;
    mapping(address => bool) public isOfficer;
    uint256 public threshold;

    constructor(address[] memory officers_, uint256 threshold_) {
        deployer = msg.sender;
        _set(officers_, threshold_);
    }

    /// One-time binding of the ConfigTimelock. Locked after the first call.
    function initialize(address timelock_) external {
        if (msg.sender != deployer) revert NotDeployer();
        if (timelock != address(0)) revert AlreadyInitialized();
        timelock = timelock_;
    }

    function setOfficers(address[] calldata officers_, uint256 threshold_) external {
        if (msg.sender != timelock || timelock == address(0)) revert NotTimelock();
        _set(officers_, threshold_);
    }

    function officers() external view returns (address[] memory) {
        return _officers;
    }

    function _set(address[] memory officers_, uint256 threshold_) private {
        if (threshold_ < 2 || threshold_ > officers_.length) revert BadOfficers();
        for (uint256 i; i < _officers.length; ++i) isOfficer[_officers[i]] = false;
        delete _officers;
        for (uint256 i; i < officers_.length; ++i) {
            address o = officers_[i];
            if (o == address(0) || isOfficer[o]) revert BadOfficers();
            isOfficer[o] = true;
            _officers.push(o);
        }
        threshold = threshold_;
        emit OfficersSet(officers_, threshold_);
    }
}
