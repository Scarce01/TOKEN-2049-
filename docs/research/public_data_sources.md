# Public data sources (verified)

Accessed: 2026-10-05. Machine-readable copy: `datasets/public/public_sources.json`.
Source class for every value below: public on-chain data or public documentation (rule 8).
Addresses are copied from the raw source (HTML, PDF text, JSON or RPC), not retyped.

| # | Item | Status |
| --- | --- | --- |
| 1 | FBI PSA on Bybit | verified |
| 2 | Bybit hack facts | verified |
| 3 | BlockSec Bitget analysis | partially verified |
| 4 | Chainlink ETH/USD feeds | verified |
| 5 | CRE forwarders | verified |
| 6 | Exchange wallet labels | partially verified |
| 7 | Label / scam datasets | verified |

## 1. FBI PSA on the Bybit hack

| Field | Value |
| --- | --- |
| Title | North Korea Responsible for $1.5 Billion Bybit Hack |
| Alert number | I-022625-PSA |
| Date | February 26, 2025 |
| URL | https://www.ic3.gov/psa/2025/psa250226 |
| Ethereum addresses listed | 51 (51 unique) |

Status: **verified**. Raw HTML fetched; addresses extracted by regex, count is exact (51, not "about 51").
The page describes them as addresses "holding or have held assets from the theft".

```
0x51E9d833Ecae4E8D9D8Be17300AEE6D3398C135D
0x96244D83DC15d36847C35209bBDc5bdDE9bEc3D8
0x83c7678492D623fb98834F0fbcb2E7b7f5Af8950
0x83Ef5E80faD88288F770152875Ab0bb16641a09E
0xAF620E6d32B1c67f3396EF5d2F7d7642Dc2e6CE9
0x3A21F4E6Bbe527D347ca7c157F4233c935779847
0xfa3FcCCB897079fD83bfBA690E7D47Eb402d6c49
0xFc926659Dd8808f6e3e0a8d61B20B871F3Fa6465
0xb172F7e99452446f18FF49A71bfEeCf0873003b4
0x6d46bd3AfF100f23C194e5312f93507978a6DC91
0xf0a16603289eAF35F64077Ba3681af41194a1c09
0x23Db729908137cb60852f2936D2b5c6De0e1c887
0x40e98FeEEbaD7Ddb0F0534Ccaa617427eA10187e
0x140c9Ab92347734641b1A7c124ffDeE58c20C3E3
0x684d4b58Dc32af786BF6D572A792fF7A883428B9
0xBC3e5e8C10897a81b63933348f53f2e052F89a7E
0x5Af75eAB6BEC227657fA3E749a8BFd55f02e4b1D
0xBCA02B395747D62626a65016F2e64A20bd254A39
0x4C198B3B5F3a4b1Aa706daC73D826c2B795ccd67
0xCd7eC020121Ead6f99855cbB972dF502dB5bC63a
0xbdE2Cc5375fa9E0383309A2cA31213f2D6cabcbd
0xD3C611AeD139107DEC2294032da3913BC26507fb
0xB72334cB9D0b614D30C4c60e2bd12fF5Ed03c305
0x8c7235e1A6EeF91b980D0FcA083347FBb7EE1806
0x1bb0970508316DC735329752a4581E0a4bAbc6B4
0x1eB27f136BFe7947f80d6ceE3Cf0bfDf92b45e57
0xCd1a4A457cA8b0931c3BF81Df3CFa227ADBdb6E9
0x09278b36863bE4cCd3d0c22d643E8062D7a11377
0x660BfcEa3A5FAF823e8f8bF57dd558db034dea1d
0xE9bc552fdFa54b30296d95F147e3e0280FF7f7e6
0x30a822CDD2782D2B2A12a08526452e885978FA1D
0xB4a862A81aBB2f952FcA4C6f5510962e18c7f1A2
0x0e8C1E2881F35Ef20343264862A242FB749d6b35
0x9271EDdda0F0f2bB7b1A0c712bdF8dbD0A38d1Ab
0xe69753Ddfbedbd249E703EB374452E78dae1ae49
0x2290937A4498C96eFfb87b8371a33D108F8D433f
0x959c4CA19c4532C97A657D82d97acCBAb70e6fb4
0x52207Ec7B1b43AA5DB116931a904371ae2C1619e
0x9eF42873Ae015AA3da0c4354AeF94a18D2B3407b
0x1542368a03ad1f03d96D51B414f4738961Cf4443
0x21032176B43d9f7E9410fB37290a78f4fEd6044C
0xA4B2Fd68593B6F34E51cB9eDB66E71c1B4Ab449e
0x55CCa2f5eB07907696afe4b9Db5102bcE5feB734
0xA5A023E052243b7cce34Cbd4ba20180e8Dea6Ad6
0xdD90071D52F20e85c89802e5Dc1eC0A7B6475f92
0x1512fcb09463A61862B73ec09B9b354aF1790268
0xF302572594a68aA8F951faE64ED3aE7DA41c72Be
0x723a7084028421994d4a7829108D63aB44658315
0xf03AfB1c6A11A7E370920ad42e6eE735dBedF0b1
0xEB0bAA3A556586192590CAD296b1e48dF62a8549
0xD5b58Cf7813c1eDC412367b97876bD400ea5c489
```

