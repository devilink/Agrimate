export function AuthHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="mb-8">
      <h1 className="font-display text-3xl font-semibold tracking-tight text-stone-900">{title}</h1>
      <p className="mt-2 text-stone-600">{subtitle}</p>
    </div>
  );
}
