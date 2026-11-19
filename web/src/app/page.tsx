import Link from 'next/link';
import { ButtonLink, Logo, cx } from '@/components/ui';
import {
  IconArrowRight, IconCheck, IconClipboardCheck, IconFile, IconHandshake, IconLock, IconMessage, IconPackage, IconRupee,
  IconScale, IconShield, IconSprout, IconStore, IconTruck, IconUsers, IconWallet,
} from '@/components/icons';

const steps = [
  { icon: IconStore, title: 'List or request', body: 'Farmers and FPOs list produce at their price. Buyers post the quantity, grade and delivery they need.' },
  { icon: IconHandshake, title: 'Offer and accept', body: 'Either side makes an offer. When one is accepted, it becomes an order with the agreed price and quantity.' },
  { icon: IconClipboardCheck, title: 'Check and dispatch', body: 'We assign a quality inspector and a transporter. Results, vehicle and driver details land on the order.' },
  { icon: IconWallet, title: 'Deliver and settle', body: 'The buyer confirms delivery and pays online or offline. The farmer is paid out, with every UTR on record.' },
];

const roles = [
  { icon: IconSprout, title: 'Farmers & FPOs', points: ['List produce with your own price', 'Answer buyer requirements with offers', 'See exactly what you will receive'] },
  { icon: IconStore, title: 'Buyers', points: ['Post requirements by grade and date', 'Track quality, transport and delivery', 'Pay online, or by bank, UPI or cheque'] },
  { icon: IconTruck, title: 'Transporters', points: ['See the trips assigned to you', 'Mark pickup and delivery from your phone', 'Upload proof of delivery'] },
  { icon: IconScale, title: 'Quality inspectors', points: ['See checks assigned to you', 'Submit pass or fail with findings', 'Attach photos and reports'] },
];

const trust = [
  { icon: IconShield, title: 'Verified before trading', body: 'Our team checks every account before it can list, offer or buy.' },
  { icon: IconLock, title: 'Payments checked on our server', body: 'Amounts come from our records, never the browser, and each payment is confirmed with Razorpay.' },
  { icon: IconFile, title: 'Private documents', body: 'Invoices, e-way bills and weighbridge slips are stored privately and open only for people on the order.' },
  { icon: IconMessage, title: 'A timeline that can’t be edited', body: 'Every status change, note and payment is recorded on the order, and the history is append-only.' },
  { icon: IconRupee, title: 'Clear money, both ways', body: 'Buyers see goods plus freight. Farmers see goods minus a platform fee fixed when the order is made.' },
  { icon: IconUsers, title: 'A team behind every deal', body: 'Deals made by phone or at the mandi can be entered for you, and we follow each order through.' },
];

