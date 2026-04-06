import type { Metadata } from 'next';
import '../src/App.css';

export const metadata: Metadata = {
  title: 'Resonator',
  icons: { icon: '/favicon.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
