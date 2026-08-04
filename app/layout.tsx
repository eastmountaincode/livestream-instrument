import type { Metadata } from 'next';
import { Analytics } from '@vercel/analytics/next';
import '../src/App.css';

export const metadata: Metadata = {
  title: 'Cicada',
  applicationName: 'Cicada',
  appleWebApp: { title: 'Cicada' },
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
