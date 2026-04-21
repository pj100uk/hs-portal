import './globals.css'
import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'McCormack Benson Health & Safety',
  description: 'McCormack Benson Health & Safety — Compliance Portal',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-slate-50 min-h-screen overflow-x-hidden">
        {children}
      </body>
    </html>
  )
}