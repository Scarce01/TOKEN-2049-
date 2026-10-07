# Submission links

Everything a judge needs, per track. Status as of 2026-10-07. Every link here opens without a login.

## Shared (every track)

| What | Link |
| --- | --- |
| Public repository | https://github.com/Scarce01/TOKEN-2049- |
| Benchmark report | [docs/BENCHMARK.md](BENCHMARK.md) |
| Benchmark white paper (HTML, download and open) | [docs/benchmark_whitepaper.html](benchmark_whitepaper.html) |
| Live deployment: addresses, workflow IDs, how it was deployed | [docs/DEPLOY_BASE_SEPOLIA.md](DEPLOY_BASE_SEPOLIA.md) |
| Chainlink proof page (live) | https://qu3ee-chainlink-proof.vercel.app |
| Solana evidence page (live) | https://dist-two-gamma-80.vercel.app |
| Demo video | [to add: link] |
| Pitch deck | [to add: link] |

Pre-existing work is disclosed in the README (Provenance). The Solana program under `solana/` was written at the
hackathon on 2026-10-07.

## Main track

Show it working end to end on public chains. The on-chain links:

| Claim | Link |
| --- | --- |
| Decoy touched (probe) | [0x236778f2…](https://sepolia.basescan.org/tx/0x236778f240c573d869949d54c4f3d2bf66e07057944d696a7e4006ba6299abde) |
| DON freezes the exchange 10 s later | [0x32ab0635…](https://sepolia.basescan.org/tx/0x32ab0635fff14b905027e50d102d71feb25e66383ca40b536b9405a9da1b834f) |
| Withdrawal request | [0x1043a218…](https://sepolia.basescan.org/tx/0x1043a21886eb2e165bb345901e65cff0b613ce5e08c96af71e94d76ca4f1ac43) |
| DON verdict APPROVE, 18 s later | [0x1f131727…](https://sepolia.basescan.org/tx/0x1f1317273a0e10ffba22d2b5af1a44d7f351cd785098bef5d2ab5f4b81d78b52) |
| Vault pays after the delay | [0x23cbf5de…](https://sepolia.basescan.org/tx/0x23cbf5deb4a0b8fab17db4316633c954dd956136b2f1ac5aa0056460b6da924f) |
| Patrol report accepted through the KeystoneForwarder | [0x554b02a6…](https://sepolia.basescan.org/tx/0x554b02a6a1cc1bfca7210cc0c6f504eaf1b6129a4be78ca4951861b240b320ec) |

## Chainlink: Best workflow with CRE

| Requirement | Link |
| --- | --- |
| **Proof page: every DON report, each workflow id linked to a Basescan tx that carries it** | https://qu3ee-chainlink-proof.vercel.app |
| CRE workflows (orchestration layer) | [workflows/trap](../workflows/trap), [workflows/cosign](../workflows/cosign), [workflows/patrol](../workflows/patrol) |
| Live deployment on the CRE network | Patrol `002d793802489c6c0b8e379240bd9f8f7b6189ba682c02f19969e31fcaeb5078`, Trap `006576bb13bfa082e9ccf563521e2004534f708992cf597054db84be8ff3cd66`, Cosign `00e143e0e4721b04f2eb4f7d07274a5307c82c66d2d0d45a3fa110258bcb0ebc` (private registry, all ACTIVE) |
| Blockchain plus external data | Base Sepolia contracts; NOWNodes RPC inside the Trap ([nownodes.ts](../workflows/trap/src/logic/nownodes.ts)); Trek proposals over the HTTP trigger |
| DON reports reaching the chain | the Base Sepolia transactions above (KeystoneForwarder `0xF8344CFd5c43616a4366C34E3EEE75af79a74482`) |
| Measured on the DON | [reports/don/don_benchmark.json](../reports/don/don_benchmark.json), [reports/don/cosign_public.json](../reports/don/cosign_public.json) |

Contracts (Base Sepolia, PROD mode):
[RequestBoard](https://sepolia.basescan.org/address/0x6b414d32bfA45336B763442D4948115D8e8247df) ·
[ThreatRegistry](https://sepolia.basescan.org/address/0x602C867AE814bcC61581bFC35d13d3dFeDBC3fE5) ·
[Receiver A](https://sepolia.basescan.org/address/0x8089424197ce5F64eFf7db3ab9c9fbEf4E173630) ·
[Receiver B](https://sepolia.basescan.org/address/0x3304068e75Cdac0D3aFfB1120ffd4411152d551e) ·
[ConfigTimelock](https://sepolia.basescan.org/address/0x29228a9969f1318E5a598fBE07da812187D3DFe5)

## NOWNodes

| Requirement | Link |
| --- | --- |
| NOWNodes in the architecture: second source in the Trap | [workflows/trap/src/logic/nownodes.ts](../workflows/trap/src/logic/nownodes.ts) (Ethereum Sepolia run in the README results) |
| NOWNodes in the architecture: multichain tracing (BSC, Optimism, Arbitrum, Base) | [analysis/trace_bybit/xchain.py](../analysis/trace_bybit/xchain.py), result [bitget_xchain_result.json](../analysis/trace_bybit/results/bitget_xchain_result.json) |
| How it is used | [docs/BENCHMARK.md](BENCHMARK.md) section 3 (Bitget: 8 to 12 of 14 wallets, 2,671 calls) |

NOWNodes has no Base Sepolia or Solana devnet endpoint, so those two use other RPCs; this is stated in the README.

## Solana: Best use of Solana

| Requirement | Link |
| --- | --- |
| Program ID, cluster | [`HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz`](https://explorer.solana.com/address/HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz?cluster=devnet), devnet |
| Example transaction: transfer before containment, SUCCESS | [2NBywAz9…](https://explorer.solana.com/tx/2NBywAz97EinV7i7aBWAWsQai2Y3nQZDDMFEFb5KeHBTjviNhyrqTpcqLfXFBEtcjfjb561VkUJJscthF39qY4w6?cluster=devnet) |
| Example transaction: Guard set to CONTAINED from the Base Sepolia DON report | [xcKtP7Q4…](https://explorer.solana.com/tx/xcKtP7Q4xsZmNPQXMHKvE1EqttUVuFvYeUEbLjp6r5N4tiCZqAXv49LqiNLyufYacAkP1jp5tQyRNrYrAMC1weU?cluster=devnet) |
| Example transaction: same transfer after, REJECTED on chain | [2jhbFKJ9…](https://explorer.solana.com/tx/2jhbFKJ9uWVgTJbsxnB9WCxWGuVcUsQi1oMabuC1u5BWMusP4cfTFYykhJSs9RdrfGw22w9GjrEGDXqmR5vHwkZd?cluster=devnet) |
| qUSD-S mint (Token-2022, transfer hook) | [`6D7PygkF5K85JS1Cbkxvz6J4Q7vrY1byCLx47T3w91o6`](https://explorer.solana.com/address/6D7PygkF5K85JS1Cbkxvz6J4Q7vrY1byCLx47T3w91o6?cluster=devnet) |
| Evidence page with every transaction | https://dist-two-gamma-80.vercel.app |
| Code, tests, how to run it alone | [solana/README.md](../solana/README.md) (`pnpm solana:test`, `pnpm solana:demo`) |
| Hackathon work disclosed | [solana/README.md](../solana/README.md), first paragraph |

## Not submitting

Cardano (Agentic Commerce): nothing is built on Cardano, so we do not enter that track.
