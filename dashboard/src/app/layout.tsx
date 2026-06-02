import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import Link from 'next/link'
import { Activity } from 'lucide-react'
import './globals.css'
import { Providers } from './providers'
import { BullBoardLink } from '@/components/BullBoardLink'
import { MainNav } from '@/components/MainNav'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Backtest Dashboard',
  description: 'BullMQ workers, queues, and batch results',
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const bullBoardPort = Number(process.env.BULL_BOARD_PORT ?? 3052)
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background text-foreground">
        <Providers>
          <div className="flex min-h-screen flex-col">
            <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md">
              <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-6">
                <Link href="/" className="flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
                    <Activity className="h-4 w-4" strokeWidth={2.5} />
                  </div>
                  <span className="font-semibold tracking-tight">Backtest</span>
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    / dashboard
                  </span>
                </Link>
                <MainNav />
                <div className="ml-auto flex items-center gap-2 text-sm">
                  <BullBoardLink
                    port={bullBoardPort}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  />
                </div>
              </div>
            </header>
            <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-8">{children}</main>
          </div>
        </Providers>
      </body>
    </html>
  )
}
