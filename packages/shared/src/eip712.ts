import { type Address, type Hex, hashTypedData } from 'viem'

/** EIP-712 type sets (10_interfaces.md section 2). */
export const WithdrawalTypes = {
  Withdrawal: [
    { name: 'orgId', type: 'bytes32' },
    { name: 'userIdHash', type: 'bytes32' },
    { name: 'vault', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const

export const KeyBindingTypes = {
  KeyBinding: [
    { name: 'userIdHash', type: 'bytes32' },
    { name: 'key', type: 'address' },
    { name: 'action', type: 'uint8' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const

export const OfficerActionTypes = {
  OfficerAction: [
    { name: 'kind', type: 'uint8' },
    { name: 'subject', type: 'bytes32' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const

export const withdrawalDomain = (chainId: number, requestBoard: Address) =>
  ({ name: 'Quorum', version: '1', chainId, verifyingContract: requestBoard }) as const
export const keyDomain = (chainId: number, keyRegistry: Address) =>
  ({ name: 'QuorumKeys', version: '1', chainId, verifyingContract: keyRegistry }) as const
export const officerDomain = (chainId: number, target: Address) =>
  ({ name: 'QuorumOfficer', version: '1', chainId, verifyingContract: target }) as const

export type Intent = {
  orgId: Hex
  userIdHash: Hex
  vault: Address
  token: Address
  to: Address
  amount: bigint
  nonce: bigint
  deadline: bigint
}

export type OfficerAction = { kind: number; subject: Hex; value: bigint; nonce: bigint; deadline: bigint }

export const KeyAction = {
  REGISTER: 1,
  REQUEST_CHANGE: 2,
  CANCEL_CHANGE: 3,
  // docs/47 3.7
  ROTATE: 4,
  APPROVE_RECOVERY: 5,
  FACTOR: 6,
  CANCEL_FACTOR: 7,
} as const

export function intentDigest(chainId: number, board: Address, it: Intent): Hex {
  return hashTypedData({
    domain: withdrawalDomain(chainId, board),
    types: WithdrawalTypes,
    primaryType: 'Withdrawal',
    message: it,
  })
}

export function officerDigest(chainId: number, target: Address, a: OfficerAction): Hex {
  return hashTypedData({
    domain: officerDomain(chainId, target),
    types: OfficerActionTypes,
    primaryType: 'OfficerAction',
    message: a,
  })
}

/** docs/47 3.3: the user cancels their own queued withdrawal; signed with the registered key. */
export const CancelWithdrawalTypes = {
  CancelWithdrawal: [
    { name: 'txHash', type: 'bytes32' },
    { name: 'deadline', type: 'uint64' },
  ],
} as const
export const cancelDomain = (chainId: number, receiver: Address) =>
  ({ name: 'QuorumReceiver', version: '1', chainId, verifyingContract: receiver }) as const

export function cancelDigest(chainId: number, receiver: Address, txHash: Hex, deadline: bigint): Hex {
  return hashTypedData({
    domain: cancelDomain(chainId, receiver),
    types: CancelWithdrawalTypes,
    primaryType: 'CancelWithdrawal',
    message: { txHash, deadline },
  })
}

/** Contracts require officer signatures sorted by signer address ascending. */
export function sortSigs(entries: { signer: Address; sig: Hex }[]): Hex[] {
  return [...entries]
    .sort((x, y) => (BigInt(x.signer) < BigInt(y.signer) ? -1 : BigInt(x.signer) > BigInt(y.signer) ? 1 : 0))
    .map((e) => e.sig)
}
