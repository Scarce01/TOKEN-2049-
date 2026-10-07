# Where keys go

Nothing on this page is committed. Every `.env` file and the `secrets/` folder are in `.gitignore`.
Each `.env` has a `.env.example` next to it showing the format.

| Key | Private key goes in | Public address goes in |
| --- | --- | --- |
| Deployer (security lead; has no power after deploy) | `contracts/.env` `DEPLOYER_PRIVATE_KEY` | none |
| Officers x3 | each officer's own wallet (MetaMask) | `contracts/.env` `OFFICER_1..3` |
| Officer seal key x3 (decrypts sealedReason; not a wallet) | each officer's own machine `secrets/officer-seal.local` | `workflows/cosign/config.staging.json` `officerSealKeys` |
| CRE simulate key (SIM mode) | `workflows/.env` `CRE_ETH_PRIVATE_KEY` | `contracts/.env` `SIM_OPERATOR` |
| Exchange A submit key | `apps/exchange-api/.env` `SUBMITTER_PRIVATE_KEY` | `contracts/.env` `SUBMITTER_A` |
| Exchange B submit key (phase 4) | exchange-api .env for ORG=b | `contracts/.env` `SUBMITTER_B` |
| Exchange A collector (receives deposits) | not needed (receive only) | `contracts/.env` `COLLECTOR_A` |
| Red team keys | `services/redteam/.env` | none |
| Shared secret K (HMAC) | `secrets/quorum_k.local` and `workflows/.env` `QUORUM_K` | none |
| Supabase role passwords | each service's `.env` `DATABASE_URL` | none |
| Supabase service key | only the officer account script `.env` | none |
| Basescan API key | `contracts/.env` `BASESCAN_API_KEY` | none |

Fund with Base Sepolia ETH: the deployer, the CRE simulate key, both submit keys, the keeper key (services/keeper `KEEPER_PRIVATE_KEY`, gas only, no authority), and the red team keys.

Notifier (services/notifier, docs/47 3.5): `NOTIFY_WEBHOOK_URL` (team channel, optional) and `DATABASE_URL` for role `notifier_svc`, which can read only `quorum_index.notify_channels` (per-user delivery URLs). It reads the chain for everything else and never sees the decoy list.

## Console accounts (Supabase Auth)

Public sign-up is off (`supabase/config.toml` and the cloud dashboard). Accounts are added by whoever holds the
Supabase project: Authentication, Users, Add user (Create new user with Auto Confirm, or Invite). Passwords are at
least 12 characters with upper, lower and digits.

An account alone can log in but sees nothing: the Console server routes and RLS (`quorum_index.is_officer()`) require
`app_metadata.role = 'officer'`, which only the secret key can set. Officers can read traps, metrics and signatures and
submit signatures. A signature counts on chain only if it comes from a wallet in OfficerSet (`OFFICER_1..3` at deploy),
which is separate from the Supabase account.

Cloud settings to mirror by hand: Authentication, URL Configuration (Site URL `http://localhost:3001`, redirects
3001 and 3002); Sign In / Providers (new sign-ups off); Policies (password rules); Rate Limits (email needs custom SMTP).
