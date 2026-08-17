/**
 * localStorage adapter.
 *
 * The mobile app persists to SQLite; on the web the equivalent local-first
 * store is localStorage. Every read is defensive: a corrupted or hand-edited
 * value must degrade to the fallback rather than break the app on boot.
 */

const NAMESPACE = "firepath.v2";

export const STORAGE_KEYS = {
  profile: `${NAMESPACE}.profile`,
  holdings: `${NAMESPACE}.holdings`,
  transactions: `${NAMESPACE}.transactions`,
  scenarios: `${NAMESPACE}.scenarios`,
  articles: `${NAMESPACE}.articles`,
  meta: `${NAMESPACE}.meta`
};

/** Legacy keys written by the first web version, migrated once on boot. */
const LEGACY_KEYS = {
  inputs: "firepath-web-state-v1",
  holdings: "firepath-web-holdings-v1"
};

let memoryFallback = null;

/**
 * Private browsing and blocked-storage modes throw on access rather than
 * returning null, so the app keeps a memory map and stays usable for the
 * session instead of failing to start.
 */
function getBackend() {
  if (memoryFallback) {
    return memoryFallback;
  }

  try {
    const probe = `${NAMESPACE}.probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    memoryFallback = createMemoryStorage();
    return memoryFallback;
  }
}

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key)
  };
}

export function isPersistent() {
  getBackend();
  return memoryFallback === null;
}

export function readJson(key, fallback) {
  try {
    const raw = getBackend().getItem(key);
    if (raw === null) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

export function writeJson(key, value) {
  try {
    getBackend().setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Quota exhaustion is the realistic failure here. Report it so callers can
    // tell the user their change was not saved instead of pretending it was.
    return false;
  }
}

export function removeKey(key) {
  try {
    getBackend().removeItem(key);
  } catch {
    /* nothing useful to do if removal fails */
  }
}

export function readMeta(flag) {
  const meta = readJson(STORAGE_KEYS.meta, {});
  return Boolean(meta[flag]);
}

export function writeMeta(flag, value) {
  const meta = readJson(STORAGE_KEYS.meta, {});
  meta[flag] = value;
  writeJson(STORAGE_KEYS.meta, meta);
}

/**
 * Reads whatever the previous single-page version stored so an existing visitor
 * keeps their numbers. Returns null when there is nothing to migrate.
 *
 * The old shape was a flat map of input-element ids to strings plus a simple
 * holdings list of `{ id, name, value, invested }`.
 */
export function readLegacyData() {
  const inputs = readJson(LEGACY_KEYS.inputs, null);
  const holdings = readJson(LEGACY_KEYS.holdings, null);

  if (!inputs && !holdings) {
    return null;
  }

  return { inputs: inputs ?? {}, holdings: Array.isArray(holdings) ? holdings : [] };
}

export function clearLegacyData() {
  removeKey(LEGACY_KEYS.inputs);
  removeKey(LEGACY_KEYS.holdings);
}

export function nowISO() {
  return new Date().toISOString();
}

/** Monotonic-enough ids for locally stored rows. */
export function nextId(rows) {
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1;
}
