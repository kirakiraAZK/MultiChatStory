import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/components/providers/QueryProvider';

export const metadata: Metadata = {
  title: 'MultiChat Studio — Multi-Character AI Chatroom',
  description: 'Localhost Multi-Character AI Chatroom with SSE Streaming, Turn Orchestration, Inline Editing & Regeneration',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased selection:bg-indigo-500/30 selection:text-indigo-200">
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
