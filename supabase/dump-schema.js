#!/usr/bin/env node
// Dumps the Supabase public schema to supabase/schema.sql
// Run automatically via Claude Code SessionStart hook

const fs = require('fs');
const path = require('path');

// Parse .env.local
const envPath = path.join(__dirname, '..', '.env.local');
const env = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
}

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('dump-schema: missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

async function main() {
  const r = await fetch(`${url}/rest/v1/rpc/get_schema_dump`, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!r.ok) {
    console.error('dump-schema: RPC failed:', r.status, await r.text());
    process.exit(1);
  }

  const text = await r.json(); // returns a plain text string
  const outPath = path.join(__dirname, 'schema.sql');
  fs.writeFileSync(outPath, `-- Schema dumped at ${new Date().toISOString()}\n\n${text}\n`);
  console.log(`dump-schema: wrote ${outPath}`);
}

main().catch(err => {
  console.error('dump-schema:', err.message);
  process.exit(1);
});