## 2. Bybit hack (2025-02-21)

| Field | Value | Source |
| --- | --- | --- |
| Malicious Safe tx | `0x46deef0f52e3a983b67abf4714448a41dd7ffd6d32d32da69d62081c68ad7882` | Etherscan, RPC |
| Block | 21895238 (timestamp 2025-02-21 14:13:35 UTC) | RPC |
| Tx sender | `0x0fa09c3a328792253f8dee7116848723b72a6d2e` (Etherscan: "ByBit Exploiter") | RPC, Etherscan |
| Bybit Safe (cold wallet) | `0x1Db92e2EeBC8E0c075a02BeA49a2935BcD2dFCF4` (Etherscan: "Bybit: Cold Wallet 1") | RPC, Etherscan |
| execTransaction `to` | `0x96221423681a6d52e184d440a8efcebb105c7242` | decoded calldata |
| execTransaction `operation` | 1 (delegatecall) | decoded calldata |
| Inner data | `transfer(0xbdd077f651ebe7f7b3ce16fe5f2b025be2969516, 0)`, run as delegatecall, writes slot 0 (masterCopy) | decoded calldata, Verichains |
| Malicious implementation | `0xbdd077f651ebe7f7b3ce16fe5f2b025be2969516` (Etherscan: "Bybit Exploiter 55") | Verichains, Sygnia, Etherscan |
| Main receiving address | `0x47666Fab8bd0Ac7003bce3f5C3585383F09486E2` (Etherscan: "Bybit Exploiter 1") | Verichains, Etherscan |
| Receipt status | 1 (success) | RPC |
| Stolen (Verichains) | ETH 401,347; mETH 8,000; stETH 90,375; cmETH 15,000 | Verichains |

Seed addresses, Verichains list "Hacker's initial addresses" (in FBI list? marked):

```
0xdd90071d52f20e85c89802e5dc1ec0a7b6475f92  in FBI list
0x0fa09c3a328792253f8dee7116848723b72a6d2e  not in FBI list (tx sender)
0xe8b36709dd86893bf7bb78a7f9746b826f0e8c84  not in FBI list
0x47666Fab8bd0Ac7003bce3f5C3585383F09486E2  not in FBI list (main receiver)
0xa4b2fd68593b6f34e51cb9edb66e71c1b4ab449e  in FBI list
0x1542368a03ad1f03d96D51B414f4738961Cf4443  in FBI list
0x36ed3c0213565530c35115d93a80f9c04d94e4cb  not in FBI list
```

