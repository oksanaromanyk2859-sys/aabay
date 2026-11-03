const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars'); process.exit(1); }
const BUCKET = 'rtdb';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function writeFile(fp, value) {
  const storage = supabase.storage.from(BUCKET);
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
  const { error } = await storage.upload(fp, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}

async function main() {
  console.log('Ensuring storage bucket exists...');
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some(b => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
    if (error) { console.error('Failed to create bucket:', error.message); process.exit(1); }
    console.log('Created bucket:', BUCKET);
  } else {
    console.log('Bucket already exists:', BUCKET);
  }

  console.log('Seeding data...');
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
    try {
      await writeFile(s.path + '.json', s.value);
      console.log('  Seeded:', s.path);
    } catch (e) {
      console.error('  Error seeding', s.path + ':', e.message);
    }
  }

  console.log('Setup complete!');
}

main().catch(e => { console.error(e); process.exit(1); });
