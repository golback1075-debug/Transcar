const OFFLINE_AUTH_KEY = 'transcar_offline_auth_v1';
const PBKDF2_ITERATIONS = 100_000;

export interface StoredOfflineCredential {
  role: 'manager' | 'employee';
  email: string;
  saltHex: string;
  hashHex: string;
  alg: 'pbkdf2' | 'sha256-iter';
  iterations: number;
  updatedAt: string;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Pure-TS SHA-256 fallback only for insecure non-HTTPS LAN origins where crypto.subtle is unavailable
function sha256Fallback(data: Uint8Array): Uint8Array {
  const K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const bitLen = data.length * 8;
  const paddedLen = Math.ceil((data.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(data);
  buf[data.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outView = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outView.setUint32(i * 4, H[i], false);
  return out;
}

async function deriveVerifier(
  password: string,
  salt: Uint8Array,
  alg: 'pbkdf2' | 'sha256-iter',
  iterations: number,
): Promise<string> {
  const enc = new TextEncoder();
  if (alg === 'pbkdf2' && typeof crypto !== 'undefined' && crypto.subtle) {
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      enc.encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
      keyMaterial,
      256,
    );
    return bytesToHex(new Uint8Array(bits));
  }

  // Fallback iterative salted SHA-256
  const passBytes = enc.encode(password);
  let state = new Uint8Array(salt.length + passBytes.length);
  state.set(salt);
  state.set(passBytes, salt.length);
  let digest = sha256Fallback(state);
  const rounds = Math.min(iterations, 5_000);
  for (let i = 1; i < rounds; i++) {
    const next = new Uint8Array(digest.length + salt.length);
    next.set(digest);
    next.set(salt, digest.length);
    digest = sha256Fallback(next);
  }
  return bytesToHex(digest);
}

function generateSalt(): Uint8Array {
  const salt = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(salt);
  } else {
    for (let i = 0; i < salt.length; i++) salt[i] = Math.floor(Math.random() * 256);
  }
  return salt;
}

export function loadStoredOfflineCredentials(): StoredOfflineCredential[] {
  try {
    const raw = localStorage.getItem(OFFLINE_AUTH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function hasOfflineCredentials(): boolean {
  return loadStoredOfflineCredentials().length > 0;
}

export async function saveOfflineCredential(
  password: string,
  role: 'manager' | 'employee',
  email: string,
): Promise<void> {
  const trimmed = password.trim();
  if (!trimmed) return;

  const salt = generateSalt();
  const usePbkdf2 = typeof crypto !== 'undefined' && Boolean(crypto.subtle);
  const alg: 'pbkdf2' | 'sha256-iter' = usePbkdf2 ? 'pbkdf2' : 'sha256-iter';
  const iterations = usePbkdf2 ? PBKDF2_ITERATIONS : 5_000;
  const hashHex = await deriveVerifier(trimmed, salt, alg, iterations);

  const existing = loadStoredOfflineCredentials().filter((c) => c.role !== role);
  existing.push({
    role,
    email,
    saltHex: bytesToHex(salt),
    hashHex,
    alg,
    iterations,
    updatedAt: new Date().toISOString(),
  });

  try {
    localStorage.setItem(OFFLINE_AUTH_KEY, JSON.stringify(existing));
  } catch {
    // ignore storage quota errors
  }
}

export async function verifyOfflineCredential(
  password: string,
): Promise<{ role: 'manager' | 'employee'; email: string } | null> {
  const trimmed = password.trim();
  if (!trimmed) return null;

  const creds = loadStoredOfflineCredentials();
  for (const cred of creds) {
    const salt = hexToBytes(cred.saltHex);
    const derived = await deriveVerifier(trimmed, salt, cred.alg, cred.iterations);
    if (constantTimeEqualHex(derived, cred.hashHex)) {
      return { role: cred.role, email: cred.email };
    }
  }
  return null;
}

export function clearOfflineCredentials(): void {
  try {
    localStorage.removeItem(OFFLINE_AUTH_KEY);
  } catch {
    // ignore
  }
}
