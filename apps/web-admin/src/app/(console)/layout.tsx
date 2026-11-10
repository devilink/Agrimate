import { Suspense, type ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { LoadingRows } from '@/components/console';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <Shell>
      {/* Pages read filters from the URL with useSearchParams, which needs a Suspense boundary at build time. */}
      <Suspense fallback={<LoadingRows />}>{children}</Suspense>
    </Shell>
  );
}
