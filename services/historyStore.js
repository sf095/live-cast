/**
 * History Store
 *
 * Async file-based CRUD store for stream presets with:
 * - Locking to prevent race conditions on concurrent writes
 * - UUID-based IDs for collision-free generation
 * - In-memory cache with write-through
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HISTORY_FILE = path.join(__dirname, '..', 'data', 'history.json');

// Ensure data directory and file exist
if (!fs.existsSync(path.dirname(HISTORY_FILE))) {
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
}
if (!fs.existsSync(HISTORY_FILE)) {
  fs.writeFileSync(HISTORY_FILE, '[]', 'utf8');
}

// File permissions: owner-only read/write (protects secrets in headers/URLs)
try {
  fs.chmodSync(HISTORY_FILE, 0o600);
} catch (e) {
  // chmod may not work on all filesystems; non-fatal
}

// In-memory cache
let cache = null;
let cacheLoaded = false;

// Write lock: simple promise-based mutex
let writeQueue = Promise.resolve();

function acquireLock(fn) {
  const task = writeQueue.then(fn, fn);
  writeQueue = task.catch(() => {});
  return task;
}

/**
 * Load history from disk into cache.
 */
async function loadCache() {
  if (cacheLoaded) return;
  try {
    const data = await fs.promises.readFile(HISTORY_FILE, 'utf8');
    cache = JSON.parse(data);
  } catch (e) {
    cache = [];
  }
  cacheLoaded = true;
}

/**
 * Persist cache to disk under lock.
 */
async function persist() {
  return acquireLock(async () => {
    const data = JSON.stringify(cache, null, 2);
    await fs.promises.writeFile(HISTORY_FILE, data, 'utf8');
  });
}

/**
 * Generate a unique ID.
 */
function generateId() {
  return crypto.randomUUID();
}

/**
 * Get all history items.
 */
async function getAll() {
  await loadCache();
  return [...cache];
}

/**
 * Add a new history item.
 */
async function add({ name, url, headers }) {
  await loadCache();
  const item = {
    id: generateId(),
    name,
    url,
    headers: headers || {},
    createdAt: new Date().toISOString(),
  };
  cache.push(item);
  await persist();
  return item;
}

/**
 * Update an existing history item by ID.
 */
async function update(id, { name, url, headers }) {
  await loadCache();
  const index = cache.findIndex((item) => item.id === id);
  if (index === -1) return null;

  cache[index] = {
    ...cache[index],
    name: name || cache[index].name,
    url: url || cache[index].url,
    headers: headers || cache[index].headers,
    updatedAt: new Date().toISOString(),
  };

  await persist();
  return cache[index];
}

/**
 * Delete a history item by ID.
 */
async function remove(id) {
  await loadCache();
  const initialLength = cache.length;
  cache = cache.filter((item) => item.id !== id);

  if (cache.length === initialLength) return false;

  await persist();
  return true;
}

module.exports = { getAll, add, update, remove };