export default function Home() {
  return (
    <div className="overflow-x-clip">
      {/* Hero */}
      <div className="bg-furrows relative bg-brand-900 text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 size-[36rem] rounded-full bg-brand-600/30 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-48 -left-24 size-[28rem] rounded-full bg-harvest-400/10 blur-3xl" />

        <header className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-5 sm:px-6">
          <Logo light />
          <nav className="hidden items-center gap-7 text-sm font-medium text-brand-100/80 md:flex" aria-label="Sections">
            <a href="#how" className="hover:text-white">How it works</a>
            <a href="#who" className="hover:text-white">Who it’s for</a>
            <a href="#trust" className="hover:text-white">Trust & safety</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-xl px-3 py-2 text-sm font-semibold text-white/90 hover:bg-white/10 hover:text-white">Sign in</Link>
            <ButtonLink href="/signup" variant="accent" small className="h-9 px-4"><span className="sm:hidden">Join</span><span className="hidden sm:inline">Create account</span></ButtonLink>
          </div>
        </header>

        <main id="main" className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.1fr_1fr] lg:pb-28 lg:pt-16">
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tracking-wide text-harvest-200 ring-1 ring-white/15">
              <span className="size-1.5 rounded-full bg-harvest-300" /> B2B agri-trade, built for India
            </span>
            <h1 className="mt-6 font-display text-[2.6rem] font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Bulk farm produce, traded <em className="font-medium italic text-harvest-300">directly</em>.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-brand-100/85">
              Farmers and FPOs list produce, buyers post what they need, and our team handles quality checks, transport
              and payments. Every step is recorded on the order.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <ButtonLink href="/signup" variant="accent" className="h-12 px-6 text-[0.9375rem]">Start trading <IconArrowRight /></ButtonLink>
              <Link href="/login" className="inline-flex h-12 items-center rounded-xl px-6 text-[0.9375rem] font-semibold text-white ring-1 ring-inset ring-white/25 hover:bg-white/10">
                I have an account
              </Link>
            </div>
            <ul className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-sm text-brand-100/80">
              {['Verified accounts', 'Online or offline payment', 'Quality checked'].map((t) => (
                <li key={t} className="flex items-center gap-2"><IconCheck className="size-4 text-harvest-300" />{t}</li>
              ))}
            </ul>
          </div>

          <HeroOrderCard />
        </main>
      </div>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead eyebrow="How it works" title="From listing to payout, on one order" body="No middlemen re-quoting your price. Agree a deal, and we take care of the legwork around it." />
        <ol className="relative mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <div aria-hidden="true" className="absolute left-0 right-0 top-7 hidden h-px bg-gradient-to-r from-transparent via-brand-200 to-transparent lg:block" />
          {steps.map((s, i) => (
            <li key={s.title} className="relative">
              <div className="relative grid size-14 place-items-center rounded-2xl bg-white text-brand-700 shadow-card ring-1 ring-stone-200">
                <s.icon className="size-6" />
                <span className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-harvest-400 text-xs font-bold text-brand-950">{i + 1}</span>
              </div>
              <h3 className="mt-5 font-semibold text-stone-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Roles */}
      <section id="who" className="scroll-mt-8 border-y border-stone-200/80 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 lg:py-28">
          <SectionHead eyebrow="Who it’s for" title="One place for everyone in the chain" body="Each person sees what they need, from their phone or their desk, and nothing they shouldn’t." />
          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {roles.map((r, i) => (
              <div key={r.title} className={cx(
                'group rounded-2xl border p-6 transition-all hover:-translate-y-1 hover:shadow-lift',
                i === 0 ? 'border-brand-800 bg-brand-800 text-white' : 'border-stone-200 bg-canvas',
              )}>
                <span className={cx('grid size-11 place-items-center rounded-xl', i === 0 ? 'bg-white/10 text-harvest-300' : 'bg-white text-brand-700 ring-1 ring-stone-200')}>
                  <r.icon className="size-5" />
                </span>
                <h3 className={cx('mt-5 font-display text-xl font-semibold', i === 0 ? 'text-white' : 'text-stone-900')}>{r.title}</h3>
                <ul className="mt-4 space-y-2.5">
                  {r.points.map((p) => (
                    <li key={p} className={cx('flex gap-2 text-sm', i === 0 ? 'text-brand-100/85' : 'text-stone-600')}>
                      <IconCheck className={cx('mt-0.5 size-4 shrink-0', i === 0 ? 'text-harvest-300' : 'text-brand-600')} />{p}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="mx-auto max-w-6xl scroll-mt-8 px-4 py-20 sm:px-6 lg:py-28">
        <SectionHead eyebrow="Trust & safety" title="Built so both sides can rely on it" body="Trade only works when everyone trusts the record. These rules are enforced by the system, not by policy." />
        <div className="mt-14 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {trust.map((t) => (
            <div key={t.title} className="flex gap-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 ring-1 ring-brand-100"><t.icon className="size-5" /></span>
              <div>
                <h3 className="font-semibold text-stone-900">{t.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-stone-600">{t.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6 lg:pb-28">
        <div className="bg-furrows relative overflow-hidden rounded-3xl bg-brand-800 px-6 py-14 text-center text-white sm:px-12">
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 -top-20 size-72 rounded-full bg-harvest-400/20 blur-3xl" />
          <h2 className="relative font-display text-3xl font-semibold tracking-tight sm:text-4xl">Ready for your next deal?</h2>
          <p className="relative mx-auto mt-4 max-w-xl text-brand-100/85">
            Create a free account. Our team verifies it, and then you can list, offer and buy.
          </p>
          <div className="relative mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/signup" variant="accent" className="h-12 px-6">Create your account <IconArrowRight /></ButtonLink>
            <Link href="/login" className="inline-flex h-12 items-center rounded-xl px-6 font-semibold ring-1 ring-inset ring-white/25 hover:bg-white/10">Sign in</Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-200/80 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <Logo />
            <p className="mt-3 max-w-sm text-sm text-stone-500">Need help with a deal? Our team can enter listings and orders for you.</p>
          </div>
          <div className="flex flex-col gap-2 text-sm text-stone-500 sm:items-end">
            <div className="flex gap-5">
              <Link href="/login" className="hover:text-stone-900">Sign in</Link>
              <Link href="/signup" className="hover:text-stone-900">Create account</Link>
            </div>
            <span>© {new Date().getFullYear()} Agrimate</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

function SectionHead({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return (
    <div className="max-w-2xl">
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">{eyebrow}</div>
      <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight text-stone-900 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-lg leading-relaxed text-stone-600">{body}</p>
    </div>
  );
}

/** An illustration of an order as people see it in the app. Sample figures, labelled as such. */
function HeroOrderCard() {
  const stages = ['Confirmed', 'Quality check', 'Ready', 'In transit', 'Delivered'];
  const current = 3;
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none" aria-label="Example of an order in Agrimate">
      <div aria-hidden="true" className="absolute -inset-4 rotate-2 rounded-[2rem] bg-white/5 ring-1 ring-white/10" />
      <div className="relative rounded-3xl bg-white p-6 text-stone-900 shadow-2xl shadow-brand-950/40">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-stone-500">Example order</div>
            <div className="mt-1 font-display text-xl font-semibold">Turmeric · Finger</div>
            <div className="mt-0.5 text-sm text-stone-500">12 t · Erode → Navi Mumbai</div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-800 ring-1 ring-inset ring-sky-600/20">
            <span className="size-1.5 animate-pulse rounded-full bg-sky-500" /> In transit
          </span>
        </div>

        <ol className="mt-6 grid grid-cols-5 gap-1.5">
          {stages.map((s, i) => (
            <li key={s} className="min-w-0">
              <div className={cx('h-1.5 rounded-full', i < current ? 'bg-brand-600' : i === current ? 'bg-sky-500' : 'bg-stone-200')} />
              <div className={cx('mt-2 truncate text-[0.65rem] font-medium', i <= current ? 'text-stone-700' : 'text-stone-400')}>{s}</div>
            </li>
          ))}
        </ol>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-brand-50 p-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-brand-700"><IconClipboardCheck className="size-3.5" /> Quality</div>
            <div className="mt-1 font-semibold text-brand-900">Passed</div>
            <div className="text-xs text-brand-700/80">Moisture 9.8%</div>
          </div>
          <div className="rounded-2xl bg-stone-100 p-4">
            <div className="flex items-center gap-1.5 text-xs font-medium text-stone-600"><IconTruck className="size-3.5" /> Vehicle</div>
            <div className="mt-1 font-semibold">TN 33 AB 4521</div>
            <div className="text-xs text-stone-500">ETA Thursday</div>
          </div>
        </div>

        <dl className="mt-6 space-y-2 border-t border-dashed border-stone-200 pt-5 text-sm">
          <div className="flex justify-between"><dt className="text-stone-500">Goods (12,000 kg × ₹118)</dt><dd className="font-medium tabular-nums">₹14,16,000</dd></div>
          <div className="flex justify-between"><dt className="text-stone-500">Freight</dt><dd className="font-medium tabular-nums">₹62,000</dd></div>
          <div className="flex justify-between text-base"><dt className="font-semibold">Buyer pays</dt><dd className="font-semibold tabular-nums">₹14,78,000</dd></div>
        </dl>

        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-harvest-50 p-3 ring-1 ring-harvest-200">
          <span className="grid size-9 place-items-center rounded-xl bg-harvest-400 text-brand-950"><IconPackage className="size-[18px]" /></span>
          <div className="text-xs leading-snug text-harvest-700">
            <span className="font-semibold">Weighbridge slip uploaded</span><br />by the transporter, 2 hours ago
          </div>
        </div>
      </div>
    </div>
  );
}
