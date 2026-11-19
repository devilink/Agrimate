# Agrimate: Architecture & Feature Comparison

> **Comprehensive comparison between the Autonomous Monorepo (`apps/*`) and the Standalone Web App (`web/`).**  
> Use this document to understand the design differences, operational trade-offs, and feature sets of both implementations in this repository.

---

## 1. Executive Summary & Design Philosophies

Inside this repository, there are two distinct implementations of the Agrimate platform:

```
┌─────────────────────────────────────────────────────────────┐
│                 MONOREPO ARCHITECTURE                       │
│      "Autonomous Platform with Programmatic Guards"         │
│                                                             │
│   Web Buyer       Web Admin       PWA Farmer    Expo Apps   │
│   (Port 3000)     (Port 3001)     (Port 3002)   (Mobile)    │
│        │               │               │            │       │
│        └───────────────┼───────────────┴────────────┘       │
│                        ▼                                    │
│             NestJS Backend API (:4000)                      │
│     (State Engine + Double-Entry Ledger + Timers)           │
│                        │                                    │
│       ┌────────────────┼────────────────┐                   │
│       ▼                ▼                ▼                   │
│   PostgreSQL       Razorpay          Cashfree /             │
│   (Supabase)     (Smart Collect    Google Maps /            │
│                   + Route API)       Agmarknet              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                    WEB/ ARCHITECTURE                        │
│          "Human-in-the-Loop Operations Monolith"            │
│                                                             │
│           Single Next.js 15 Application (:3000)             │
│   (All 5 Roles in one portal, Server Actions, RLS)          │
│                        │                                    │
│       ┌────────────────┴────────────────┐                   │
│       ▼                                 ▼                   │
│   Supabase                          Razorpay                │
│   (Auth + DB + Storage)        (Standard Checkout)          │
└─────────────────────────────────────────────────────────────┘
```

### The Monorepo (`apps/api`, `apps/web-*`, `apps/app-*`)
* **Philosophy**: Zero-touch, fully automated enterprise exchange.
* **Target Environment**: A high-tech marketplace where software enforces every rule without human intervention: programmatic escrow accounts, automated SLA timers, hard state locks, automated KYC checks, and automated API payouts.
* **Operational Challenge**: Extremely rigid. In real-world Indian agriculture, deals are often negotiated offline, trucks face road delays, buyers make partial payments via RTGS, and automated software locks can stall trading.

### The Standalone Web App (`web/`)
* **Philosophy**: Practical, human-in-the-loop operations platform.
* **Target Environment**: Real-world agri-trade operations where human admins manage logistics, inspections, and dispute arbitration, while software handles marketplace listings, buyer payments (Razorpay Checkout), and timeline tracking.
* **Key Advantage**: Maximum flexibility with zero automated locks, allowing manual order entry for phone deals, offline payment recording, and manual bank/UPI payouts with UTR tracking. Requires only 6 environment variables.

---

## 2. Architecture & Infrastructure Comparison

