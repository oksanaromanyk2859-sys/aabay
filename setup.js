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
  const now = new Date().toISOString();
  const admins = [
    { key: 'jafar@admin,com', email: 'jafar@admin.com', password: '112233', role: 'admin', name: 'جعفر' },
    { key: 'eng@admin,com', email: 'eng@admin.com', password: 'eng6969', role: 'superadmin', name: 'مدير النظام الرئيسي' },
    { key: 'superadmin@admin,com', email: 'superadmin@admin.com', password: 'superadmin12345', role: 'superadmin', name: 'مدير النظام' }
  ];
  const seeds = [];
  for (const a of admins) {
    const val = { id: a.key, email: a.email, password: a.password, role: a.role, name: a.name, status: 'active', createdAt: now, updatedAt: now, forceLogoutAt: 0 };
    seeds.push({ path: `dashboardUsers/${a.key}`, value: val });
    seeds.push({ path: `dashboardAccounts/${a.key}`, value: val });
  }
  seeds.push({ path: 'settings/geoBlocking', value: { enabled: true, allowedCountries: ['EG'] } });

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
