# Decisions & assumptions to confirm

Everything marked configurable is a key in `PlatformConfig` (Admin → Config) or a master table, unless noted.
Orders snapshot commercial terms when created, so changing a value only affects new orders.

## A. PRD gaps, defaulted as the master prompt instructed

| # | Topic | Default | Where to change |
|---|---|---|---|
| A1 | Inspection fee, 2–3 t gap | ≤2 t ₹800; >2 t and ≤7 t ₹1,500; >7 t ₹3,000 | Admin → Inspection tiers |
| A2 | Who pays the inspection fee | Farmer, deducted at settlement | `inspectionFeePayer` |
| A3 | Partial fills | One bid fills one RFQ, whole volume. The schema keeps bids separate so multi-farmer fills can be added. | Code |
| A4 | Bid price rule | Bid ≤ target | `bidPriceRule` (`LTE_TARGET` / `EQ_TARGET`) |
| A5 | Buyer misses 70% by deadline | `BUYER_DEFAULTED`, admin review; advance forfeiture off | `advanceForfeitureOnBuyerDefault` |
| A6 | Dispute window | 24 h after PoD, then auto-settle | `disputeWindowHours` |
| A7 | SLA deadline | End of day T0 + SLA days, IST | `slaEndOfDay`, `rfqSlaDays`, `catalogSlaDays` |
| A8 | Self-cert trigger | Unassigned at T−24 h before inspection day, or inspector cancels with nobody to replace them | `selfCertFallbackHours` |
| A9 | Inspector pay | Paid from the inspection fee | `inspectorShareBps` (see B1) |
| A10 | Languages | English, Hindi, Assamese, Bengali | Add a JSON file (`apps/pwa-farmer/messages`) and a template key (`notifications/templates.ts`) |
| A11 | Check-in radius | 500 m | `checkInRadiusMetres`, `selfCertRadiusMetres` |

## B. Decisions I made where the PRD is silent: please confirm

| # | Topic | What it does now | Why, and what to check |
|---|---|---|---|
| B1 | **Inspector share** | 70% of the fee to the inspector, 30% kept by the platform | The prompt says both "platform keeps inspection fee" and "inspector paid from it". On the ₹3,000 tier: inspector ₹2,100. **The 70% is my guess.** |
| B2 | **When inspectors get paid** | Accrued on Mark as Inspected, paid at settlement (or at refund) | Escrow can't lawfully fund a fee before release, so cash moves at settlement, not at the moment of inspection. |
| B3 | **Self-certified orders** | Inspection fee waived (farmer gets ₹4,85,000 on the worked example) | No inspection took place. `waiveInspectionFeeOnSelfCert`. |
| B4 | **Out-of-spec inspection** | Order does not pass. Inspection goes to `FAILED_GRADE`, ops is alerted, the buyer may accept the deviation or an admin may declare a farmer default | PRD doesn't say. No price renegotiation flow in v1. |
| B5 | **Inspector paid after a farmer default** | Yes, funded by the platform | They did the work. The cost is not added to the farmer's negative balance; only the gateway fee is, as the PRD specifies. |
| B6 | **Who absorbs gateway fees normally** | The platform, out of commission | PRD only assigns them to the farmer on default. At a 1.5% fee, gateway costs on GMV are half of a 3% commission. **This is a big margin question.** |
| B7 | **Gateway fee on buyer default** | Platform absorbs it; nothing posted to the farmer | Consider charging the buyer. |
| B8 | **Commission on disputed orders** | 3% of GMV net of the partial refund | Alternative is 3% of original GMV. |
| B9 | **Full refund after delivery** | Refunds GMV, not freight: the freight was already released on PoD and the trip happened | The 100% rule is applied to failure to deliver, where freight is still in escrow and is refunded. |
| B10 | **Forfeiture destination** | If the flag is turned on, the forfeited advance goes to the farmer in full | Needs legal review before enabling. |
| B11 | **Spot-test timing** | Requesting a test extends the window by 72 h and holds settlement until a result is entered; an overdue result raises an ops alert rather than auto-settling | `spotTestExtensionHours`. Results are uploaded by the buyer or admin. |
| B12 | **Received weight** | Recorded once, from PoD (driver) or the buyer's delivery confirmation (external transport). The dispute request cannot supply it | Stops a buyer entering a lower weight to get past the 2.5% guard. A driver/buyer collusion risk remains; evidence and admin review cover it. |
| B13 | **Farmers under manual KYC review** | May trade, but payouts stay blocked until an admin clears the name mismatch | Stricter alternative: block trading too. |
| B14 | **Admin override of name mismatch** | Allowed, audited, and requires a validated bank account | The PRD's "manual admin review" implies this. Confirm your KYC policy permits it. |
| B15 | **Mid-tier vehicle gaps** | A load between bands (e.g. 2.5 t) gets the smallest tier that fits | Seed tiers were written as ≤2 t, 3–7 t, 8–16 t, 17–25 t. |
| B16 | **Loads above 25 t** | No platform quote; buyer must split or declare external transport | |
| B17 | **External transport PoD** | The buyer's delivery confirmation with received weight is the PoD | No driver app is involved. |
| B18 | **Credits on dead orders / overpayments** | Never applied to a tranche; held in escrow, ops alerted, refunded from the console | |
| B20 | **Unpaid matches** | An order with no advance after 48 h is cancelled and its listing or RFQ (with its bids) goes back on the market. A buyer can cancel before paying. Phones re-mask. Part-paid orders are never auto-cancelled; ops is alerted. | `advanceExpiryHours`. PRD is silent, but without this a non-paying buyer locks up a farmer's produce indefinitely. |
| B19 | **E-Way bill** | Mandatory before pickup on every platform trip | The legal threshold is ₹50,000 of goods and varies for some agricultural produce. Check with your CA whether to relax it. |