| Metric / Layer | Monorepo (`apps/*` + `packages/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Code Structure** | Turborepo Monorepo (pnpm workspace) with 5 frontends, 1 NestJS backend, 3 shared packages | Single Next.js 15 Full-Stack Monolith (Server Actions + Route Handlers) |
| **Backend Framework** | NestJS (Node.js 22, TypeScript, modular monolith with 24 modules) | Next.js 15 App Router (`server-only` Server Actions) |
| **Database ORM** | Prisma 6 + Raw SQL Triggers for append-only logs | Supabase Client (`@supabase/ssr`, `@supabase/supabase-js`) + PostgreSQL Row-Level Security (RLS) |
| **Environment Keys** | **35+ variables** in root [`.env`](file:///e:/Code/Files/Agrimate/.env) | **6 variables** in [`web/.env.example`](file:///e:/Code/Files/Agrimate/web/.env.example) |
| **Local Ports** | Consumes 4 ports concurrently: `:3000`, `:3001`, `:3002`, `:4000` | Single port: `:3000` |
| **Deployment** | Multi-service: NestJS API on VPS/Fly/AWS + Web apps on Vercel + Expo mobile builds | Single deployment target: Vercel (or any Node.js host) connected to Supabase |
| **Security Layer** | Application-level AES-256-GCM encryption + HMAC blind indexing | Database-level Row-Level Security (RLS) policies on all tables |

---

## 3. Detailed Feature-by-Feature Matrix

### A. User Roles & Portals

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Buyer Portal** | Dedicated app at `http://localhost:3000` ([`apps/web-buyer`](file:///e:/Code/Files/Agrimate/apps/web-buyer)) | Integrated view in unified app at `http://localhost:3000` ([`web/src/app/(app)/market`](file:///e:/Code/Files/Agrimate/web/src/app/(app)/market)) |
| **Admin Console** | Dedicated app at `http://localhost:3001` ([`apps/web-admin`](file:///e:/Code/Files/Agrimate/apps/web-admin)) with D3 network graph | Integrated admin view at `http://localhost:3000/admin` ([`web/src/app/(app)/admin`](file:///e:/Code/Files/Agrimate/web/src/app/(app)/admin)) |
| **Farmer Portal** | Dedicated PWA at `http://localhost:3002` ([`apps/pwa-farmer`](file:///e:/Code/Files/Agrimate/apps/pwa-farmer)) with SVG dials | Integrated farmer listing desk and offer acceptance view |
| **Inspector App** | Native Expo React Native app ([`apps/app-inspector`](file:///e:/Code/Files/Agrimate/apps/app-inspector)) with camera & GPS | Mobile-responsive web form for pass/fail inspection reports and photos |
| **Logistics App** | Native Expo React Native app ([`apps/app-logistics`](file:///e:/Code/Files/Agrimate/apps/app-logistics)) with offline queue | Mobile-responsive web trip dashboard with document uploads |
| **Offline Parties** | Unsupported. Every counterparty must create an account and sign in | **Supported**. Admins can create offline farmers/dealers, trade on their behalf, and link user logins later |

---

### B. Authentication & Onboarding (KYC/KYB)

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Authentication Method** | Phone number + SMS OTP (Twilio, MSG91, or AWS SNS) | Supabase Auth (Email + Password, Magic Link, extensible to SMS) |
| **Identity Verification** | **Automated Cashfree Integration**: Validates PAN, checks GSTIN status, and executes bank penny-drop | **Manual Admin Review**: Admin reviews uploaded PAN/GSTIN/Bank documents and checks "Verified" |
| **Name-Matching Guard** | **Algorithmic**: Token-sort Levenshtein distance compares PAN name vs Bank-reported name. Any mismatch blocks all payouts | **Human Review**: Admin reviews documents side-by-side on the party review screen |
| **Inspector Credentials** | Mandatory B.Sc/M.Sc Agriculture or Veterinary degree upload + approval queue | Admin manually assigns inspections only to trusted professionals |
| **Data Protection** | AES-256-GCM column encryption on phone, PAN, and bank data | Private table (`party_private`) protected by PostgreSQL RLS (only party + admin can select) |

---

### C. Marketplace, Listings & RFQ Bidding

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Catalog (Listing Flow)** | Farmers list produce (commodity, grade, price, volume, location); buyers accept price | Farmers list produce; buyers browse and accept price or make counter-offers |
| **RFQ (Requirements Flow)**| Buyers post RFQ; farmers bid; buyer accepts winning bid | Buyers post requirements; farmers submit offers; buyer accepts winning offer |
| **Counterparty Privacy** | Phone numbers programmatically masked until order reaches `MATCHED` state | Contact details restricted via RLS to private tables until order is confirmed |
| **Offline Phone Deals** | Unsupported (all deals must originate through digital matching) | **Supported**: Admin can enter phone/WhatsApp deals directly as confirmed orders |

---

### D. Payments & Escrow Mechanism

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Payment Gateway** | **Razorpay Smart Collect (VAN)**: Issues dedicated virtual bank accounts per order | **Razorpay Standard Checkout**: Standard checkout popup (Cards, UPI, Netbanking) |
| **Payment Tranches** | Enforces rigid 3-part funding: **30% Advance $\rightarrow$ 100% Freight $\rightarrow$ 70% Balance** | Flexible: Buyer pays full balance or partial amounts via Razorpay or bank transfer |
| **Offline Payment Support**| **Blocked**: Only recognizes automated webhooks from Razorpay Smart Collect | **Supported**: Admin can record NEFT, RTGS, Cheque, Cash, or UPI payments on the order |
| **Escrow Management** | Automated Razorpay Route linked-account nodal escrow | Platform-managed escrow: Funds held in company account until delivery approval |
| **Over/Under Payment** | Webhook rejects/holds overpayments; underpayment leaves tranche pending | Automatically calculates invoiced total, received total, and remaining balance due |

---

### E. Disbursements & Payouts (Farmers & Transporters)

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Payout Execution** | **Automated API**: Calls Razorpay Route `transfer` API to move funds to linked bank accounts | **Manual Transfers**: Admin transfers funds via corporate netbanking/UPI and records the **UTR** |
| **Payout Requirements** | Blocked if PAN mismatch exists; blocked if order is not in `SETTLED` state | Executed at the discretion of the admin as milestones are completed |
| **Negative Balances** | Automated ledger offset: Prior default fees automatically deducted from current payout | Managed through admin notes and manual payout adjustments |
| **Refunds** | Automated via Razorpay Refund API | Executed through Razorpay dashboard or bank transfer, recorded on the order as a void/refund |

---

### F. Order State Machine & Business Rules

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Order Status Count** | **20 Granular States**: `MATCHED`, `AWAITING_ADVANCE`, `ADVANCE_LOCKED`, `LOGISTICS_PENDING`, `LOGISTICS_SECURED`, `AWAITING_BALANCE`, `FULLY_FUNDED`, `INSPECTION_SCHEDULED`, `INSPECTED`, `SELF_CERTIFIED`, `IN_TRANSIT`, `DELIVERED`, `DISPUTE_WINDOW`, `SETTLED`, `DISPUTED`, `RESOLVED`, `REFUNDED`, `FARMER_DEFAULTED`, `BUYER_DEFAULTED`, `CANCELLED` | **8 Operational States**: `confirmed`, `quality_check`, `ready`, `in_transit`, `delivered`, `completed`, `disputed`, `cancelled` |
| **Transition Control** | Table-driven code engine (`packages/shared/src/state-machine.ts`). Invalid moves return HTTP 409 | Role-governed server actions with an **Admin Override** allowing status changes at any time |
| **State Locks** | **Hard Locks**: Cannot inspect without 100% funding; cannot depart without balance in escrow | **Soft Controls**: Admin and counterparties update statuses as milestones are physically reached |
| **Automated Timers** | **Postgres Durable Timers**: 48h advance timeout, 24h dispute window timer, SLA assignment cron | **No automated timers**: Orders never auto-cancel; humans control deal progress |

---

### G. Quality Verification & Inspection

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Inspector Allocation** | Automated assignment algorithm based on PIN code proximity | Admin manually selects an inspector from the registered list |
| **Check-in Verification** | Geofenced: Inspector mobile app enforces GPS check-in within **500 meters** of the farm | Mobile-friendly web form accessible from any smartphone browser |
| **Inspection Report** | Structured numerical inputs: moisture %, foreign matter %, grain size, photos | Pass / Fail selection with detailed text notes and document/photo attachments |
| **Fallback Self-Cert** | **Cryptographic Video Capture**: 30-min window, single-use server tokens, GPS & hash validation | Admin manually reassigns another inspector or marks the check passed |

---

### H. Logistics, Freight & Delivery

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Freight Quote** | Automated formula: Google Maps distance $\times$ Vehicle Tier (₹28–₹70/km) + ₹1,000 loading fee | Admin manually enters the agreed freight amount in rupees |
| **Vehicle Assignment** | Driver mobile app with tonnage tier matching (up to 25t) | Transporter details (driver name, phone, vehicle number) saved to order |
| **E-Way Bill** | Hard validation: Driver cannot mark "Pickup" without uploading government E-Way Bill | E-Way Bill uploaded as a document attachment on the order |
| **Proof of Delivery** | Mobile capture: weighbridge slip photo, delivery photo, receiver signature | Document upload: Transporter or buyer uploads weighbridge slip and delivery photo |
| **Freight Release** | Automated: Delivery triggers immediate automated freight release to transporter | Admin records freight payout with UTR after delivery is confirmed |

---

### I. Disputes & Moisture Shrinkage

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Moisture Shrinkage** | **2.5% Automated Guard**: System programmatically rejects weight disputes if weight loss is $\le 2.5\%$ | Admin reviews received weighbridge slip vs dispatch weight and uses operational discretion |
| **Dispute Window** | Strict 24-hour timer from delivery. Closes automatically via background cron | Buyer clicks "Raise Dispute"; remains open until Admin reviews evidence and resolves |
| **Organic Spot Testing** | Formal sub-workflow: Extends dispute window by 72h; blocks settlement until lab report uploaded | Buyer uploads lab report under documents; Admin holds payout until verified |

---

### J. Accounting, Bookkeeping & Ledger

| Feature | Monorepo (`apps/*`) | Standalone Web App (`web/`) |
|---|---|---|
| **Financial Ledger** | **Full Double-Entry Bookkeeping**: Every transaction writes balanced journals (debits = credits) with SQL triggers | **Payment Records**: Direct records in `payments` table tracking direction (`in`/`out`), method, amount, and reference |
| **Invoicing & GST** | System generates PDF invoices with 0% GST on agri produce and 18% GST on platform commission | Invoices uploaded as documents; commission calculated as basis points |
| **Notifications** | Multilingual SMS engine (English, Hindi, Assamese, Bengali) with retry outbox | Supabase Auth emails for account actions; in-app order timeline for updates |
| **Mandi Market Data** | Fetches live daily mandi rates from data.gov.in (Agmarknet) | Focused purely on active marketplace trade (no background scraping) |

---

## 4. Operational Walkthrough: A Deal in Both Systems

### Scenario: A buyer in Guwahati buys 10,000 kg Paddy from a farmer in Nagaon for ₹2,40,000 + ₹15,000 freight.

```
MONOREPO FLOW:
1. Buyer accepts bid. Order state: MATCHED.
2. System generates Razorpay Virtual Account (VAN). State: AWAITING_ADVANCE.
3. 48-hour timer starts. Buyer NEFTs 30% (₹72,000) to VAN.
4. Razorpay webhook fires -> State: ADVANCE_LOCKED -> LOGISTICS_PENDING.
5. Buyer transfers ₹15,000 freight -> State: LOGISTICS_SECURED -> AWAITING_BALANCE.
6. Buyer transfers ₹1,68,000 balance -> State: FULLY_FUNDED -> INSPECTION_SCHEDULED.
7. SLA timer assigns inspector. Inspector arrives at farm (GPS within 500m), submits grade metrics.
8. State: INSPECTED -> IN_TRANSIT. Transporter uploads E-Way bill.
9. Transporter delivers, uploads PoD photo + digital signature -> State: DELIVERED.
10. System automatically pays ₹15,000 freight to transporter via Razorpay Route.
11. 24-hour dispute window timer starts. (Weight discrepancy under 2.5% is blocked by software).
12. 24 hours expire -> State: SETTLED.
13. Double-entry ledger balances. Razorpay Route API automatically transfers ₹2,32,800 to farmer.

WEB/ APP FLOW:
1. Buyer accepts offer (or Admin enters phone deal). Status: confirmed.
2. Admin assigns local inspector and transporter; sets freight to ₹15,000.
3. Buyer clicks "Pay online" and pays ₹2,55,000 via Razorpay Checkout (or sends RTGS; Admin clicks "Record Payment").
4. Inspector checks the grain and submits a "Pass" report with photos. Status moves to: ready.
5. Transporter picks up goods, uploads E-Way bill. Status moves to: in_transit.
6. Transporter delivers goods, uploads weighbridge slip. Status moves to: delivered.
7. Buyer confirms received weight. Status moves to: completed.
8. Admin transfers ₹15,000 freight to transporter via bank/UPI and records UTR in admin panel.
9. Admin transfers ₹2,32,800 to farmer via bank/UPI and records UTR in admin panel.
```

---

## 5. How to Setup and Run Each Application

### Option 1: Running the Standalone Web App (`web/`)

Best for: Immediate production launch with standard Razorpay checkout and manual operations.

1. **Database Setup**:
   * Open your Supabase Dashboard $\rightarrow$ **SQL Editor**.
   * Run [`web/supabase/migrations/0001_init.sql`](file:///e:/Code/Files/Agrimate/web/supabase/migrations/0001_init.sql).

2. **Configure `.env.local`**:
   Create `web/.env.local` with the 6 required keys:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR-ANON-KEY
   SUPABASE_SERVICE_ROLE_KEY=YOUR-SERVICE-ROLE-KEY
   RAZORPAY_KEY_ID=rzp_test_...
   RAZORPAY_KEY_SECRET=...
   RAZORPAY_WEBHOOK_SECRET=...
   ```

3. **Start the App**:
   ```bash
   cd web
   pnpm install
   pnpm dev
   ```
   Open `http://localhost:3000`.

4. **Make Yourself Admin**:
   Sign up on the site, then run in the Supabase SQL Editor:
   ```sql
   UPDATE public.profiles SET is_admin = true, party_id = null
   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your-email@example.com');
   ```

---

### Option 2: Running the Full Monorepo (`apps/*`)

Best for: Fully automated enterprise platform with programmatic escrow and multi-provider adapters.

1. **Configure Environment**:
   * Copy `.env.example` to `apps/api/.env`.
   * Fill in Supabase transaction pooler URL (`DATABASE_URL`), direct session pooler URL (`DIRECT_URL`), and S3 storage keys.

2. **Install & Run Migrations**:
   ```bash
   pnpm install
   pnpm --filter @agrimate/shared build && pnpm --filter @agrimate/api-client build
   pnpm db:migrate && pnpm db:seed
   ```

3. **Start All Services**:
   ```bash
   pnpm dev
   ```
   * Buyer Portal: `http://localhost:3000`
   * Admin Console: `http://localhost:3001`
   * Farmer PWA: `http://localhost:3002`
   * NestJS API: `http://localhost:4000/docs`

---

## 6. Summary: Which One Should You Use?

* **Use the [`web/`](file:///e:/Code/Files/Agrimate/web/) App if**:
  * You want **Razorpay only for payments** without complex virtual accounts or split escrow routing.
  * You want **no automatic locks, blocks, or timers**, allowing your operations team to manage assignments, verify accounts, and handle disputes manually.
  * You want a clean, single-app codebase with only 6 configuration keys that can be deployed to Vercel in minutes.

* **Use the Monorepo (`apps/*`) if**:
  * You need a multi-app ecosystem with native mobile apps (Expo) for drivers and inspectors.
  * You want fully automated escrow splits via Razorpay Route where the software transfers money programmatically.
  * You need a formal double-entry ledger with automated regulatory audit trails.

