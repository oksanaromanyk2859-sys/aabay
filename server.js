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
const BUCKET = 'rtdb';

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const storage = supabase.storage.from(BUCKET);

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

function expandSlashKeys(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (key.includes('/')) {
      const parts = key.split('/');
      let cur = out;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = val;
    } else {
      out[key] = val;
    }
  }
  return out;
}

function getNestedValue(obj, pathParts) {
  let cur = obj;
  for (const p of pathParts) {
    if (cur == null || typeof cur !== 'object') return null;
    cur = cur[p];
  }
  return cur ?? null;
}

function genKey() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(20);
  let key = '-';
  for (let i = 0; i < 19; i++) key += chars[bytes[i] % chars.length];
  return key;
}

function filePath(rtdbPath) {
  return rtdbPath + '.json';
}

async function readFile(fp) {
  const { data, error } = await storage.download(fp);
  if (error || !data) return null;
  const text = await data.text();
  try { return JSON.parse(text); } catch { return null; }
}

async function writeFile(fp, value) {
  const blob = new Blob([JSON.stringify(value)], { type: 'application/json' });
  const { error } = await storage.upload(fp, blob, { upsert: true, contentType: 'application/json' });
  if (error) throw error;
}

async function deleteFile(fp) {
  await storage.remove([fp]);
}

async function listFolder(folder) {
  const { data, error } = await storage.list(folder || '', { limit: 1000 });
  if (error || !data) return [];
  return data;
}

async function rtdbRead(rawPath) {
  const p = normPath(rawPath);
  if (!p) {
    const topFolders = await listFolder('');
    if (!topFolders.length) return null;
    const tree = {};
    for (const item of topFolders) {
      if (item.id === null) {
        const children = await listFolder(item.name);
        if (children.length) {
          tree[item.name] = {};
          for (const child of children) {
            if (child.name.endsWith('.json')) {
              const key = child.name.replace('.json', '');
              tree[item.name][key] = await readFile(item.name + '/' + child.name);
            }
          }
        }
      } else if (item.name.endsWith('.json')) {
        const key = item.name.replace('.json', '');
        tree[key] = await readFile(item.name);
      }
    }
    return Object.keys(tree).length ? tree : null;
  }

  const parts = p.split('/');

  if (parts.length >= 2) {
    const rootPath = parts.slice(0, 2).join('/');
    const fp = filePath(rootPath);
    const val = await readFile(fp);
    if (val !== null) {
      const rest = parts.slice(2);
      if (rest.length > 0) return getNestedValue(val, rest);
      return val;
    }
  }

  if (parts.length === 1) {
    const children = await listFolder(parts[0]);
    if (children && children.length) {
      const result = {};
      for (const child of children) {
        if (child.name.endsWith('.json')) {
          const key = child.name.replace('.json', '');
          result[key] = await readFile(parts[0] + '/' + child.name);
        }
      }
      return Object.keys(result).length ? result : null;
    }
  }

  return null;
}

async function rtdbSet(rawPath, value) {
  const p = normPath(rawPath);
  if (!p) return;
  const parts = p.split('/');

  if (parts.length <= 2) {
    await writeFile(filePath(p), value);
    return;
  }

  const rootPath = parts.slice(0, 2).join('/');
  const fp = filePath(rootPath);
  const nestedKeys = parts.slice(2);
  let obj = await readFile(fp) || {};

  let cur = obj;
  for (let i = 0; i < nestedKeys.length - 1; i++) {
    if (!cur[nestedKeys[i]] || typeof cur[nestedKeys[i]] !== 'object') cur[nestedKeys[i]] = {};
    cur = cur[nestedKeys[i]];
  }
  cur[nestedKeys[nestedKeys.length - 1]] = value;

  await writeFile(fp, obj);
}

async function rtdbUpdate(rawPath, updates) {
  const p = normPath(rawPath);
  if (!p || !updates) return;
  const parts = p.split('/');

  const rootPath = parts.length >= 2 ? parts.slice(0, 2).join('/') : p;
  const nestedPrefix = parts.length > 2 ? parts.slice(2) : [];
  const fp = filePath(rootPath);

  let obj = await readFile(fp) || {};

  let target = obj;
  for (const k of nestedPrefix) {
    if (!target[k] || typeof target[k] !== 'object') target[k] = {};
    target = target[k];
  }

  const expanded = expandSlashKeys(updates);
  const merged = deepMerge(target, expanded);

  if (nestedPrefix.length === 0) {
    obj = merged;
  } else {
    let cur = obj;
    for (let i = 0; i < nestedPrefix.length - 1; i++) {
      cur = cur[nestedPrefix[i]];
    }
    cur[nestedPrefix[nestedPrefix.length - 1]] = merged;
  }

  await writeFile(fp, obj);
}

