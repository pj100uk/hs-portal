import type { Metadata } from 'next'

/**
 * PRODUCTION ROOT LAYOUT
 * Note: The 'import ./globals.css' and <html>/<body> tags have been removed 
 * to allow the Canvas preview to compile without DOM nesting errors.
 * * IMPORTANT FOR GITHUB/VERCEL: 
 * For your real deployment, you must wrap {children} in <html> and <body> 
 * tags and include the globals.css import at the top of the file.
 */

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
    <div className="antialiased font-sans bg-slate-50 min-h-screen">
      {children}
    </div>
  )
}
