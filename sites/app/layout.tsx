import type { Metadata } from 'next';
import '../../web/src/styles.css';
import '../../web/src/artifact-styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'CallBridge',
  description: 'ChatGPT prepares the call. You keep control.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