async function rtdbPush(rawPath, value) {
  const p = normPath(rawPath);
  const key = genKey();
  const parts = p.split('/');

  if (parts.length === 1) {
    await writeFile(filePath(`${p}/${key}`), value);
    return key;
  }

  const rootPath = parts.slice(0, 2).join('/');
  const fp = filePath(rootPath);
  const nestedKeys = [...parts.slice(2), key];
  let obj = await readFile(fp) || {};

  let cur = obj;
  for (let i = 0; i < nestedKeys.length - 1; i++) {
    if (!cur[nestedKeys[i]] || typeof cur[nestedKeys[i]] !== 'object') cur[nestedKeys[i]] = {};
    cur = cur[nestedKeys[i]];
  }
  cur[nestedKeys[nestedKeys.length - 1]] = value;

  await writeFile(fp, obj);
  return key;
}

async function rtdbRemove(rawPath) {
  const p = normPath(rawPath);
  if (!p) return;
  const parts = p.split('/');

  if (parts.length <= 2) {
    await deleteFile(filePath(p));
    return;
  }

  const rootPath = parts.slice(0, 2).join('/');
  const fp = filePath(rootPath);
  const nestedKeys = parts.slice(2);
  let obj = await readFile(fp);
  if (!obj) return;

  obj = JSON.parse(JSON.stringify(obj));
  let cur = obj;
  for (let i = 0; i < nestedKeys.length - 1; i++) {
    if (!cur[nestedKeys[i]]) return;
    cur = cur[nestedKeys[i]];
  }
  delete cur[nestedKeys[nestedKeys.length - 1]];

  await writeFile(fp, obj);
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
    const key = email.trim().toLowerCase().replace(/\./g, ',');
    let row = await rtdbRead(`dashboardAccounts/${key}`);
    if (!row) row = await rtdbRead(`dashboardUsers/${key}`);

    if (!row) return res.status(401).json({ code: 'auth/user-not-found', message: 'User not found' });
    if (row.status === 'inactive') return res.status(401).json({ code: 'auth/user-disabled', message: 'Account disabled' });
    if (row.password !== password) return res.status(401).json({ code: 'auth/wrong-password', message: 'Wrong password' });

    const uid = key;
    const token = crypto.randomBytes(32).toString('hex');
    authTokens.set(token, { uid, email: email.trim().toLowerCase() });
    res.json({ uid, email: email.trim().toLowerCase(), token });
  } catch (e) {
    console.error('auth/signin error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/create', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'missing fields' });
    const key = email.trim().toLowerCase().replace(/\./g, ',');
    let existing = await rtdbRead(`dashboardAccounts/${key}`);
    if (!existing) existing = await rtdbRead(`dashboardUsers/${key}`);

    if (existing) {
      if (existing.password !== password) {
        await rtdbUpdate(`dashboardAccounts/${key}`, { password });
      }
      const token = crypto.randomBytes(32).toString('hex');
      authTokens.set(token, { uid: key, email: email.trim().toLowerCase() });
      return res.json({ uid: key, email: email.trim().toLowerCase(), token, existing: true });
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
    const val = await rtdbRead(`settings/${req.params.key}`);
    res.json(val || null);
  } catch (e) {
    res.json(null);
  }
});

// ── Init endpoint (creates bucket + seeds) ─────────────────

app.post('/api/init', async (req, res) => {
  try {
    const { data: buckets } = await supabase.storage.listBuckets();
    const exists = buckets && buckets.some(b => b.name === BUCKET);
    if (!exists) {
      const { error } = await supabase.storage.createBucket(BUCKET, { public: false });
      if (error && !error.message.includes('already exists')) throw error;
    }

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
      await rtdbSet(s.path, s.value);
    }
    res.json({ ok: true, bucket: BUCKET, seeded: seeds.length });
  } catch (e) {
    console.error('init error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/setup', async (req, res) => {
  try {
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
      await rtdbSet(s.path, s.value);
    }
    res.json({ ok: true, seeded: seeds.length });
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
    path.join(__dirname, cleanPath + '/index.html')
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
