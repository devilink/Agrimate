import type { Metadata, Viewport } from 'next';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { siteUrl } from '@/lib/site';
import './globals.css';

// next/font downloads the fonts at build time and serves them from our own domain, so the CSP needs no font CDN.
const ui = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-ui', display: 'swap' });
const serif = Fraunces({ subsets: ['latin'], variable: '--font-serif', display: 'swap', axes: ['opsz'] });

const description = 'B2B agri-trade for farmers, FPOs and bulk buyers, with quality checks, transport and payments on every order.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: { default: 'Agrimate · Farm produce, traded directly', template: '%s · Agrimate' },
  description,
  applicationName: 'Agrimate',
  openGraph: { type: 'website', siteName: 'Agrimate', title: 'Agrimate · Farm produce, traded directly', description, locale: 'en_IN' },
  twitter: { card: 'summary', title: 'Agrimate', description },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f563d' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${ui.variable} ${serif.variable}`}>
      <body className="min-h-screen antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-lift">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
