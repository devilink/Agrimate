# Agrimate (web)

A B2B agri-trade platform. Farmers and FPOs list produce, buyers post requirements, either side makes offers, and
an accepted offer becomes an order. The Agrimate team handles the manual work on each order: assigning quality
inspectors and transport, recording offline payments, adding notes and documents, and resolving disputes.

- **One Next.js app** on Vercel, with a section for each role: buyer, farmer, transporter, inspector and admin.
- **Supabase** for login, the database and private file storage.
- **Razorpay Checkout** for online payments. Admins record bank transfer, UPI, cheque and cash payments and payouts by hand.
- **6 environment variables** (plus optional `ADMIN_EMAILS` and `NEXT_PUBLIC_SITE_URL`). See [.env.example](./.env.example).

## How an order moves

```
confirmed → quality_check → ready → in_transit → delivered → completed
                                                          ↘ disputed
(an admin can move any order to any status, including cancelled, with a note)
```

| Who | Can do |
|---|---|
| Farmer / FPO | List graded lots (quality specs, minimum order, packaging, fixed or negotiable price), edit, pause or close them, negotiate offers, mark the produce ready, upload documents |
| Buyer | Post requirements, make and counter offers, accept, pay online, confirm delivery or raise a dispute |
| Transporter | See assigned trips, mark them picked up and delivered, upload proof of delivery |
| Inspector | See assigned quality checks, submit pass/fail with notes and photos |
| Admin | Everything above, on behalf of anyone. Plus: the finance overview and payouts queue, the payments ledger, CSV exports, all offers, reference market prices, the freight rate card, the verification checklist, offline parties, phone deals, internal notes and the activity log |

## Features

- **Market.** Filter by commodity, grade, state, maximum price and verified traders only. Search and sort. Results are
  paged and every filter lives in the URL, so it works without JavaScript and links can be shared. Quantities and
  prices show in kg, quintals or tonnes; storage is always kg and paise.
- **Listings.** Quality specs (moisture, foreign matter, broken, purity), minimum order, packaging, harvest, and fixed or
  negotiable price. Farmers can type quantities and prices per kg, quintal or tonne. *My listings* lets a farmer edit
  price and quantity, pause, resume or close lots, and see which offers wait on them.
- **Negotiation.** Each offer is a thread. The two sides take turns: whoever did not set the current terms can accept,
  counter or decline. The database enforces the turn, the minimum order and paused listings, and keeps the thread
  append-only. Accepting creates the order at the latest terms.
- **Trust badges.** Admins tick a checklist on each party (identity, GSTIN, bank account, registered FPO). Members
  see *Verified*, *Trusted* (full checklist and 10+ completed trades) and *FPO* badges. Completed trades are counted by
  a database trigger.
- **Reference prices.** The team enters mandi prices (from Agmarknet, eNAM or traders) under *Reference prices*.
  Members see a 90-day trend and each listing shows how its price compares. Nothing is simulated: with no entries
  the pages say so.
- **Admin.**
  - *Overview*: money held, owed by buyers, farmer payouts due, fees earned, stale and overpaid orders.
  - *Payouts queue*: farmers until paid in full; transporters until their first payout.
  - *Payments ledger*: filters, plus a CSV export. Orders can be exported to CSV too.
  - *Offers*: who each negotiation is waiting on.
  - *Activity log*: paginated.
  - *Freight rate card*: suggests freight on each order from distance and vehicle.

Money: the buyer pays goods plus freight. The farmer receives goods minus the platform fee, a percentage that is
copied onto each order when it is created. Payouts to farmers and transporters happen outside the app (bank or UPI)
and are recorded on the order with their UTR.

## Setup

### 1. Supabase

1. Create a project, in the Mumbai region if your users are in India.
2. In **SQL Editor**, run each file in [supabase/migrations](./supabase/migrations) once, **in order**:
   - [0001_init.sql](./supabase/migrations/0001_init.sql): the tables, the security rules, the private `documents` storage bucket and some starter commodities.
   - [0002_marketplace_depth.sql](./supabase/migrations/0002_marketplace_depth.sql): quality specs, minimum orders and pausing, negotiation threads, trust flags, reference prices, the freight rate card, and the admin finance functions.

   Use a **new project**. The old Agrimate database has its own tables, so don't mix the two.
   **Upgrading a live project** that only has 0001? Run 0002 once. It backfills existing offers and completed-trade counts, and it is covered by the database tests.
