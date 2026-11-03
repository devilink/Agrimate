# Agrimate

B2B agri-trade platform for India: bulk Buyers ↔ Farmers/FPOs, quality verified by Agri-Inspectors, produce moved by Logistics partners, money held in RBI-compliant escrow (Razorpay Smart Collect + Route).

The full system runs locally with **zero API keys**. Every third-party integration sits behind an adapter with a working mock.

- [PLAN.md](./PLAN.md): architecture, data model, state machines, API surface
- [DECISIONS.md](./DECISIONS.md): assumptions to confirm, compliance gaps, what isn't proven

## Run it

### Everything in Docker

```bash
docker compose up --build
```

Migrates and seeds on first start. First build takes several minutes.

| Service | URL |
|---|---|
| Buyer portal | http://localhost:3000 |
| Admin / ops console | http://localhost:3001 |
| Farmer PWA | http://localhost:3002 |
| API + Swagger | http://localhost:4000/docs |
| MinIO console | http://localhost:9001 (`agrimate` / `agrimate-secret`) |

### Local development

Requires Node 22+, pnpm 11, Docker.

```bash
pnpm install
pnpm infra:up                     # Postgres, Redis, MinIO
cp .env.example apps/api/.env
pnpm --filter @agrimate/shared build && pnpm --filter @agrimate/api-client build
pnpm db:migrate && pnpm db:seed
pnpm dev                          # API + the three web portals
```

### Mobile apps (Expo)

The API must be running. A phone or emulator can't reach `localhost`, so point the app at your machine: `10.0.2.2` on the Android emulator, your LAN IP on a physical phone. Do the same for `S3_PUBLIC_ENDPOINT` on the API, or photo uploads will fail.

```bash
cd apps/app-inspector    # or apps/app-logistics
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 pnpm exec expo start
```

## Seed logins

While SMS is mocked, the OTP is returned by the API as `devOtp`, and the login screens show it.

| Role | Login | Notes |
|---|---|---|
| Admin | `admin@agrimate.local` / `Admin@12345` | |
| Buyer | `buyer@agrimate.local` / `Buyer@12345`, or OTP on `+919000000101` | Brahmaputra Foods, Guwahati |
| Buyer | `buyer2@agrimate.local` / `Buyer@12345`, or OTP on `+919000000102` | Deccan Agro, Pune |
| Farmer | OTP on `+919000000201` | Hemanta Bora, Nagaon, Assam (Assamese; holds an organic cert) |
| Farmer / FPO | OTP on `+919000000202` | Subhas Mondal, Bardhaman, West Bengal (Bengali) |
| Farmer | OTP on `+919000000203` | Sanjay Pawar, Nashik, Maharashtra (Hindi) |
| Farmer | OTP on `+919000000204` | Gurpreet Singh, Ludhiana, Punjab (Hindi) |
| Farmer | OTP on `+919000000205` | Rina Kalita: **bank-name mismatch, payouts blocked**, waiting in the admin queue |
| Inspector | OTP on `+919000000301` to `0304` | One each in Nagaon, Nashik, Bardhaman, Ludhiana |
| Inspector | OTP on `+919000000305` | Pending approval |
| Logistics | OTP on `+919000000401` | Kamrup Roadways, verified, with 3 vehicles |
| Logistics | OTP on `+919000000402` | Owner-driver, pending approval |

OTP requests are limited to 5 per hour per phone.

## Try a full order

1. Buyer portal: open **Catalog** and accept a listing (or post an RFQ and bid on it from the farmer PWA).
2. On the order page, the **Simulate NEFT** button stands in for a bank transfer into the order's virtual account. It sends a signed webhook through the real handler.
3. Book platform logistics or declare external transport, then simulate the freight and 70% credits.
4. Complete the inspection in the inspector app, or through the API as `scripts/smoke-live.mjs` does.
5. Depart, record delivery, and wait out the 24 h dispute window, or fast-forward it as an admin: `POST /api/v1/dev/time/advance?hours=25`.

## Tests

