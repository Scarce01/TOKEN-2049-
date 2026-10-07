"""Commit primitives, byte-identical to packages/shared (ids.ts, merkle.ts) and DecoyCommit.leafOf.

Vectors in tests/test_decoygen.py were produced by the TypeScript functions, so a drift on either side fails.
"""

import hashlib
import hmac

from Crypto.Hash import keccak as _keccak


def keccak(b: bytes) -> bytes:
    return _keccak.new(digest_bits=256, data=b).digest()


def u32(i: int) -> bytes:
    return i.to_bytes(4, "big")


def hmac_k(k: bytes, label: str, *parts: bytes) -> bytes:
    """HMAC(K, label || parts...), the only source of randomness (CLAUDE.md rule 5)."""
    return hmac.new(k, label.encode() + b"".join(parts), hashlib.sha256).digest()


def decoy_salt(k: bytes, i: int) -> bytes:
    return hmac_k(k, "decoy", u32(i))


def decoy_leaf(chain_id: int, ident: bytes, salt: bytes) -> bytes:
    """keccak256(bytes.concat(keccak256(abi.encode(uint256 chainId, bytes32 ident, bytes32 salt))))"""
    return keccak(keccak(chain_id.to_bytes(32, "big") + ident + salt))


def user_id_hash(org_salt: bytes, user_id: str) -> bytes:
    """keccak256(abi.encode(bytes32 orgSalt, string userId))"""
    s = user_id.encode()
    tail = len(s).to_bytes(32, "big") + s.ljust((len(s) + 31) // 32 * 32, b"\0")
    return keccak(org_salt + (64).to_bytes(32, "big") + tail)


def decoy_tag(k: bytes, kind: str, ident: bytes) -> bytes:
    return hmac_k(k, kind, ident)[:8]


def hash_pair(a: bytes, b: bytes) -> bytes:
    return keccak(a + b) if a < b else keccak(b + a)  # OZ MerkleProof sorted pairs


def build_tree(leaves: list[bytes]) -> tuple[bytes, list[list[bytes]]]:
    n = len(leaves)
    if n == 0 or n & (n - 1):
        raise ValueError("leaf count must be a power of two")
    layers = [leaves]
    while len(layers[-1]) > 1:
        p = layers[-1]
        layers.append([hash_pair(p[i], p[i + 1]) for i in range(0, len(p), 2)])
    proofs = []
    for i in range(n):
        proof, j = [], i
        for layer in layers[:-1]:
            proof.append(layer[j ^ 1])
            j >>= 1
        proofs.append(proof)
    return layers[-1][0], proofs


def verify(root: bytes, leaf: bytes, proof: list[bytes]) -> bool:
    h = leaf
    for p in proof:
        h = hash_pair(h, p)
    return h == root


def next_pow2(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p
