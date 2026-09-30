// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {PayrollGuard} from "../src/PayrollGuard.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 a) external returns (bool) { allowance[msg.sender][s] = a; return true; }
    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a; balanceOf[to] += a; return true;
    }
    function transferFrom(address f, address t, uint256 a) external returns (bool) {
        allowance[f][msg.sender] -= a; balanceOf[f] -= a; balanceOf[t] += a; return true;
    }
}

contract PayrollGuardTest is Test {
    MockUSDC usdc;
    PayrollGuard guard;
    address owner = address(0xA11CE);
    address operator = address(0xB0B);
    address stranger = address(0xBAD);
    address alice = address(0xA1);
    address bob = address(0xB1);
    bytes32 run1 = keccak256("run1");
    bytes32 k1 = keccak256("k1");
    bytes32 k2 = keccak256("k2");

    function setUp() public {
        usdc = new MockUSDC();
        guard = new PayrollGuard(address(usdc), owner, operator);
        usdc.mint(owner, 1_000e6);
        vm.prank(owner);
        usdc.approve(address(guard), type(uint256).max);
    }

    function _open(bytes32 run, bytes32 a, bytes32 b) internal {
        bytes32[] memory keys = new bytes32[](2);
        address[] memory rec = new address[](2);
        uint256[] memory amt = new uint256[](2);
        (keys[0], keys[1]) = (a, b);
        (rec[0], rec[1]) = (alice, bob);
        (amt[0], amt[1]) = (100e6, 50e6);
        vm.prank(owner);
        guard.openRun(run, keys, rec, amt);
    }

    function _one(bytes32 k, address r, uint256 a)
        internal
        pure
        returns (bytes32[] memory keys, address[] memory rec, uint256[] memory amt)
    {
        keys = new bytes32[](1);
        rec = new address[](1);
        amt = new uint256[](1);
        (keys[0], rec[0], amt[0]) = (k, r, a);
    }

    // S01
    function test_constructorRejectsZeroAndSameAddresses() public {
        vm.expectRevert("zero address");
        new PayrollGuard(address(0), owner, operator);
        vm.expectRevert("zero address");
        new PayrollGuard(address(usdc), address(0), operator);
        vm.expectRevert("zero address");
        new PayrollGuard(address(usdc), owner, address(0));
        vm.expectRevert("owner = operator");
        new PayrollGuard(address(usdc), owner, owner);
    }

    function test_deployerHasNoRole() public {
        assertEq(guard.owner(), owner);
        assertEq(guard.operator(), operator);
        vm.expectRevert("not owner");
        guard.closeRun(run1);
        vm.expectRevert("not operator");
        guard.pay(k1);
    }

    // S02
    function test_strangerAndWrongRoleCallNothing() public {
        (bytes32[] memory k, address[] memory r, uint256[] memory a) = _one(k1, alice, 1e6);
        vm.startPrank(stranger);
        vm.expectRevert("not owner");
        guard.openRun(run1, k, r, a);
        vm.expectRevert("not owner");
        guard.closeRun(run1);
        vm.expectRevert("not owner");
        guard.replaceOperator(stranger);
        vm.expectRevert("not operator");
        guard.pay(k1);
        vm.stopPrank();

        _open(run1, k1, k2);
        vm.prank(owner);
        vm.expectRevert("not operator");
        guard.pay(k1);
        vm.prank(operator);
        vm.expectRevert("not owner");
        guard.closeRun(run1);
    }

    // S03
    function test_openRunRejectsBadInput() public {
        vm.startPrank(owner);
        bytes32[] memory k = new bytes32[](2);
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](2);
        vm.expectRevert("bad lengths");
        guard.openRun(run1, k, r, a);

        (bytes32[] memory k1_, address[] memory r1, uint256[] memory a1) = _one(k1, alice, 0);
        vm.expectRevert("bad entry");
        guard.openRun(run1, k1_, r1, a1);
        (k1_, r1, a1) = _one(k1, address(0), 1e6);
        vm.expectRevert("bad entry");
        guard.openRun(run1, k1_, r1, a1);
        vm.stopPrank();
    }

    function test_duplicateKeyInSameRunRejected() public {
        vm.expectRevert("key committed");
        _open(run1, k1, k1);
    }

    function test_reusedRunKeyRejected() public {
        _open(run1, k1, k2);
        (bytes32[] memory k, address[] memory r, uint256[] memory a) = _one(keccak256("k3"), alice, 1e6);
        vm.prank(owner);
        vm.expectRevert("run key used");
        guard.openRun(run1, k, r, a);
    }

    function test_keyCommittedInOpenRunRejected() public {
        _open(run1, k1, k2);
        (bytes32[] memory k, address[] memory r, uint256[] memory a) = _one(k1, alice, 1e6);
        vm.prank(owner);
        vm.expectRevert("key committed");
        guard.openRun(keccak256("run2"), k, r, a);
    }

    function test_paidKeyCannotBeRecommitted() public {
        _open(run1, k1, k2);
        vm.prank(operator);
        guard.pay(k1);
        vm.prank(owner);
        guard.closeRun(run1);
        (bytes32[] memory k, address[] memory r, uint256[] memory a) = _one(k1, alice, 100e6);
        vm.prank(owner);
        vm.expectRevert("key committed");
        guard.openRun(keccak256("run2"), k, r, a);
    }

    function test_unpaidKeyOfClosedRunCanBeRecommitted() public {
        _open(run1, k1, k2);
        vm.prank(owner);
        guard.closeRun(run1);
        _open(keccak256("run2"), k1, k2);
        vm.prank(operator);
        guard.pay(k1);
        assertEq(usdc.balanceOf(alice), 100e6);
    }

    function test_payMovesCommittedAmountOnceToCommittedRecipient() public {
        _open(run1, k1, k2);
        assertEq(usdc.balanceOf(address(guard)), 150e6);
        vm.prank(operator);
        guard.pay(k1);
        assertEq(usdc.balanceOf(alice), 100e6);
        assertTrue(guard.isPaid(k1));
        assertFalse(guard.isPaid(k2));
        vm.prank(operator);
        vm.expectRevert("already paid");
        guard.pay(k1);
    }

    function test_payRejectsUncommittedKey() public {
        _open(run1, k1, k2);
        vm.prank(operator);
        vm.expectRevert("run not open");
        guard.pay(keccak256("nope"));
    }

    function test_payFailsAfterCloseAndCloseReturnsRemainderOnce() public {
        _open(run1, k1, k2);
        vm.prank(operator);
        guard.pay(k1);
        uint256 before = usdc.balanceOf(owner);
        vm.prank(owner);
        guard.closeRun(run1);
        assertEq(usdc.balanceOf(owner), before + 50e6);
        assertEq(usdc.balanceOf(address(guard)), 0);
        vm.prank(operator);
        vm.expectRevert("run not open");
        guard.pay(k2);
        vm.prank(owner);
        vm.expectRevert("run not open");
        guard.closeRun(run1);
    }

    function test_replaceOperator() public {
        vm.startPrank(owner);
        vm.expectRevert("bad operator");
        guard.replaceOperator(owner);
        vm.expectRevert("bad operator");
        guard.replaceOperator(address(0));
        guard.replaceOperator(stranger);
        vm.stopPrank();
        _open(run1, k1, k2);
        vm.prank(operator);
        vm.expectRevert("not operator");
        guard.pay(k1);
        vm.prank(stranger);
        guard.pay(k1);
    }

    function testFuzz_payoutEqualsFunding(uint96 a1, uint96 a2) public {
        a1 = uint96(bound(a1, 1, 400e6));
        a2 = uint96(bound(a2, 1, 400e6));
        bytes32[] memory keys = new bytes32[](2);
        address[] memory rec = new address[](2);
        uint256[] memory amt = new uint256[](2);
        (keys[0], keys[1]) = (k1, k2);
        (rec[0], rec[1]) = (alice, bob);
        (amt[0], amt[1]) = (a1, a2);
        vm.prank(owner);
        guard.openRun(run1, keys, rec, amt);
        vm.startPrank(operator);
        guard.pay(k1);
        guard.pay(k2);
        vm.stopPrank();
        assertEq(usdc.balanceOf(alice), a1);
        assertEq(usdc.balanceOf(bob), a2);
        assertEq(usdc.balanceOf(address(guard)), 0);
    }
}
