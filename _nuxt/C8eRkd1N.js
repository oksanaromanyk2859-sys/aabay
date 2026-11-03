// Firebase App bridge — routes to Supabase via REST API
const _apps = new Map();
let _defaultApp = null;

export function initializeApp(config, name) {
  const appName = name || '[DEFAULT]';
  const app = { name: appName, options: config, automaticDataCollectionEnabled: false };
  _apps.set(appName, app);
  if (appName === '[DEFAULT]') _defaultApp = app;
  return app;
}

export function getApp(name) {
  const appName = name || '[DEFAULT]';
  const app = _apps.get(appName);
  if (!app) throw new Error(`No Firebase App '${appName}' has been created`);
  return app;
}

export function getApps() {
  return Array.from(_apps.values());
}

export function deleteApp(app) {
  _apps.delete(app.name);
  if (_defaultApp === app) _defaultApp = null;
  return Promise.resolve();
}

export function onLog() {}
export function setLogLevel() {}
export function registerVersion() {}

export class FirebaseError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'FirebaseError';
  }
}

export const SDK_VERSION = '12.14.0';
export const _DEFAULT_ENTRY_NAME = '[DEFAULT]';
export function _addComponent() {}
export function _addOrOverwriteComponent() {}
export function _clearComponents() {}
export function _getProvider() { return { getImmediate: () => null }; }
export function _isFirebaseApp() { return true; }
export function _isFirebaseServerApp() { return false; }
export function _isFirebaseServerAppSettings() { return false; }
export function _registerComponent() {}
export function _removeServiceInstance() {}
export function initializeServerApp(config) { return initializeApp(config); }
export { _apps };
export const _components = new Map();
export const _serverApps = new Map();