3. In **Authentication > URL Configuration**:
   - Set **Site URL** to your Vercel domain, e.g. `https://agrimate.vercel.app`.
   - Add `https://YOUR-DOMAIN/**` and `http://localhost:3000/**` to **Redirect URLs**.

   Without this, confirmation and password-reset emails link to the wrong place.
4. In **Authentication > Emails > Templates**, change the link in two templates so it works even when opened on another device (e.g. requested on a laptop, opened on a phone):
   - **Confirm signup**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`
   - **Reset password**: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/account/password`

   The default templates also work, through `/auth/callback`, but only in the same browser that asked for the email.
   If Supabase has renamed a template variable, follow its "Server-side auth" guide for Next.js.
5. In **Authentication > Emails > SMTP**, add your own SMTP for production (Resend, SES, Zoho…). Supabase's built-in sender is limited to a handful of emails an hour.
6. Optional: turn off **Confirm email** under Authentication > Providers > Email if you don't want email verification. Admins verify every account before it can trade anyway.

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill it in. Find the Supabase keys under **Project Settings > API Keys**:

- The publishable/anon key goes in `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- The secret/service_role key goes in `SUPABASE_SERVICE_ROLE_KEY`. It bypasses all security rules: never expose it, and never prefix it with `NEXT_PUBLIC_`.

### 3. Run locally

```bash
cd web
pnpm install
pnpm dev            # http://localhost:3000
```

### 4. Make yourself the first admin

Easiest: set `ADMIN_EMAILS` to your email (in `.env.local` and in Vercel), sign up on the site with that email, confirm it, then sign in at **`/adminagri`**. That page is the admin sign-in. It makes a listed, confirmed email an admin the first time, and turns everyone else away.

Or sign up like a normal user, then run this in the Supabase SQL Editor:

```sql
update public.profiles set is_admin = true, party_id = null
where user_id = (select id from auth.users where email = 'you@example.com');
```

You can delete the buyer party created at signup from the Table Editor if you like. After that, add more admins from **Settings** in the app.

### 4b. Demo logins for every role (optional)

```bash
node scripts/demo-accounts.mjs              # sets a fresh random password on each demo login, checks it, seeds data
DEMO_PASSWORD='...' node scripts/demo-accounts.mjs --no-seed   # one chosen password for all, no data
node scripts/demo-accounts.mjs --seed-only  # test data only, passwords untouched
node scripts/demo-accounts.mjs --remove-data # deletes all [demo] test data (the accounts stay)
```

It manages one login per role (admin, farmer, buyer, transporter, inspector), `*@yourdomain.com` by default
(override with `DEMO_<ROLE>_EMAIL`), creates any that are missing as verified accounts, and prints the passwords
once. The test data is tagged `[demo]`:

- open listings (with quality specs and minimum orders), requirements and pending offers, one of them mid-negotiation;
- sample reference prices, labelled "[demo] sample data, not a real price" in their source;
- two offline parties, one of them waiting for verification;
- eight orders, one in each status from confirmed to cancelled. Each follows the real flow: inspector and transporter
  assigned, inspection result, payments in and payouts out, PDF documents, a dispute, and a backdated timeline.

`--remove-data` deletes it all again, including the stored files.

### 5. Razorpay

1. Under **Account & Settings > API Keys**, generate keys. Use `rzp_test_` keys first. Put them in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Under **Webhooks**:
   - Add `https://YOUR-DOMAIN/api/razorpay/webhook` with the **payment.captured** event.
   - Choose a secret and put the same value in `RAZORPAY_WEBHOOK_SECRET`.

   The webhook records payments even if a buyer closes the tab before the confirmation screen.
3. Keep **Payment capture** on automatic (the default).

