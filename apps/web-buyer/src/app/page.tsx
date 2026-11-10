import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Agrimate · Direct farm-to-business produce trade with escrow',
  description: 'Buy bulk produce straight from farmers and FPOs. Payments held in escrow, stock graded on site, trucks tracked to your gate.',
};

const ICONS = {
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3zm-3.5 9l2.5 2.5 4.5-5',
  check: 'M9 11l3 3 7-7M20 12v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h9',
  truck: 'M3 6h11v9H3zM14 9h4l3 3v3h-7M7.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM17.5 18.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  sprout: 'M12 21v-9m0 0c0-4-3-7-8-7 0 5 3 7 8 7zm0 2c0-3 3-6 8-6 0 5-3 6-8 6zM6 21h12',
  bag: 'M3 7h18l-2 11H5L3 7zm5 0V5a4 4 0 0 1 8 0v2',
  lang: 'M4 5h8M8 3v2m-2 0c0 4 2 7 6 9M10 5c-1 4-3 7-6 9m9 7l4-9 4 9m-7-2.5h6',
  scale: 'M12 3v18M5 7h14M5 7l-3 6a3 3 0 0 0 6 0L5 7zm14 0l-3 6a3 3 0 0 0 6 0l-3-6zM8 21h8',
} as const;

function Icon({ name, className = 'h-6 w-6' }: { name: keyof typeof ICONS; className?: string }) {
  return <svg aria-hidden viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={ICONS[name]} /></svg>;
}

const CTA = 'inline-flex h-12 items-center justify-center gap-2 rounded-xl px-6 text-base font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2';

function Logo({ light }: { light?: boolean }) {
  return (
    <span className={`flex items-center gap-2 text-xl font-bold ${light ? 'text-white' : 'text-emerald-950'}`}>
      <span aria-hidden className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-lime-400 to-emerald-600 text-white shadow-sm"><Icon name="sprout" className="h-5 w-5" /></span>
      Agrimate
    </span>
  );
}

