import './globals.css'
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'H&S Compliance Portal',
  description: 'Precision Engineering Ltd - Compliance Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased font-sans bg-slate-50 min-h-screen">
        {children}
      </body>
    </html>
  )
}