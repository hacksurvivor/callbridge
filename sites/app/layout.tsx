import type { Metadata } from 'next';
import './globals.css';
import '../../web/src/styles.css';
import '../../web/src/artifact-styles.css';

export const metadata: Metadata = {
  title: 'Concierge',
  description: 'ChatGPT prepares the call. You keep control.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {/* THESIS: Relay Line makes a consequential AI task calm and legible. OWN-WORLD: one red route ties request, factual work, plan, and result together. STORY: conversation, evidence, then revision-bound approval. FIRST VIEWPORT: title, conversations, media, status, and live thread. FORM: three-column workspace with mobile sheets. FINISH: monochrome surfaces, restrained red signal, authored icons, and honest states. */}
        {children}
      </body>
    </html>
  );
}
