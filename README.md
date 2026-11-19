# Agrimate

B2B agri-trade platform for India: bulk Buyers ↔ Farmers/FPOs, quality verified by Agri-Inspectors, produce moved by Logistics partners, money held in RBI-compliant escrow (Razorpay Smart Collect + Route).

Everything it stores lives on Supabase: Postgres for data and background jobs, Storage for files. No Docker, Redis or other service is needed. Payments, SMS, KYC, maps and market data each sit behind an adapter with a working mock, so the only keys you need to start are Supabase's.

- [PLAN.md](./PLAN.md): architecture, data model, state machines, API surface
- [DECISIONS.md](./DECISIONS.md): assumptions to confirm, compliance gaps, what isn't proven

## Run it

Requires Node 22+, pnpm 11 and a Supabase project, in Mumbai (`ap-south-1`) if your users are in India.

1. Copy the template: `cp .env.example apps/api/.env`
2. From Dashboard > Connect > ORMs > Prisma, copy the two connection strings into `DATABASE_URL` and `DIRECT_URL`.
3. In Storage > S3, turn on the S3 connection, create an access key, and fill in `S3_ENDPOINT` and `S3_PUBLIC_ENDPOINT` (the same URL), `S3_REGION`, `S3_ACCESS_KEY` and `S3_SECRET_KEY`. The API creates its private `agrimate` bucket on first start.

```bash
pnpm install
pnpm --filter @agrimate/shared build && pnpm --filter @agrimate/api-client build
pnpm db:migrate && pnpm db:seed
pnpm db:demo-history              # optional: about three months of sample orders for the dashboards
pnpm dev                          # API + the three web portals
```

In development the seed adds the demo logins below, which have published passwords, so use a project with no real users. `db:demo-history` runs real orders through the mock bank and refuses to run in production or against a real payment provider.

Supabase's Data API is not used. The migrations deny it access to every table, and you can also switch it off in the project's API settings.

| Service | URL |
|---|---|
| Landing page, buyer / farmer / transport sign-in, buyer portal | http://localhost:3000 |
| Console sign-in (admin, quality verifier) | http://localhost:3000/adminagri (unlisted; redirects to :3001/adminagri) |
| Admin / ops console, with the live dashboard | http://localhost:3001 |
| Trade network map | http://localhost:3001/network |
| Farmer PWA | http://localhost:3002 |
| API + Swagger | http://localhost:4000/docs |

### Mobile apps (Expo)

The API must be running. A phone or emulator can't reach `localhost`, so point the app at your machine: `10.0.2.2` on the Android emulator, your LAN IP on a physical phone.

```bash
cd apps/app-inspector    # or apps/app-logistics
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000 pnpm exec expo start
```

## Seed logins

While SMS is mocked, the OTP is returned by the API as `devOtp`, and the login screens show it.

| Role | Login | Notes |
|---|---|---|
| Admin | `admin@agrimate.local` / `Admin@12345` at `/adminagri`, Admin tab | |
| Buyer | `buyer@agrimate.local` / `Buyer@12345`, or OTP on `+919000000101` | Brahmaputra Foods, Guwahati |
| Buyer | `buyer2@agrimate.local` / `Buyer@12345`, or OTP on `+919000000102` | Deccan Agro, Pune |
| Farmer | OTP on `+919000000201` | Hemanta Bora, Nagaon, Assam (Assamese; holds an organic cert) |
| Farmer / FPO | OTP on `+919000000202` | Subhas Mondal, Bardhaman, West Bengal (Bengali) |
| Farmer | OTP on `+919000000203` | Sanjay Pawar, Nashik, Maharashtra (Hindi) |
| Farmer | OTP on `+919000000204` | Gurpreet Singh, Ludhiana, Punjab (Hindi) |
| Farmer | OTP on `+919000000205` | Rina Kalita: **bank-name mismatch, payouts blocked**, waiting in the admin queue |
| Inspector | OTP on `+919000000301` to `0304` | One each in Nagaon, Nashik, Bardhaman, Ludhiana. Web: `/adminagri`, "Quality verifier" tab, opens the quality check desk |
| Inspector | OTP on `+919000000305` | Pending approval |
| Logistics | OTP on `+919000000401` | Kamrup Roadways, verified, with 3 vehicles. Web: main `/login`, "Transport" option, opens the transport desk on :3001 |
| Logistics | OTP on `+919000000402` | Owner-driver, pending approval |

