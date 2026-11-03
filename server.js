const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ADMIN_PASS = process.env.ADMIN_PASS || 'Admin1234@@';
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY env vars'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function normPath(p) {
  return (p || '').replace(/^\/+|\/+$/g, '');
}

function deepMerge(target, source) {
  if (!source || typeof source !== 'object') return source;
  if (!target || typeof target !== 'object') target = {};
  const out = { ...target };
  for (const [k, v] of Object.entries(source)) {
    if (v !== undefined) {
      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        out[k] = deepMerge(out[k], v);
      } else {
        out[k] = v;
      }
    }
  }
  return out;
}

function genKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(20);
  let key = '-';
  for (let i = 0; i < 19; i++) key += chars[bytes[i] % chars.length];
  return key;
}

// Firebase RTDB expands slash-separated keys in update(): {"a/b": v} → {a: {b: v}}
function expandSlashKeys(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key.includes('/')) {
      const parts = key.split('/');
      let cur = result;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    } else {
      if (value && typeof value === 'object' && !Array.isArray(value) && result[key] && typeof result[key] === 'object') {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }
  return result;
}

// Map Firebase RTDB paths to PostgreSQL tables
// paths: dashboardAccounts/<id>, dashboardUsers/<id>, customers/<id>, settings/<key>, customerEvents/<id>
function pathToTable(p) {
  const parts = p.split('/');
  const root = parts[0];
  const mapping = {
    dashboardAccounts: 'dashboard_accounts',
    dashboardUsers: 'dashboard_accounts',
    customers: 'customers',
    settings: 'settings',
    customerEvents: 'customer_events'
  };
  return { table: mapping[root] || null, root, parts };
}

// Convert snake_case DB row to camelCase for Firebase compat
function rowToFirebase(row, table) {
  if (!row) return null;
  if (table === 'dashboard_accounts') {
    const base = {
      id: row.id, email: row.email, password: row.password, role: row.role,
      name: row.name, status: row.status,
      createdAt: row.created_at, updatedAt: row.updated_at,
      lastLoginAt: row.last_login_at, forceLogoutAt: row.force_logout_at || 0
    };
    if (row.data && typeof row.data === 'object') {
      const expanded = expandSlashKeys(row.data);
      Object.assign(base, expanded);
    }
    return base;
  }
  if (table === 'customers') {
    const base = {
      id: row.id, code: row.code, email: row.email, username: row.username,
      password: row.password, accountType: row.account_type,
      status: row.status, currentStep: row.current_step,
      lastPage: row.last_page, lastAction: row.last_action,
      selectedWatch: row.selected_watch, userAgent: row.user_agent,
      createdAt: row.created_at, updatedAt: row.updated_at
    };
    if (row.data && typeof row.data === 'object') {
      const expanded = expandSlashKeys(row.data);
      for (const [k, v] of Object.entries(expanded)) {
        if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object') {
          base[k] = deepMerge(base[k], v);
        } else {
          base[k] = v;
        }
      }
    }
    return base;
  }
  if (table === 'settings') {
    return row.value;
  }
  if (table === 'customer_events') {
    return { id: row.id, customerId: row.customer_id, eventType: row.event_type, data: row.data, createdAt: row.created_at };
  }
  return row;
}

