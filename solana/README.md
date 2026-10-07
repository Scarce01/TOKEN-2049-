# Qu3ee Solana Guard (devnet)

Hackathon work: everything in this folder was written at TOKEN2049 on 2026-10-07. It reacts to the Qu3ee EVM side
(contracts on Base Sepolia, Chainlink CRE workflows), which existed before and is described in the main README.

**What it is.** qUSD-S is a Token-2022 test mint whose transfer hook is the Qu3ee Guard program. Every transfer calls
the hook, which reads the mint's Guard PDA: NORMAL allows the transfer, CONTAINED fails it on chain. A Guard moves to
CONTAINED when a confirmed Qu3ee threat arrives: the demo uses the Chainlink DON's real Trap report on Base Sepolia,
checked on Base (KeystoneForwarder accepted it, the Receiver logged FREEZE and THREAT) before it is applied.

| | |
| --- | --- |
| Cluster | devnet |
| Program ID | [`HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz`](https://explorer.solana.com/address/HaJ4J8KhE5FGfBFpgrwkqXk6yXfdjNYJpLjJ71KGrEXz?cluster=devnet) |
| qUSD-S mint (latest run) | [`6D7PygkF5K85JS1Cbkxvz6J4Q7vrY1byCLx47T3w91o6`](https://explorer.solana.com/address/6D7PygkF5K85JS1Cbkxvz6J4Q7vrY1byCLx47T3w91o6?cluster=devnet) |
| Transfer before containment | [SUCCESS](https://explorer.solana.com/tx/2NBywAz97EinV7i7aBWAWsQai2Y3nQZDDMFEFb5KeHBTjviNhyrqTpcqLfXFBEtcjfjb561VkUJJscthF39qY4w6?cluster=devnet) |
| Guard set to CONTAINED | [tx](https://explorer.solana.com/tx/xcKtP7Q4xsZmNPQXMHKvE1EqttUVuFvYeUEbLjp6r5N4tiCZqAXv49LqiNLyufYacAkP1jp5tQyRNrYrAMC1weU?cluster=devnet), evidence [Base Sepolia](https://sepolia.basescan.org/tx/0x32ab0635fff14b905027e50d102d71feb25e66383ca40b536b9405a9da1b834f) |
| Same transfer after | [REJECTED on chain](https://explorer.solana.com/tx/2jhbFKJ9uWVgTJbsxnB9WCxWGuVcUsQi1oMabuC1u5BWMusP4cfTFYykhJSs9RdrfGw22w9GjrEGDXqmR5vHwkZd?cluster=devnet) (`Contained`) |

Full run: [demo/solana-latest-run.json](../demo/solana-latest-run.json). Every transaction: [demo/solana-history.json](../demo/solana-history.json).
Evidence page: `solana/site/dist/index.html` (static; open locally or host on any static host).

## Rules the program enforces

- Only the Guard's authority changes its state (S03, S08)
- The same case twice leaves the same state (S06); older evidence cannot override newer state (S07)
- One Guard per org and mint: org A's containment does not touch org B (S05); other mints are unaffected (S04)
- The hook makes no external calls; leaving out the hook accounts, swapping in another Guard, or calling the hook
  outside a transfer all fail

## Run it

```sh
cd solana && anchor build && bun install
bun test tests                 # 16 tests on a local solana-test-validator (S01 to S08, hook wiring, no bypass)
cd .. && bun solana/scripts/demo.ts       # devnet: mint qUSD-S, transfer, contain, same transfer rejected
bun solana/scripts/history.ts && bun solana/site/build.ts   # transaction history and the evidence page
```

Devnet keys and the RPC URL live in `secrets/solana/` (gitignored): `deployer.json`, `authority.json`, `alice.json`,
`bob.json`, `rpc.env` with `SOLANA_RPC_URL` (a devnet RPC; the public one rate-limits).

## Next (P1)

Chainlink CRE Solana write: the DON's report goes through the Solana keystone-forwarder into an `on_report`
instruction, so the Guard's authority becomes the DON itself instead of a key. CRE SDK 1.23 ships the Solana client;
the receiver instruction is not written yet.
