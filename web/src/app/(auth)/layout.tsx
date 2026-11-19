import { Logo } from '@/components/ui';
import { IconCheck } from '@/components/icons';

const points = [
  'Verified buyers, farmers and FPOs',
  'Quality checks and transport on every order',
  'Pay online, or by bank transfer, UPI or cheque',
  'Every step recorded on the order',
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="bg-furrows relative hidden overflow-hidden bg-brand-900 p-10 text-white lg:flex lg:flex-col">
        <div aria-hidden="true" className="pointer-events-none absolute -bottom-32 -right-32 size-[28rem] rounded-full bg-brand-600/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-20 top-1/3 size-72 rounded-full bg-harvest-400/10 blur-3xl" />
        <Logo light />
        <div className="relative mt-auto max-w-md">
          <h2 className="font-display text-4xl font-semibold leading-tight tracking-tight">
            The straight line from <em className="font-medium italic text-harvest-300">farm</em> to buyer.
          </h2>
          <ul className="mt-8 space-y-3.5">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-brand-100/90">
                <span className="grid size-6 place-items-center rounded-full bg-white/10 text-harvest-300"><IconCheck className="size-3.5" /></span>
                {p}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative mt-16 text-sm text-brand-200/60">© {new Date().getFullYear()} Agrimate</p>
      </aside>

      <main id="main" className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden"><Logo /></div>
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-10 animate-fade-in">{children}</div>
      </main>
    </div>
  );
}
