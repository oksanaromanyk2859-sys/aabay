// Firebase Auth bridge — routes to /api/auth/* REST endpoints

const API = '';

let _currentUser = null;
let _authToken = null;
let _authStateCallbacks = [];
let _authInstance = null;

function notifyAuthState() {
  for (const cb of _authStateCallbacks) {
    try { cb(_currentUser); } catch(e) { console.error('auth state cb error:', e); }
  }
}

export function getAuth(app) {
  if (!_authInstance) {
    _authInstance = {
      app: app || null,
      get currentUser() { return _currentUser; },
      onAuthStateChanged(callback) {
        _authStateCallbacks.push(callback);
        setTimeout(() => callback(_currentUser), 0);
        return () => {
          _authStateCallbacks = _authStateCallbacks.filter(c => c !== callback);
        };
      },
      signOut() { return signOut(_authInstance); }
    };
  }
  return _authInstance;
}

export async function signInWithEmailAndPassword(auth, email, password) {
  const resp = await fetch(API + '/api/auth/signin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.message || 'Auth failed');
    err.code = data.code || 'auth/unknown';
    throw err;
  }
  _authToken = data.token;
  _currentUser = { uid: data.uid, email: data.email, getIdToken: () => Promise.resolve(data.token) };
  try { localStorage.setItem('_auth_token', data.token); localStorage.setItem('_auth_user', JSON.stringify(_currentUser)); } catch(e) {}
  notifyAuthState();
  return { user: _currentUser };
}

export async function createUserWithEmailAndPassword(auth, email, password) {
  const resp = await fetch(API + '/api/auth/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  const data = await resp.json();
  if (!resp.ok) {
    const err = new Error(data.message || 'Create failed');
    err.code = data.code || 'auth/unknown';
    throw err;
  }
  _authToken = data.token;
  _currentUser = { uid: data.uid, email: data.email, getIdToken: () => Promise.resolve(data.token) };
  try { localStorage.setItem('_auth_token', data.token); localStorage.setItem('_auth_user', JSON.stringify(_currentUser)); } catch(e) {}
  notifyAuthState();
  return { user: _currentUser };
}

export async function signOut(auth) {
  const token = _authToken;
  _currentUser = null;
  _authToken = null;
  try { localStorage.removeItem('_auth_token'); localStorage.removeItem('_auth_user'); } catch(e) {}
  notifyAuthState();
  if (token) {
    await fetch(API + '/api/auth/signout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    }).catch(() => {});
  }
}

export function onAuthStateChanged(auth, callback) {
  return auth.onAuthStateChanged(callback);
}

export async function authStateReady() {
  try {
    const saved = localStorage.getItem('_auth_user');
    const token = localStorage.getItem('_auth_token');
    if (saved && token) {
      _currentUser = JSON.parse(saved);
      _currentUser.getIdToken = () => Promise.resolve(token);
      _authToken = token;
    }
  } catch(e) {}
  return Promise.resolve();
}

export async function updatePassword(user, newPassword) {
  return Promise.resolve();
}

export function onIdTokenChanged(auth, callback) {
  return auth.onAuthStateChanged(callback);
}

export async function deleteUser(user) {
  return Promise.resolve();
}

export function connectAuthEmulator() {}
export function setPersistence() { return Promise.resolve(); }
export function browserLocalPersistence() { return {}; }
export function browserSessionPersistence() { return {}; }
export function inMemoryPersistence() { return {}; }