Sources:
- https://etherscan.io/tx/0x46deef0f52e3a983b67abf4714448a41dd7ffd6d32d32da69d62081c68ad7882
- https://etherscan.io/address/0x47666fab8bd0ac7003bce3f5c3585383f09486e2
- Verichains, "Bybit Incident Investigation Preliminary Report" v1.0, 2025-02-24 (linked by Bybit CEO at https://x.com/benbybit/status/1894768736084885929; copy read at https://coinacademy.fr/wp-content/uploads/2025/02/Bybit-Incident-Investigation-Report.pdf)
- Sygnia, 2025-03-16: https://www.sygnia.co/blog/sygnia-investigation-bybit-hack/
- `eth_getTransactionByHash` / `eth_getTransactionReceipt` via https://ethereum-rpc.publicnode.com

Status: **verified**. Tx hash, block, sender, Safe and operation=1 checked on-chain; roles match Verichains and Etherscan labels.
Note: the Verichains PDF misspells the Safe address once (`0x1Db92e2EbE8E...`); use the on-chain value above.
Note: the FBI list is a laundering-stage list. Using it as ground truth means the main receiver and tx sender are not in it.

## 3. Bitget hack, BlockSec analysis

| Field | Value |
| --- | --- |
| Article | "Bitget's $387M Hack: Laundering Path, Freezes and Attribution" |
| URL | https://blocksec.com/blog/bitget-hack-laundering-fund-tracing |
| Published | 2026-09-30 (Phalcon Compliance, MetaSleuth) |
| Incident date | 2026-09-24 |
| Loss | about $387.5M (first reported about $351.6M) |
| Method (per Bitget) | forged withdrawal commands written into the wallet system; keys not stolen |
| Bitget wallet addresses | **none listed** in the BlockSec article |
| Attacker addresses (truncated only) | `0xe07b...7d57`, `0x9acc...b046`, `0xec13...691f` (Ethereum) |

Timeline (UTC, from BlockSec):

| Time | Event |
| --- | --- |
| 18:31 | Test transfers: 0.84 ETH from Ethereum hot wallet, 93 TRX from TRON hot wallet; below risk threshold, no alert |
| 18:58 | Large outflows begin |
| 19:05 | Reconciliation detects discrepancy; user withdrawals blocked; forged commands keep going |
| 21:23 | Last transfer; 26 successful outflows |
| 21:30 | CEO posts publicly |
| 21:44 | Signing machines and wallet withdrawal services shut down |

The "$228M in 18 minutes" figure is **not in the BlockSec article**. It comes from Bitcoin.com News (2026-09-25), attributed to an Arkham post:
"$228M left Bitget in 18 minutes, from 18:58 to 19:16 UTC."
URL: https://news.bitcoin.com/featured/bitget-hackers-drain-228m-in-18-minutes-arkham-tracks-7-chains/

Other source with a (truncated) Bitget hot wallet: Scorechain, 2026-09-25, https://www.scorechain.com/blog/bitget-hack-traced-across-eight-blockchains (hot wallet `0xffa8...cd54`, main attacker receiver `0x770b...63ee`). Full addresses not verified.

Status: **partially verified**. Date, timeline and totals verified in BlockSec; no full Bitget wallet address in any source opened; 228M figure is Arkham, not BlockSec.

## 4. Chainlink ETH/USD price feeds

| Chain | Proxy | Decimals | Heartbeat | Deviation |
| --- | --- | --- | --- | --- |
| Base Sepolia | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1` | 8 | 1200 s | 0.15% |
| Ethereum Sepolia (backup) | `0x694AA1769357215DE4FAC081bf1f309aDC325306` | 8 | 3600 s | 1% |

Sources:
- https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia-base-1.json (data behind https://docs.chain.link/data-feeds/price-feeds/addresses)
- https://reference-data-directory.vercel.app/feeds-ethereum-testnet-sepolia.json
- On-chain: `decimals()` = 8 and `description()` = "ETH / USD" on both proxies; `latestRoundData()` returned recent rounds (RPC https://sepolia.base.org, https://ethereum-sepolia-rpc.publicnode.com)

Status: **verified**. Directory values and on-chain reads agree.
Note: Ethereum Sepolia also lists a second ETH/USD feed (`eth-usd-nops`, proxy `0xD9d6f482B88C43B256fD481826890dffC8544B13`); use the standard one above.

## 5. CRE forwarders

| Chain | Chain name | KeystoneForwarder (deployed) | MockKeystoneForwarder (simulation) |
| --- | --- | --- | --- |
| Base Sepolia | `ethereum-testnet-sepolia-base-1` | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0x82300bd7c3958625581cc2f77bc6464dcecdf3e5` |
| Ethereum Sepolia | `ethereum-testnet-sepolia` | `0xF8344CFd5c43616a4366C34E3EEE75af79a74482` | `0x15fC6ae953E024d975e77382eEeC56A9101f9F88` |

Source: https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts.md
Both Base Sepolia addresses have contract code (`eth_getCode` on https://sepolia.base.org).

Status: **verified**. Matches docs/31_phase1.md exactly.

## 6. Exchange wallet labels (Ethereum mainnet)

| Exchange | Address | Etherscan name tag |
| --- | --- | --- |
| Binance | `0x28C6c06298d514Db089934071355E5743bf21d60` | Binance 14 |
| Binance | `0x21a31Ee1afC51d94C2eFcCAa2092aD1028285549` | Binance 15 |
| Binance | `0xDFd5293D8e347dFe59E90eFd55b2956a1343963d` | Binance 16 |
| Coinbase | `0x71660c4005BA85c37ccec55d0C4493E66Fe775d3` | Coinbase 1 |
| Coinbase | `0x503828976D22510aad0201ac7EC88293211D23Da` | Coinbase 12 |
| OKX | `0x6cC5F688a315f3dC28A7781717a9A798a59fDA7b` | OKX |
| OKX | `0x98ec059Dc3aDFBdd63429454aEB0c990FBA4A128` | OKX 6 |
| Kraken | `0x2910543Af39abA0Cd09dBb2D50200b3E800A63D2` | Kraken 1 |
| Kraken | `0xDA9dfA130Df4dE4673b89022EE50ff26f6EA73Cf` | Kraken 13 |

Source: `https://etherscan.io/address/<address>` (page title read for each).

Status: **partially verified**. Exchange ownership tag verified; Etherscan tags do not say hot vs cold, so "hot wallet" is not verified.

## 7. Label and scam datasets

| Name | URL | Format | License | Last push |
| --- | --- | --- | --- | --- |
| Forta labelled-datasets | https://github.com/forta-network/labelled-datasets | CSV: `labels/1/malicious_smart_contracts.csv`, `labels/1/phishing_scams.csv`, `labels/1/etherscan_malicious_labels.csv`, `labels/10/malicious_smart_contracts.csv` | MIT | 2023-01-26 |
| EtherScamDB | https://github.com/MrLuit/EtherScamDB | YAML/JSON: `_data/scams.yaml`, `_data/legit_urls.yaml`, `_data/metamaskImports.json`, `_data/twitter.json` | MIT | 2022-12-07 |
| CryptoScamDB blacklist (successor) | https://github.com/CryptoScamDB/blacklist | YAML/JSON: `data/urls.yaml`, `data/uris.yaml`, `data/twitter.json` (URLs, not addresses) | none declared | 2023-04-29 |

Source: GitHub API repo metadata and README. Forta labels are derived from Etherscan tags (`exploit`, `heist`, `phish-hack`).
Status: **verified**. Note that all three are stale (no pushes since 2022 to 2023) and malicious-only; none provides benign labels.
