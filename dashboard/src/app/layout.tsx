import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import './globals.css'
import { Providers } from './providers'
import { BullBoardLink } from '@/components/BullBoardLink'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Backtest Dashboard',
  description: 'BullMQ workers, queues, and batch results',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Read once on the server so the client component doesn't need a
  // separate NEXT_PUBLIC_* variable — same env var the bull-board.ts
  // process reads.
  const bullBoardPort = Number(process.env.BULL_BOARD_PORT ?? 3003)
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="min-h-screen">
        <Providers>
          <nav className="px-6 py-4 text-sm border-b border-border">
            <span className="font-semibold mr-2">Backtest Dashboard</span>
            <span className="text-muted mx-1">·</span>
            <Link href="/" className="text-link hover:underline mr-4">
              Overview
            </Link>
            <BullBoardLink port={bullBoardPort} className="text-link hover:underline mr-4" />
            <Link href="/api/health" className="text-link hover:underline">
              Health JSON
            </Link>
          </nav>
          <main className="px-6 py-6">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
