# redteam (left for the attack-script author)

`scan` and `attack` read only `GET /admin/hot-wallets` on the local exchange-api.
The list fields are label, chain, address, kind, status, and balance. `attack` asks `POST /admin/hot-wallets/transfer` to sign 1 qUSD from `select()` to `ATTACKER_RECEIVER` on Ethereum Sepolia. The key stays on the API.
Neither command takes a wallet address, and neither reads `secrets/`, `quorum_index`, or workflow config.

Commands still to implement (32_phase2.md 2.7, 33_phase3.md 3.6, 34_phase4.md 4.4): recon, probe, probe --native,
race, wipe, drain, status, forge, forge-decoy, pay-decoy-addr, register-hijack, same-block, stop-cre,
grief-deposit, bybit, replay, execute-pending, hop. Uses exchange_a_app and the admin token only; it must not
read quorum_index or secrets/decoys.local.json (attackers do not have them).
