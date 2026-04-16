import { NextResponse } from 'next/server';
import { execSync } from 'child_process';

export const runtime = 'nodejs';

// GET /api/datto/resolve-drive-path
// Scans all mapped drives via `net use` to find the Datto WorkPlace share
// (whichever drive maps to \\*\Workplace) and returns its UNC base path and drive letter.
// Used by advisors to auto-detect their Datto path in portal Settings.
export async function GET() {
  try {
    const output = execSync('net use', { encoding: 'utf8' });

    // net use (no args) lists all connections, one per line:
    //   OK  W:  \\Paul\Workplace  Microsoft Windows Network
    const lines = output.split(/\r?\n/);
    for (const line of lines) {
      // Match lines with a drive letter and a UNC path ending in \Workplace
      const match = line.match(/\b([A-Z]):\s+(\\\\[^\s]+\\Workplace)\b/i);
      if (match) {
        const driveLetter = match[1].toUpperCase();
        const uncRoot = match[2]; // e.g. \\Paul\Workplace
        const uncBase = `${uncRoot}\\Customer Documents`;
        return NextResponse.json({
          path: uncBase.replace(/\\/g, '/'),   // //Paul/Workplace/Customer Documents
          driveLetter,                          // W
        });
      }
    }

    return NextResponse.json(
      { error: 'Datto WorkPlace drive not found. Make sure Datto WorkPlace is running.' },
      { status: 404 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: `net use failed: ${err.message ?? String(err)}` },
      { status: 500 }
    );
  }
}
