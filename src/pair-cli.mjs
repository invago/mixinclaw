import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const { getPendingPairing, completePairing, listPendingPairings } = await import('./pairing-store.js');

function getStorageDir() {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, '.openclaw', 'channels', 'mixin');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJSON(filename, defaultValue) {
  try {
    const dir = getStorageDir();
    ensureDir(dir);
    const filepath = path.join(dir, filename);
    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content);
    }
  } catch (e) {
    return defaultValue;
  }
  return defaultValue;
}

function saveJSON(filename, data) {
  try {
    const dir = getStorageDir();
    ensureDir(dir);
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[mixin] Failed to save ' + filename + ':', err);
  }
}

const PENDING_PAIRINGS_FILE = 'mixin-pending-pairings.json';

function getPendingPairings() {
  const data = loadJSON(PENDING_PAIRINGS_FILE, []);
  return new Map(data.map(function(p) {return [p.code, p];}));
}

function savePendingPairings(map) {
  const data = Array.from(map.values());
  saveJSON(PENDING_PAIRINGS_FILE, data);
}

// CLI commands
function approvePairing(code) {
  const pairing = getPendingPairing(code);
  if (!pairing) {
    console.log('❌ Invalid or expired pairing code: ' + code);
    process.exit(1);
  }
  const completed = completePairing(code);
  if (completed) {
    console.log('✅ Pairing approved for user: ' + completed.userId);
    console.log('Config: ' + completed.configKey);
  }
}

function listPending() {
  const pairings = getPendingPairings();
  if (pairings.size === 0) {
    console.log('No pending pairings.');
    return;
  }
  console.log('Pending pairings:');
  pairings.forEach(function(p) {
    const time = (Date.now() - p.timestamp) / 1000;
    console.log('  ' + p.code + ' - ' + p.userId + ' (' + p.configKey + ') ' + Math.round(time) + 's ago');
  });
}

function help() {
  console.log('Mixin Pairing CLI');
  console.log('');
  console.log('Usage:');
  console.log('  node src/pair-cli.mjs <code>     - Approve a pairing code');
  console.log('  node src/pair-cli.mjs list       - List pending pairings');
  console.log('  node src/pair-cli.mjs help       - Show this help');
}

const args = process.argv.slice(2);
if (args.length === 0) {
  help();
} else if (args[0] === 'list') {
  listPending();
} else if (args[0] === 'help' || args[0] === '--help' || args[0] === '-h') {
  help();
} else {
  approvePairing(args[0]);
}