OTP requests are limited to 5 per hour per phone.

## Try a full order

1. Buyer portal: open **Catalog** and accept a listing (or post an RFQ and bid on it from the farmer PWA).
2. On the order page, the **Simulate NEFT** button stands in for a bank transfer into the order's virtual account. It sends a signed webhook through the real handler.
3. Book platform logistics or declare external transport, then simulate the freight and 70% credits.
4. Complete the inspection in the inspector app, or through the API as `scripts/smoke-live.mjs` does.
5. Depart, record delivery, and wait out the 24 h dispute window, or fast-forward it as an admin: `POST /api/v1/dev/time/advance?hours=25`.

## Tests

The API suite **wipes every table in the database it connects to**. By default it starts its own temporary Postgres for the run and throws it away afterwards, so it needs no setup and can't touch your Supabase data. To test against a throwaway Supabase project instead, set `TEST_DATABASE_URL` and `TEST_DIRECT_URL`, and never point them at the app's own project.

```bash
pnpm --filter @agrimate/shared test   # pure money, pricing, state-machine and rule tests
pnpm --filter @agrimate/api test      # acceptance, domain and analytics suites, against real Postgres
pnpm smoke                            # against a RUNNING stack: real uploads to Supabase Storage, background jobs
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
| Files | `STORAGE_PROVIDER=s3` | In-memory, tests only | Supabase Storage through its S3 connection |

**The real adapters have not been run against live accounts.** See DECISIONS.md section E for what to check first.

## Layout

```
apps/api            NestJS monolith: REST + OpenAPI, Postgres-driven jobs in-process
apps/web-buyer      Next.js buyer portal
apps/web-admin      Next.js ops console
apps/pwa-farmer     Next.js PWA, vernacular (messages/*.json)
apps/app-inspector  Expo, camera + GPS
apps/app-logistics  Expo, low-bandwidth with a retry queue
packages/shared     Money, pricing, state machines, validators: pure and fully tested
packages/api-client Generated OpenAPI types + typed fetch client
packages/ui         Shared components, dashboards (`/viz`) and the network map (`/graph`)
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

- `NODE_ENV=production` requires `JWT_SECRET`, `PII_ENCRYPTION_KEY` and `PII_HASH_KEY` (the API won't boot without them), turns on JSON logs, and disables the mock bank, time travel, OTP echo, demo seeding and `/docs` (`API_DOCS_ENABLED=true` turns it back on).
- First admin: set `ADMIN_PHONE`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` for the first start. The seed creates that account, and won't touch it again. Remove the three variables afterwards.
- Run one API instance to start with. Background jobs run in-process and are driven from Postgres. They are safe to scale: timers claim atomically and daily jobs claim one row per IST day, and a daily job missed during downtime runs when the API comes back.
- Behind a load balancer: set `TRUST_PROXY_HOPS` to the number of proxies, so that per-IP rate limits see real client addresses. Leave it at 0 with no proxy, or clients can fake their IP.
- `/metrics` needs `Authorization: Bearer <METRICS_TOKEN>`, and stays closed in production until that is set.
- Portal builds: build with `NEXT_PUBLIC_MOCK_TOOLS=false` (the default) and your real `NEXT_PUBLIC_*` URLs, which are fixed at build time.
- Point Razorpay webhooks at `POST /api/v1/webhooks/razorpay`.
- Back up Postgres. The ledger and event log are append-only and are your financial record. On Supabase, confirm that your plan's daily backups meet your retention needs, turn on point-in-time recovery for production, and test a restore into a separate project before launch.
- The farmer PWA's camera and crypto APIs need HTTPS outside `localhost`.

### Rotating the PII encryption key

1. Deploy with `PII_ENCRYPTION_KEY` set to the new key and `PII_ENCRYPTION_KEY_PREVIOUS` set to the old one. Both now read; new writes use the new key.
2. With the same variables set, preview with `pnpm --filter @agrimate/api pii:rotate`, then write with `pnpm --filter @agrimate/api pii:rotate --apply`. It can be re-run or interrupted safely.
3. Continue only if the report shows `unreadable` as 0. Then remove `PII_ENCRYPTION_KEY_PREVIOUS` and redeploy.

`PII_HASH_KEY` can't be rotated this way, since every phone lookup index would have to be recomputed. Treat it as permanent unless it leaks.