```bash
pnpm infra:up
docker exec agrimate-postgres-1 psql -U agrimate -c "CREATE DATABASE agrimate_test"   # first time only

pnpm --filter @agrimate/shared test   # pure money, pricing, state-machine and rule tests
pnpm --filter @agrimate/api test      # Section 10 acceptance and domain suites, against real Postgres
pnpm smoke                            # against a RUNNING stack: real MinIO uploads, BullMQ workers
```

The API suite boots the real Nest app against real Postgres. Only the provider adapters are mocked, and time is driven through an injectable `Clock`. `pnpm smoke` covers what that suite mocks, and it's what caught a real bug in file permissions.

## Mock vs real

Each is one env var (see [.env.example](./.env.example)). An unknown value fails at boot rather than silently falling back to a mock.

| Integration | Env var | Mock behaviour | Real adapter |
|---|---|---|---|
| Escrow & splits | `PAYMENT_PROVIDER=razorpay` | Signed webhooks, 1.5% fee, persisted transactions | Razorpay Smart Collect + Route |
| Distance | `MAPS_PROVIDER=google` | Straight line × 1.3 between seeded PINs | Distance Matrix |
| SMS / OTP | `SMS_PROVIDER=twilio\|sns\|msg91` | Logged; OTP returned to the client | As named |
| KYC / KYB | `KYC_PROVIDER=cashfree` | PAN starting `ZZZZZ` fails; bank account ending `0000` gives a name mismatch | Cashfree Verification |
| Market data | `MARKET_DATA_PROVIDER=agmarknet` | Synthetic prices, not real | data.gov.in Agmarknet |
| Files | `STORAGE_PROVIDER=s3` | In-memory, tests only | Any S3 API (MinIO locally) |

**The real adapters have not been run against live accounts.** See DECISIONS.md section E for what to check first.

## Layout

```
apps/api            NestJS monolith: REST + OpenAPI, BullMQ workers in-process
apps/web-buyer      Next.js buyer portal
apps/web-admin      Next.js ops console
apps/pwa-farmer     Next.js PWA, vernacular (messages/*.json)
apps/app-inspector  Expo, camera + GPS
apps/app-logistics  Expo, low-bandwidth with a retry queue
packages/shared     Money, pricing, state machines, validators: pure and fully tested
packages/api-client Generated OpenAPI types + typed fetch client
packages/ui         Shared components
infra/              Compose services and Dockerfiles
scripts/            Live smoke test
```

After changing an API route or DTO, run `pnpm gen:client`.

## Core rules, and where they live

| Rule | Location |
|---|---|
| All order state changes, guards, 409s | `packages/shared/src/state-machine.ts` (table), `apps/api/src/engine/engine.ts` (engine) |
| Freight, settlement, fee tiers, 2.5% shrinkage | `packages/shared/src/pricing.ts` |
| Double-entry ledger | `apps/api/src/engine/engine.ts`; database triggers enforce balance and append-only |
| Webhook idempotency, over/under-payment | `apps/api/src/payments/payments.service.ts` |
| Settlement, refunds, negative balance, reconciliation | `apps/api/src/payments/settlement.service.ts` |
| SLA timers, inspector ladder, self-certification | `apps/api/src/inspection/inspection.service.ts` |
| Bank-holder ↔ PAN name match | `packages/shared/src/name-match.ts`, `apps/api/src/onboarding/onboarding.ts` |

## Deployment notes

- `NODE_ENV=production` requires `JWT_SECRET`, `PII_ENCRYPTION_KEY` and `PII_HASH_KEY` (the API won't boot without them), turns on JSON logs, and disables the mock bank, time travel and OTP echo.
- Run one API instance to start with. BullMQ workers run in-process and are safe to scale, since jobs are idempotent and timers claim atomically. `sla-sweep` recovers any timers lost in a Redis outage.
- Behind a load balancer: set Express `trust proxy` so that per-IP rate limits see real client addresses. Add security headers and restrict `/metrics` and `/docs` at the edge.
- Point Razorpay webhooks at `POST /api/v1/webhooks/razorpay`.
- Back up Postgres. The ledger and event log are append-only and are your financial record.
- The farmer PWA's camera and crypto APIs need HTTPS outside `localhost`.