## C. Legal, tax and compliance: needs a professional, not me

- **Contract terms** (`apps/api/prisma/masters.ts`) are drafted from the PRD, marked as needing legal review, and are not legal advice. That includes whether crediting an advance "legally binds" the contract.
- **GST**: commission GST (18%) is shown as informational, goods GST is 0%, and invoices say so. **`needs CA review`**, including whether the platform is an e-commerce operator with TCS obligations under GST.
- **RBI / escrow**: this design assumes Razorpay Route's on-hold transfers fit your PA arrangement. **Confirm with Razorpay** that Smart Collect into Route split settlement is available for this flow. They may require a marketplace agreement, linked-account onboarding and KYC of each farmer.
- **DPDP Act**: consent notices and data-retention rules are not implemented.
- **DLT**: real Indian SMS needs registered sender IDs and templates. The templates in code must be registered, and the SMS bodies may need to change to match.

## D. Domain data: `needs_domain_review`

- **Grade specs** (moisture, size, foreign matter, etc.) for all 9 commodities are plausible placeholders, not AGMARK or FSSAI standards.
- **Vehicle rates** (₹28, ₹38, ₹55, ₹70 per km) and the **₹1,000 loading fee** are placeholders.
- **Mock market prices** are synthetic. They must never be presented as real.
- **Sample history**: `pnpm db:demo-history` creates fabricated demo orders. Dashboards built on it show sample figures, so never run it on a database with real users.
- **Assamese and Bengali translations** are machine-drafted and need native review, especially for a rural audience. Hindi should be checked too.

## E. Integrations: what is and isn't proven

Mock adapters are exercised by the full test suite. **Real adapters compile and follow public docs, but have never been called against a live account:**

| Adapter | Before going live, verify |
|---|---|
| Razorpay | Idempotency header name (`X-Razorpay-Idempotency` is an assumption); Route linked-account flow; `on_hold` transfers; refund fee behaviour; the reconciliation endpoint |
| Cashfree KYC | Paths and field names; substituting another vendor only touches this adapter |
| Agmarknet | Resource ID and whether `arrival_date` filtering works. **History**: this dataset is current-day, so 6-month charts fill up from the go-live date unless you backfill |
| Supabase Storage | Signed browser uploads and multipart ETags. Supabase documents signed S3 URLs but S3 CORS settings are not available, so check a real browser upload, self-certification video included, and the project upload size limit |
| Google Maps, Twilio, MSG91, SNS | Credentials and formats. SNS also needs `@aws-sdk/client-sns` added |

## F. Security limits worth knowing

- **Self-cert "in-app only" is strong but not absolute.** The API refuses any video without a single-use, server-issued capture token, and checks hash, GPS radius and timestamps. A determined attacker with a modified client can still feed a fake camera stream and spoof GPS, particularly in a PWA. Real attestation needs a native app with Play Integrity. The buyer always sees the self-certified badge and videos.
- **Provider calls run inside DB transactions**, so that money and state move together. If a transaction rolls back after a gateway call, a retry reuses the same idempotency key, which relies on the provider honouring it.
- `/metrics` needs a bearer token and `/docs` is off in production. The API sends Helmet's headers. The portals send framing, sniffing, referrer and permissions headers but **no Content-Security-Policy**, because Next.js needs a per-request nonce for one. Add it before handling real money if your review requires it.
- GPS and check-in positions are device-reported and can be spoofed on a rooted phone.
- Production boot refuses missing `JWT_SECRET`, `PII_ENCRYPTION_KEY` or `PII_HASH_KEY`. Mock bank and OTP echo are disabled in production.
- `PII_ENCRYPTION_KEY` can be rotated (see the README). `PII_HASH_KEY` has no rotation path.

## G. Engineering choices

- **Nested git repo**: `E:/Code` is one large unrelated repo, so Agrimate has its own at `E:/Code/Files/Agrimate`. The parent sees it as an untracked folder.
- **Pinned majors**: newer majors exist for Nest (12), Prisma (8 RC) and Next (16). I pinned Nest 11, Prisma 6, as the versions I can vouch for, and Next 15 as specified.
- **No Docker or Redis**: the only hosted dependency is Supabase. Jobs run in-process from Postgres (`JobClaim` guarantees one daily run). API tests start a temporary Postgres through `embedded-postgres`.
- **Dashboards**: built on plain SVG and `d3-force`. The farmer app gets dials and a journey view only, with no network map, to stay light on rural connections. Buyers and farmers see names of their own counterparties only, never inspectors or transporters.
- **Generated client**: request paths and bodies are generated from OpenAPI; response types are hand-written in `packages/api-client/src/views.ts`, because responses are role-scoped views. Those could drift from the API and aren't compiler-checked against it.
- **`@scarf/scarf`** install telemetry (via swagger-ui) is blocked in `pnpm-workspace.yaml`.