After deploying with test keys, open an order as a buyer, click **Pay online**, and pay with a Razorpay test card.
Check the browser console for blocked-content (CSP) errors, and check that the payment appears on the order.

Without Razorpay keys the site still works. The online pay button is hidden, and buyers pay offline.

### 6. Deploy to Vercel

1. Import the Git repository in Vercel.
2. Set **Root Directory** to `web`. This folder has its own `pnpm-workspace.yaml` and lockfile, so Vercel installs only the web app, not the old monorepo.
3. Add the 6 environment variables for Production (and Preview if you use it) **before the first deploy**. The
   security headers are built with the Supabase URL in them, so redeploy if you ever change it.
4. If the install step complains about the pnpm version, add `ENABLE_EXPERIMENTAL_COREPACK=1` as an environment
   variable (build only; it tells Vercel to use the pnpm version in `package.json`).
5. Deploy, then put the final domain into the Supabase redirect settings (step 1.3) and the Razorpay webhook (step 5.2).

## Running a party's account

- **Verify**: new sign-ups can browse but can't trade until an admin ticks **Verified** on their party page.
- **Deactivate**: untick **Active**. They're signed out to an "account not active" page, and the database stops
  returning their data even if they still hold a valid token.
- **Offline parties**: add them under Parties, trade on their behalf, and later use **Create login** to let them in.

## Security model

- **Row-level security on every table.** Signed-in users can only read rows they're involved in. Contact, bank and tax details sit in a separate table that only the party itself and admins can read.
- **No writes from the browser.** The database refuses all INSERT, UPDATE and DELETE from browser keys. Every change goes through a server action that checks who you are and what your role allows on that order, and only then writes with the secret key.
- **Admin rights come from the database only.** The `profiles.is_admin` flag can't be set at signup or by the user.
- **Locked payout details.** Once an account is verified, its bank account, UPI, PAN and GSTIN can only be changed by an admin.
- **Payments are verified on the server.**
  - The amount comes from our own records, never from the browser.
  - The Checkout signature is checked, and the payment is confirmed with Razorpay's API before it is recorded.
  - Webhooks are checked against their HMAC signature.
  - A payment can't be recorded twice: there is a unique constraint on the Razorpay payment ID.
- **Tamper-proof timeline.** The `order_events` table is append-only: a database trigger blocks edits and deletes.
- **Private files.** Uploads go to a private bucket. They open through links valid for 60 seconds, issued only after an access check.
- **Security headers.** The app sends a strict Content-Security-Policy, HSTS and frame blocking.
- **Logins.** Supabase Auth handles password hashing, sessions and login rate limiting. Sign-in runs in the browser, so those limits apply to each user's own IP. Vercel's firewall adds DDoS protection.

### Database tests

`supabase/tests/migration.test.cjs` applies every migration, in order, to a **throwaway local Postgres** (never your
Supabase project) with stand-ins for Supabase's `auth` and `storage` schemas, then checks 76 rules:

- signup roles, and admin and offline-party linking;
- who can read what, and that browser writes and function calls are refused;
- deactivation;
- payments recorded only once, and overpayment flags;
- the append-only timeline;
- offer acceptance;
- negotiation turns, minimum orders and paused listings;
- thread visibility, the completed-trades counter, reference prices and the finance functions;
- upgrading a database that already holds 0001 data.

```bash
TEST_PG_URL=postgres://postgres@localhost:5432/postgres pnpm test:db
```

## Not included (yet)

- GST invoices and GST on the platform fee. Upload invoices as documents for now; the tax treatment needs a CA.
- Automatic mandi price feeds. The Agmarknet API (data.gov.in) could fill *Reference prices* automatically; until then the team enters them.
- Ratings and reviews between traders. Trust badges come from the checklist and completed trades.
- SMS or WhatsApp notifications.
- Phone OTP login. You can switch it on in Supabase Auth once an SMS provider is configured; the app would need a small login change.
- Hindi, Assamese and Bengali translations, which the old farmer app had. The UI is English only.
- Automatic refunds and payouts through Razorpay. Refunds are issued from the Razorpay dashboard, then voided on the order.
