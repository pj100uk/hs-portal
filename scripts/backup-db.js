// Supabase database backup — exports all tables to timestamped JSON files.
// Run manually: node scripts/backup-db.js
// Scheduled via Windows Task Scheduler (see scripts/backup-db.bat)

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env.local') });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const TABLES = [
  'organisations',
  'sites',
  'profiles',
  'actions',
  'site_documents',
  'document_health',
  'advisor_organisations',
  'advisor_site_assignments',
  'client_site_assignments',
  'site_services',
  'site_type_requirements',
  'site_type_requirement_changes',
  'ai_usage_log',
];

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backup() {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const backupDir = path.join(__dirname, '../backups', timestamp);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`Backing up to ${backupDir}`);

  const results = {};
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) {
      console.error(`  ✗ ${table}: ${error.message}`);
      results[table] = { error: error.message };
    } else {
      fs.writeFileSync(
        path.join(backupDir, `${table}.json`),
        JSON.stringify(data, null, 2)
      );
      console.log(`  ✓ ${table}: ${data.length} rows`);
      results[table] = { rows: data.length };
    }
  }

  // Write a manifest
  fs.writeFileSync(
    path.join(backupDir, '_manifest.json'),
    JSON.stringify({ timestamp, tables: results }, null, 2)
  );

  console.log(`\nBackup complete: ${backupDir}`);
}

backup().catch(err => { console.error('Backup failed:', err); process.exit(1); });
