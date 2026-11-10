'use client';
import { useEffect, type ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';
import { registerServiceWorker } from '@/lib/sw-client';

export function Providers({ children }: { children: ReactNode }) {
  useEffect(() => { registerServiceWorker(); }, []);
  return <I18nProvider>{children}</I18nProvider>;
}
