// Sorted-pair Merkle tree, same as OpenZeppelin MerkleProof (keccak256 of the sorted 64-byte pair).
import { concat, type Hex, keccak256 } from 'viem'

export function hashPair(a: Hex, b: Hex): Hex {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]))
}

/** leaves.length must be a power of two (pad with filler leaves first). */
export function buildTree(leaves: Hex[]): { root: Hex; proofs: Hex[][] } {
  const n = leaves.length
  if (n === 0 || (n & (n - 1)) !== 0) throw new Error('leaf count must be a power of two')
  const layers: Hex[][] = [leaves]
  while (layers[layers.length - 1]!.length > 1) {
    const prev = layers[layers.length - 1]!
    const next: Hex[] = []
    for (let i = 0; i < prev.length; i += 2) next.push(hashPair(prev[i]!, prev[i + 1]!))
    layers.push(next)
  }
  const proofs = leaves.map((_, idx) => {
    const path: Hex[] = []
    let i = idx
    for (let l = 0; l < layers.length - 1; l++) {
      path.push(layers[l]![i ^ 1]!)
      i >>= 1
    }
    return path
  })
  return { root: layers[layers.length - 1]![0]!, proofs }
}

export function verifyProof(leaf: Hex, path: Hex[], root: Hex): boolean {
  let h = leaf
  for (const p of path) h = hashPair(h, p)
  return h.toLowerCase() === root.toLowerCase()
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}