// Convert Firebase-style data to DB columns
function firebaseToRow(data, table) {
  if (table === 'dashboard_accounts') {
    const row = {};
    const knownAdminFields = ['id','email','password','role','name','status','createdAt','updatedAt','lastLoginAt','forceLogoutAt'];
    if (data.id !== undefined) row.id = data.id;
    if (data.email !== undefined) row.email = data.email;
    if (data.password !== undefined) row.password = data.password;
    if (data.role !== undefined) row.role = data.role;
    if (data.name !== undefined) row.name = data.name;
    if (data.status !== undefined) row.status = data.status;
    if (data.createdAt !== undefined) row.created_at = data.createdAt;
    if (data.updatedAt !== undefined) row.updated_at = data.updatedAt;
    if (data.lastLoginAt !== undefined) row.last_login_at = data.lastLoginAt;
    if (data.forceLogoutAt !== undefined) row.force_logout_at = data.forceLogoutAt;
    const extra = {};
    for (const [k, v] of Object.entries(data)) {
      if (!knownAdminFields.includes(k)) extra[k] = v;
    }
    if (Object.keys(extra).length) row.data = deepMerge(row.data || {}, extra);
    return row;
  }
  if (table === 'customers') {
    const row = {};
    const knownFields = ['id','code','email','username','password','accountType','status','currentStep','lastPage','lastAction','selectedWatch','userAgent','createdAt','updatedAt'];
    if (data.id !== undefined) row.id = data.id;
    if (data.code !== undefined) row.code = data.code;
    if (data.email !== undefined) row.email = data.email;
    if (data.username !== undefined) row.username = data.username;
    if (data.password !== undefined) row.password = data.password;
    if (data.accountType !== undefined) row.account_type = data.accountType;
    if (data.status !== undefined) row.status = data.status;
    if (data.currentStep !== undefined) row.current_step = data.currentStep;
    if (data.lastPage !== undefined) row.last_page = data.lastPage;
    if (data.lastAction !== undefined) row.last_action = data.lastAction;
    if (data.selectedWatch !== undefined) row.selected_watch = data.selectedWatch;
    if (data.userAgent !== undefined) row.user_agent = data.userAgent;
    if (data.createdAt !== undefined) row.created_at = data.createdAt;
    if (data.updatedAt !== undefined) row.updated_at = data.updatedAt;
    const extra = {};
    for (const [k, v] of Object.entries(data)) {
      if (!knownFields.includes(k)) extra[k] = v;
    }
    if (Object.keys(extra).length) row.data = deepMerge(row.data || {}, extra);
    return row;
  }
  return data;
}

// ── RTDB-compatible CRUD using PostgreSQL ──────────────────

async function rtdbRead(rawPath) {
  const p = normPath(rawPath);
  if (!p) return null;

  const { table, root, parts } = pathToTable(p);
  if (!table) return null;

  if (parts.length === 1) {
    if (table === 'settings') {
      const { data, error } = await supabase.from(table).select('*');
      if (error || !data || !data.length) return null;
      const result = {};
      for (const row of data) result[row.key] = row.value;
      return result;
    }
    const { data, error } = await supabase.from(table).select('*');
    if (error || !data || !data.length) return null;
    const result = {};
    for (const row of data) {
      result[row.id] = rowToFirebase(row, table);
    }
    return result;
  }

  if (parts.length >= 2) {
    const id = parts[1];
    if (table === 'settings') {
      const { data, error } = await supabase.from(table).select('*').eq('key', id).single();
      if (error || !data) return null;
      return data.value;
    }
    const { data, error } = await supabase.from(table).select('*').eq('id', id).single();
    if (error || !data) return null;
    const fbData = rowToFirebase(data, table);
    if (parts.length > 2) {
      let cur = fbData;
      for (let i = 2; i < parts.length; i++) {
        if (cur == null || typeof cur !== 'object') return null;
        cur = cur[parts[i]];
      }
      return cur ?? null;
    }
    return fbData;
  }
  return null;
}

