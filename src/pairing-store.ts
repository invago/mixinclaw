import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const PENDING_PAIRINGS_FILE = 'mixin-pending-pairings.json';
const PAIRED_USERS_FILE = 'mixin-paired-users.json';

function getStorageDir(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '.';
  return path.join(home, '.openclaw', 'channels', 'mixin');
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadJSON<T>(filename: string, defaultValue: T): T {
  try {
    const dir = getStorageDir();
    ensureDir(dir);
    const filepath = path.join(dir, filename);
    if (fs.existsSync(filepath)) {
      const content = fs.readFileSync(filepath, 'utf-8');
      return JSON.parse(content);
    }
  } catch {
    // ignore
  }
  return defaultValue;
}

function saveJSON<T>(filename: string, data: T): void {
  try {
    const dir = getStorageDir();
    ensureDir(dir);
    const filepath = path.join(dir, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[mixin] Failed to save ' + filename + ':', err);
  }
}

export interface PendingPairing {
  userId: string;
  code: string;
  timestamp: number;
  configKey: string;
}

export interface PairedUser {
  userId: string;
  code: string;
  timestamp: number;
  configKey: string;
}

// Load storage
function getPendingPairings(): Map<string, PendingPairing> {
  const data = loadJSON<PendingPairing[]>(PENDING_PAIRINGS_FILE, []);
  return new Map(data.map(function(p) {return [p.code, p];}));
}

function savePendingPairings(map: Map<string, PendingPairing>): void {
  const data = Array.from(map.values());
  saveJSON(PENDING_PAIRINGS_FILE, data);
}

function getPairedUsers(): Map<string, PairedUser> {
  const data = loadJSON<PairedUser[]>(PAIRED_USERS_FILE, []);
  return new Map(data.map(function(p) {return [p.userId, p];}));
}

function savePairedUsers(map: Map<string, PairedUser>): void {
  const data = Array.from(map.values());
  saveJSON(PAIRED_USERS_FILE, data);
}

// Generate code
export function generatePairingCode(): string {
  return crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 6);
}

// Add pending pairing (returns code)
export function addPendingPairing(userId: string, configKey: string): string {
  const code = generatePairingCode();
  const pairing = {
    userId,
    code,
    timestamp: Date.now(),
    configKey,
  };

  const pairings = getPendingPairings();
  pairings.set(code, pairing);
  savePendingPairings(pairings);

  // Auto cleanup after 30 minutes
  setTimeout(function() {
    const p = getPendingPairings();
    if (p.has(code)) {
      p.delete(code);
      savePendingPairings(p);
    }
  }, 30 * 60 * 1000);

  return code;
}

// Get pending pairing by code
export function getPendingPairing(code: string): PendingPairing | null {
  const pairings = getPendingPairings();
  const pairing = pairings.get(code);
  if (!pairing) return null;

  // Check expiry (30 minutes)
  if (Date.now() - pairing.timestamp > 30 * 60 * 1000) {
    pairings.delete(code);
    savePendingPairings(pairings);
    return null;
  }

  return pairing;
}

// Complete pairing (removes from pending, adds to paired)
export function completePairing(code: string): PendingPairing | null {
  const pairings = getPendingPairings();
  const pairing = pairings.get(code);
  if (!pairing) return null;

  pairings.delete(code);
  savePendingPairings(pairings);

  // Add to paired users
  const paired = getPairedUsers();
  paired.set(pairing.userId, {
    userId: pairing.userId,
    code: pairing.code,
    timestamp: Date.now(),
    configKey: pairing.configKey,
  });
  savePairedUsers(paired);

  return pairing;
}

// Check if user is paired
export function isPaired(userId: string, configKey: string): boolean {
  const paired = getPairedUsers();
  const user = paired.get(userId);
  if (!user) return false;
  return user.configKey === configKey;
}

// Get paired user info
export function getPairedUser(userId: string): PairedUser | null {
  const paired = getPairedUsers();
  return paired.get(userId) || null;
}

// List pending pairings for a config
export function listPendingPairings(configKey: string): PendingPairing[] {
  const pairings = getPendingPairings();
  return Array.from(pairings.values()).filter(function(p) {return p.configKey === configKey;});
}

// List all paired users
export function listPairedUsers(configKey: string): PairedUser[] {
  const paired = getPairedUsers();
  return Array.from(paired.values()).filter(function(p) {return p.configKey === configKey;});
}

// Remove from pending (for admin commands)
export function removePendingPairing(code: string): boolean {
  const pairings = getPendingPairings();
  if (pairings.has(code)) {
    pairings.delete(code);
    savePendingPairings(pairings);
    return true;
  }
  return false;
}