/** The hero illustration: one order moving through the platform, drawn in HTML so it stays crisp and light. */
function OrderPreview() {
  const steps = [
    { label: '30% advance in escrow', note: 'Bank virtual account', done: true },
    { label: 'Quality verified on site', note: 'Moisture 12.1% · within grade', done: true },
    { label: 'Truck on the way', note: 'AS01 · 142 km to go', done: false, live: true },
    { label: 'Delivered, farmer paid', note: 'After proof of delivery', done: false },
  ];
  return (
    <div className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-lime-300/40 via-emerald-300/30 to-sky-200/40 blur-2xl" />
      <div className="relative rounded-3xl border border-white/60 bg-white/90 p-6 shadow-2xl shadow-emerald-900/10 backdrop-blur">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500">Order AGM-2048</p>
            <p className="mt-1 text-lg font-semibold text-slate-900">Joha rice · Grade A</p>
            <p className="text-sm text-slate-600">10,000 kg · Nagaon → Guwahati</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">In transit</span>
        </div>
        <ol className="space-y-4">
          {steps.map((s) => (
            <li key={s.label} className="flex gap-3">
              <span aria-hidden className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? 'bg-emerald-600 text-white' : s.live ? 'bg-amber-100 text-amber-700 ring-4 ring-amber-50' : 'bg-slate-100 text-slate-400'}`}>
                {s.done ? '✓' : s.live ? <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" /> : '•'}
              </span>
              <div>
                <p className={`text-sm font-medium ${s.done || s.live ? 'text-slate-900' : 'text-slate-400'}`}>{s.label}</p>
                <p className="text-xs text-slate-500">{s.note}</p>
              </div>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5">
          <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Held in escrow</p><p className="text-lg font-semibold tabular-nums text-slate-900">₹5,10,800</p></div>
          <div className="rounded-xl bg-lime-50 p-3"><p className="text-xs text-lime-800">Price to farmer</p><p className="text-lg font-semibold tabular-nums text-lime-900">₹50 / kg</p></div>
        </div>
      </div>
      <div className="absolute -bottom-6 -left-6 hidden rounded-2xl border border-slate-100 bg-white p-3 shadow-xl sm:flex sm:items-center sm:gap-3">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-emerald-700"><Icon name="shield" className="h-5 w-5" /></span>
        <div><p className="text-xs text-slate-500">Payment status</p><p className="text-sm font-semibold text-slate-900">Protected until delivery</p></div>
      </div>
    </div>
  );
}

function Section({ id, eyebrow, title, intro, children, className = '' }: { id?: string; eyebrow: string; title: string; intro?: string; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`scroll-mt-20 px-4 py-20 sm:px-6 lg:py-28 ${className}`}>
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700">{eyebrow}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
          {intro && <p className="mt-4 text-lg text-slate-600">{intro}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

const STEPS = [
  { n: '01', title: 'Match', body: 'Buyers post a request for quotes or accept a listed price. Farmers and FPOs bid with their own price.', icon: 'chart' as const },
  { n: '02', title: 'Pay into escrow', body: 'Each order gets its own bank virtual account. The 30% advance locks the deal; the balance follows before dispatch.', icon: 'shield' as const },
  { n: '03', title: 'Verify quality', body: 'A qualified verifier checks in at the farm, grades the stock against the agreed spec and weighs it.', icon: 'scale' as const },
  { n: '04', title: 'Deliver and settle', body: 'A tracked truck carries the load. Proof of delivery releases payment to the farmer after the dispute window.', icon: 'truck' as const },
];

const FACTS = [
  { value: '30%', label: 'advance locks every order in escrow' },
  { value: 'On site', label: 'grading by verified agri-inspectors' },
  { value: '24 h', label: 'window to raise a weight or quality dispute' },
  { value: '4', label: 'languages in the farmer app' },
];

export default function Landing() {
  return (
    <div className="bg-white text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="Agrimate home"><Logo /></Link>
          <nav aria-label="Sections" className="hidden items-center gap-8 text-sm font-medium text-slate-600 md:flex">
            <a href="#how" className="hover:text-slate-900">How it works</a>
            <a href="#buyers" className="hover:text-slate-900">For buyers</a>
            <a href="#farmers" className="hover:text-slate-900">For farmers</a>
            <a href="#trust" className="hover:text-slate-900">Trust and safety</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="hidden h-10 items-center rounded-lg px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100 sm:inline-flex">Sign in</Link>
            <Link href="/login" className="inline-flex h-10 items-center rounded-lg bg-emerald-700 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800">Get started</Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden">
          <div aria-hidden className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,_#ecfccb_0%,_transparent_50%),radial-gradient(ellipse_at_bottom_right,_#d1fae5_0%,_transparent_55%)]" />
          <div aria-hidden className="absolute inset-0 bg-[linear-gradient(to_right,#0f172a08_1px,transparent_1px),linear-gradient(to_bottom,#0f172a08_1px,transparent_1px)] bg-[size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black_40%,transparent_75%)]" />
          <div className="relative mx-auto grid max-w-6xl items-center gap-16 px-4 pb-24 pt-16 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-32 lg:pt-24">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white/70 px-3 py-1 text-sm font-medium text-emerald-800 shadow-sm">
                <span className="h-2 w-2 rounded-full bg-lime-500" /> Farm-gate to factory-gate, in one place
              </p>
              <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
                Trade produce directly,
                <span className="block bg-gradient-to-r from-emerald-700 via-emerald-600 to-lime-600 bg-clip-text text-transparent">with nothing left to trust.</span>
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
                Agrimate connects bulk buyers with farmers and FPOs. Money waits in escrow, stock is graded at the farm, and every truck is tracked to your gate. Farmers get a fair price and get paid on delivery.
              </p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link href="/login" className={`${CTA} bg-emerald-700 text-white shadow-lg shadow-emerald-700/25 hover:bg-emerald-800 focus-visible:outline-emerald-700`}><Icon name="bag" className="h-5 w-5" />I want to buy</Link>
                <Link href="/login?as=farmer" className={`${CTA} border-2 border-emerald-700/20 bg-white text-emerald-900 hover:border-emerald-700/40 hover:bg-emerald-50 focus-visible:outline-emerald-700`}><Icon name="sprout" className="h-5 w-5" />I want to sell my crop</Link>
              </div>
              <p className="mt-5 text-sm text-slate-500">Free to join. Sign in with your mobile number.</p>
            </div>
            <OrderPreview />
          </div>
        </section>

        {/* Facts */}
        <section aria-label="Agrimate at a glance" className="border-y border-slate-200 bg-slate-50/60">
          <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-px px-4 sm:px-6 lg:grid-cols-4">
            {FACTS.map((f) => (
              <div key={f.label} className="px-4 py-8 text-center">
                <dt className="sr-only">{f.label}</dt>
                <dd className="text-3xl font-bold text-emerald-800">{f.value}</dd>
                <dd className="mt-1 text-sm text-slate-600">{f.label}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* How it works */}
        <Section id="how" eyebrow="How it works" title="From first bid to final payment" intro="Every order follows the same protected path, so both sides always know what happens next.">
          <ol className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n} className="group relative rounded-2xl border border-slate-200 bg-white p-6 transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-xl hover:shadow-emerald-900/5">
                <div className="mb-5 flex items-center justify-between">
                  <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700 transition group-hover:bg-emerald-600 group-hover:text-white"><Icon name={s.icon} /></span>
                  <span className="text-sm font-bold text-slate-300">{s.n}</span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </Section>

        {/* Audiences */}
        <section className="px-4 pb-20 sm:px-6 lg:pb-28">
          <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-2">
            <article id="buyers" className="scroll-mt-20 relative overflow-hidden rounded-3xl bg-slate-950 p-8 text-white sm:p-10">
              <div aria-hidden className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-500/30 blur-3xl" />
              <span className="relative grid h-12 w-12 place-items-center rounded-xl bg-white/10 text-lime-300"><Icon name="bag" /></span>
              <h2 className="relative mt-6 text-2xl font-bold sm:text-3xl">For buyers</h2>
              <p className="relative mt-3 text-slate-300">Mills, processors, exporters and retailers sourcing at scale.</p>
              <ul className="relative mt-8 space-y-4">
                {['Post an RFQ and compare bids from verified farmers and FPOs', 'Pay into a dedicated escrow account for each order', 'See the grading report, photos and scale weight before dispatch', 'Book platform freight with a transparent per-tonne-km price', 'Raise a weight or quality dispute with evidence if something is off'].map((t) => (
                  <li key={t} className="flex gap-3 text-sm text-slate-200"><span aria-hidden className="mt-0.5 text-lime-400"><Icon name="check" className="h-5 w-5" /></span>{t}</li>
                ))}
              </ul>
              <Link href="/login" className={`${CTA} relative mt-10 bg-lime-400 text-slate-950 hover:bg-lime-300 focus-visible:outline-lime-400`}>Start buying</Link>
            </article>

            <article id="farmers" className="scroll-mt-20 relative overflow-hidden rounded-3xl bg-gradient-to-br from-lime-100 via-emerald-50 to-white p-8 ring-1 ring-emerald-100 sm:p-10">
              <div aria-hidden className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-lime-300/40 blur-3xl" />
              <span className="relative grid h-12 w-12 place-items-center rounded-xl bg-emerald-700 text-white"><Icon name="sprout" /></span>
              <h2 className="relative mt-6 text-2xl font-bold text-emerald-950 sm:text-3xl">For farmers and FPOs</h2>
              <p className="relative mt-3 text-emerald-900/80">Sell your harvest straight to businesses, without a middleman's cut.</p>
              <ul className="relative mt-8 space-y-4">
                {['List your crop at your price, or bid on what buyers need', 'See live mandi prices before you decide', 'The buyer pays into escrow before you load a single bag', 'Get paid straight to your bank account after delivery', 'Use the app in English, Hindi, Assamese or Bengali, even on a weak signal'].map((t) => (
                  <li key={t} className="flex gap-3 text-sm text-emerald-950"><span aria-hidden className="mt-0.5 text-emerald-600"><Icon name="check" className="h-5 w-5" /></span>{t}</li>
                ))}
              </ul>
              <Link href="/login?as=farmer" className={`${CTA} relative mt-10 bg-emerald-700 text-white hover:bg-emerald-800 focus-visible:outline-emerald-700`}>Start selling</Link>
            </article>
          </div>
        </section>

        {/* Trust */}
        <Section id="trust" eyebrow="Trust and safety" title="Built so nobody has to take anyone's word for it" className="bg-slate-50">
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { icon: 'shield' as const, title: 'Escrow, not promises', body: 'Funds sit in a regulated escrow account and move only when the order reaches the next step. Every rupee is tracked in a double-entry ledger.' },
              { icon: 'scale' as const, title: 'Quality checked at the source', body: 'Verifiers must check in by GPS at the pickup point. Readings, photos and scale weight are recorded against the grade the buyer ordered.' },
              { icon: 'truck' as const, title: 'Logistics you can follow', body: 'Trucks are only dispatched once freight is paid. E-Way bills, pickup and a delivery code or signature close every trip.' },
            ].map((c) => (
              <div key={c.title} className="rounded-2xl border border-slate-200 bg-white p-7">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-800 text-white shadow-md shadow-emerald-700/20"><Icon name={c.icon} /></span>
                <h3 className="mt-5 text-lg font-semibold text-slate-900">{c.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-5 text-sm text-slate-600">
            <span className="flex items-center gap-2"><Icon name="lang" className="h-5 w-5 text-emerald-700" />Works in four languages</span>
            <span className="flex items-center gap-2"><Icon name="chart" className="h-5 w-5 text-emerald-700" />Live market prices</span>
            <span className="flex items-center gap-2"><Icon name="check" className="h-5 w-5 text-emerald-700" />KYC and KYB verified accounts</span>
          </div>
        </Section>

        {/* Closing CTA */}
        <section className="px-4 py-20 sm:px-6 lg:py-28">
          <div className="relative mx-auto max-w-5xl overflow-hidden rounded-3xl bg-emerald-800 px-6 py-16 text-center sm:px-16">
            <div aria-hidden className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,#a3e63555,transparent_40%),radial-gradient(circle_at_80%_80%,#05966988,transparent_45%)]" />
            <h2 className="relative text-3xl font-bold tracking-tight text-white sm:text-4xl">Your next harvest deal starts here.</h2>
            <p className="relative mx-auto mt-4 max-w-xl text-lg text-emerald-100">Sign up with your mobile number in under a minute. No fees to join.</p>
            <div className="relative mt-9 flex flex-col justify-center gap-3 sm:flex-row">
              <Link href="/login" className={`${CTA} bg-white text-emerald-900 hover:bg-emerald-50 focus-visible:outline-white`}>Sign in as a buyer</Link>
              <Link href="/login?as=farmer" className={`${CTA} border-2 border-white/40 text-white hover:bg-white/10 focus-visible:outline-white`}>Sign in as a farmer</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-10 text-sm text-slate-500 sm:flex-row sm:px-6">
          <Logo />
          <p>© {new Date().getFullYear()} Agrimate. Fair trade for Indian agriculture.</p>
        </div>
      </footer>
    </div>
  );
}