async function rtdbSet(rawPath, value) {
  const p = normPath(rawPath);
  if (!p) return;
  const { table, root, parts } = pathToTable(p);
  if (!table) return;

  if (value === null || value === undefined) {
    return rtdbRemove(rawPath);
  }

  if (parts.length < 2) return;

  const id = parts[1];

  if (table === 'settings') {
    const { error } = await supabase.from(table).upsert({ key: id, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return;
  }

  if (parts.length === 2) {
    const row = firebaseToRow({ id, ...value }, table);
    row.id = id;
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return;
  }

  // Nested path: read, modify, write back
  const { data: existing } = await supabase.from(table).select('*').eq('id', id).single();
  if (!existing) {
    const newData = {};
    let cur = newData;
    for (let i = 2; i < parts.length - 1; i++) {
      cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
    const row = firebaseToRow({ id, ...newData }, table);
    row.id = id;
    const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
    if (error) throw error;
    return;
  }

  const fbData = rowToFirebase(existing, table);
  let cur = fbData;
  for (let i = 2; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
  const row = firebaseToRow(fbData, table);
  row.id = id;
  const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

async function rtdbUpdate(rawPath, updates) {
  const p = normPath(rawPath);
  if (!p || !updates) return;
  const { table, root, parts } = pathToTable(p);
  if (!table || parts.length < 2) return;

  const id = parts[1];
  const expanded = expandSlashKeys(updates);

  if (table === 'settings') {
    const { data: existing } = await supabase.from(table).select('*').eq('key', id).single();
    const merged = deepMerge(existing?.value || {}, expanded);
    const { error } = await supabase.from(table).upsert({ key: id, value: merged, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    return;
  }

  const { data: existing } = await supabase.from(table).select('*').eq('id', id).single();
  const fbData = existing ? rowToFirebase(existing, table) : { id };

  if (parts.length > 2) {
    let cur = fbData;
    for (let i = 2; i < parts.length; i++) {
      if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    deepMerge(cur, expanded);
    Object.assign(cur, expanded);
  } else {
    for (const [k, v] of Object.entries(expanded)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && fbData[k] && typeof fbData[k] === 'object') {
        fbData[k] = deepMerge(fbData[k], v);
      } else {
        fbData[k] = v;
      }
    }
  }

  const row = firebaseToRow(fbData, table);
  row.id = id;
  const { error } = await supabase.from(table).upsert(row, { onConflict: 'id' });
  if (error) throw error;
}

async function rtdbPush(rawPath, value) {
  const p = normPath(rawPath);
  const key = genKey();
  const { table, parts } = pathToTable(p);

  if (table === 'customer_events') {
    const row = {
      customer_id: value.customerId || null,
      event_type: value.eventType || 'unknown',
      data: value.data || value,
      created_at: value.createdAt || new Date().toISOString()
    };
    let { error } = await supabase.from(table).insert(row);
    if (error && error.message?.includes('foreign key')) {
      row.customer_id = null;
      ({ error } = await supabase.from(table).insert(row));
    }
    if (error) throw error;
    return key;
  }

  await rtdbSet(`${p}/${key}`, value);
  return key;
}

async function rtdbRemove(rawPath) {
  const p = normPath(rawPath);
  if (!p) return;
  const { table, parts } = pathToTable(p);
  if (!table) return;

  if (parts.length === 1) {
    await supabase.from(table).delete().neq('id', '___never___');
    return;
  }

  const id = parts[1];

  if (parts.length === 2) {
    if (table === 'settings') {
      await supabase.from(table).delete().eq('key', id);
    } else {
      await supabase.from(table).delete().eq('id', id);
    }
    return;
  }

  // Nested remove: read, delete key, write back
  const { data: existing } = await supabase.from(table).select('*').eq('id', id).single();
  if (!existing) return;
  const fbData = rowToFirebase(existing, table);
  let cur = fbData;
  for (let i = 2; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) return;
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
  const row = firebaseToRow(fbData, table);
  row.id = id;
  await supabase.from(table).upsert(row, { onConflict: 'id' });
}

// ── Firebase-compatible data API ────────────────────────────

app.post('/api/fb/read', async (req, res) => {
  try {
    const val = await rtdbRead(req.body.path);
    res.json({ value: val });
  } catch (e) {
    console.error('fb/read error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/fb/set', async (req, res) => {
  try {
    await rtdbSet(req.body.path, req.body.value);
    res.json({ ok: true });
  } catch (e) {
    console.error('fb/set error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/fb/update', async (req, res) => {
  try {
    await rtdbUpdate(req.body.path, req.body.value);
    res.json({ ok: true });
  } catch (e) {
    console.error('fb/update error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/fb/push', async (req, res) => {
  try {
    const key = await rtdbPush(req.body.path, req.body.value);
    res.json({ key });
  } catch (e) {
    console.error('fb/push error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/fb/remove', async (req, res) => {
  try {
    await rtdbRemove(req.body.path);
    res.json({ ok: true });
  } catch (e) {
    console.error('fb/remove error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Auth API (replaces Firebase Auth) ───────────────────────

const authTokens = new Map();

app.post('/api/auth/signin', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'missing fields' });
    const key = email.trim().toLowerCase().replace(/[.#$\[\]]/g, '_');
    const { data: row, error } = await supabase.from('dashboard_accounts').select('*').eq('id', key).single();

    if (error || !row) return res.status(401).json({ code: 'auth/user-not-found', message: 'User not found' });
    if (row.status === 'inactive') return res.status(401).json({ code: 'auth/user-disabled', message: 'Account disabled' });
    if (row.password !== password) return res.status(401).json({ code: 'auth/wrong-password', message: 'Wrong password' });

    const uid = key;
    const token = crypto.randomBytes(32).toString('hex');
    authTokens.set(token, { uid, email: email.trim().toLowerCase() });
    res.json({ uid, email: email.trim().toLowerCase(), token, claims: { role: row.role } });
  } catch (e) {
    console.error('auth/signin error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/create', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'missing fields' });
    const key = email.trim().toLowerCase().replace(/[.#$\[\]]/g, '_');
    const { data: existing } = await supabase.from('dashboard_accounts').select('*').eq('id', key).single();

    if (existing) {
      if (existing.password !== password) {
        await supabase.from('dashboard_accounts').update({ password }).eq('id', key);
      }
      const token = crypto.randomBytes(32).toString('hex');
      authTokens.set(token, { uid: key, email: email.trim().toLowerCase() });
      return res.json({ uid: key, email: email.trim().toLowerCase(), token, existing: true, claims: { role: existing.role } });
    }

    const uid = key;
    const token = crypto.randomBytes(32).toString('hex');
    authTokens.set(token, { uid, email: email.trim().toLowerCase() });
    res.json({ uid, email: email.trim().toLowerCase(), token });
  } catch (e) {
    if (e.message?.includes('already-in-use')) {
      return res.status(409).json({ code: 'auth/email-already-in-use', message: 'Email already in use' });
    }
    console.error('auth/create error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/signout', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (token) authTokens.delete(token);
  res.json({ ok: true });
});

app.get('/api/auth/state', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const user = authTokens.get(token);
  if (user) return res.json({ uid: user.uid, email: user.email });
  res.json({ uid: null, email: null });
});

// ── Settings API (for geo-blocking) ─────────────────────────

app.get('/api/settings/:key.json', async (req, res) => {
  try {
    const { data, error } = await supabase.from('settings').select('value').eq('key', req.params.key).single();
    res.json(data?.value || null);
  } catch (e) {
    res.json(null);
  }
});

// ── Setup endpoint ────────────────────────────────────────────

app.post('/api/setup', async (req, res) => {
  try {
    const admins = [
      { id: 'jafar@admin_com', email: 'jafar@admin.com', password: '112233', role: 'admin', name: 'جعفر' },
      { id: 'eng@admin_com', email: 'eng@admin.com', password: 'eng6969', role: 'superadmin', name: 'مدير النظام الرئيسي' },
      { id: 'superadmin@admin_com', email: 'superadmin@admin.com', password: 'superadmin12345', role: 'superadmin', name: 'مدير النظام' }
    ];
    for (const a of admins) {
      await supabase.from('dashboard_accounts').upsert({ ...a, status: 'active' }, { onConflict: 'id' });
    }
    await supabase.from('settings').upsert({ key: 'geoBlocking', value: { enabled: true, allowedCountries: ['EG'] } }, { onConflict: 'key' });
    res.json({ ok: true, seeded: admins.length + 1 });
  } catch (e) {
    console.error('setup error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ── Admin auth ──────────────────────────────────────────────

app.post('/api/admin/login', async (req, res) => {
  try {
    const { password } = req.body;
    if (password === ADMIN_PASS) return res.json({ ok: true });
    res.status(401).json({ error: 'wrong password' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Polling endpoint for real-time simulation ───────────────

app.get('/api/fb/poll', async (req, res) => {
  try {
    const p = normPath(req.query.path);
    const val = await rtdbRead(p);
    res.json({ value: val });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Migration: ensure data columns exist ────────────────────
app.post('/api/migrate', async (req, res) => {
  try {
    const { Pool } = require('pg');
    const connStr = process.env.DATABASE_URL || `${SUPABASE_URL.replace('https://', 'postgresql://postgres:' + encodeURIComponent(process.env.SUPABASE_DB_PASS || '') + '@db.')}/postgres`;
    const pool = new Pool({ connectionString: connStr, ssl: { rejectUnauthorized: false } });
    const migrations = [
      `ALTER TABLE dashboard_accounts ADD COLUMN IF NOT EXISTS data jsonb DEFAULT '{}'::jsonb`,
      `ALTER TABLE customer_events DROP CONSTRAINT IF EXISTS customer_events_customer_id_fkey`
    ];
    const results = [];
    for (const sql of migrations) {
      try {
        await pool.query(sql);
        results.push({ sql: sql.substring(0, 60), ok: true });
      } catch (e) {
        results.push({ sql: sql.substring(0, 60), error: e.message });
      }
    }
    await pool.end();
    res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Static files ────────────────────────────────────────────

app.use(express.static(path.join(__dirname), {
  extensions: ['html'],
  index: 'index.html'
}));

app.get('*', (req, res) => {
  const reqPath = req.path;
  if (reqPath.startsWith('/api/')) return res.status(404).json({ error: 'not found' });

  const cleanPath = reqPath.replace(/\/$/, '');
  const candidates = [
    path.join(__dirname, cleanPath + '.html'),
    path.join(__dirname, cleanPath, 'index.html'),
    path.join(__dirname, 'index.html')
  ];
  for (const c of candidates) {
    try {
      if (require('fs').existsSync(c)) return res.sendFile(c);
    } catch {}
  }
  res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

module.exports = app;
