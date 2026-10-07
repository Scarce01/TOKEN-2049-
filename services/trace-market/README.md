# QUBEE Trace Agent + Investigator (Cardano x402, preprod)

QUBEE can buy specialist forensic intelligence from another agent, paying per call over x402 on Cardano.

- `src/server.ts`: the Trace Agent. `GET /api/trace/:address` answers `402` with x402 terms (1 tADA on
  `cardano:preprod`). A paid retry is verified and settled by the hosted Cardano Foundation facilitator and returns
  the addresses that received tainted funds downstream of that address, each with its evidence tx. It holds no keys.
  An unknown address gets `404`, and x402 does not settle a 4xx, so nobody pays for an empty answer.
- `src/investigator.ts`: the QUBEE Investigator. Asks without paying, reads the 402 terms, applies the spend policy
  (`src/policy.ts`), pays from its preprod wallet, retries, and writes the evidence the Observatory shows on the
  Replay Network tab.
- `data/trace_index.json`: from `analysis/trace_bybit/trace_index.py` (public on-chain replay data: Bybit, Bitget,
  Stake). Paying for a trace never changes a classification: every result is LINKED.

Cardano does not decide whether an Ethereum attack is real; that stays with Ethereum, CRE and NOWNodes. The
Investigator starts after QUBEE has a case (CONFIRMED or LINKED; BEHAVIOR never pays).

## Run

```bash
pnpm -C services/trace-market wallet       # once: payer + payee wallets; keys only in .env.investigator / .env.payee
pnpm cardano:seller                        # Trace Agent on :4021
pnpm cardano:investigate                   # 402 -> pay -> 200 for the Bybit replay seed
pnpm -C services/trace-market test         # spend policy (C06), evidence on every link (C07)
```

Fund the payer address printed by `wallet` at https://docs.cardano.org/cardano-testnets/tools/faucet (preprod).
