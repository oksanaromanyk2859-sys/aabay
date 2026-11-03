const { Client } = require('pg');

const CONNECTION = process.env.DATABASE_URL;
if (!CONNECTION) {
  console.error('Set DATABASE_URL env var (Supabase PostgreSQL connection string)');
  process.exit(1);
}

async function main() {
  const client = new Client({ connectionString: CONNECTION, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected to Supabase PostgreSQL');

  await client.query(`
    CREATE TABLE IF NOT EXISTS rtdb (
      path TEXT PRIMARY KEY,
      value JSONB DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  console.log('Table "rtdb" ensured');

  await client.query(`CREATE INDEX IF NOT EXISTS idx_rtdb_path_prefix ON rtdb USING btree (path text_pattern_ops);`);
  console.log('Index ensured');

  const { createClient } = require('@supabase/supabase-js');
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.log('SUPABASE_URL/SUPABASE_SERVICE_KEY not set, skipping seed via REST');
    await client.end();
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const seeds = [
    {
      path: 'dashboardUsers/jafar@admin,com',
      value: { email: 'jafar@admin.com', password: '112233', role: 'admin', status: 'active', createdAt: new Date().toISOString() }
    },
    {
      path: 'dashboardUsers/eng@admin,com',
      value: { email: 'eng@admin.com', password: 'eng6969', role: 'superadmin', status: 'active', createdAt: new Date().toISOString() }
    },
    {
      path: 'dashboardUsers/superadmin@admin,com',
      value: { email: 'superadmin@admin.com', password: 'superadmin12345', role: 'superadmin', status: 'active', createdAt: new Date().toISOString() }
    },
    {
      path: 'settings/geoBlocking',
      value: { enabled: true, allowedCountries: ['EG'] }
    }
  ];

  for (const s of seeds) {
    const { error } = await supabase.from('rtdb').upsert(
      { path: s.path, value: s.value, updated_at: new Date().toISOString() },
      { onConflict: 'path' }
    );
    if (error) console.error(`  Error seeding ${s.path}:`, error.message);
    else console.log(`  Seeded: ${s.path}`);
  }

  console.log('Setup complete');
  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
