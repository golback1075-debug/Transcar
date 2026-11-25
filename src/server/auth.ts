import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json' with { type: 'json' };
import { db } from '../db/index.ts';
import { auditLogs } from '../db/schema.ts';

if (getApps().length === 0) {
  initializeApp({ projectId: firebaseConfig.projectId });
}

let runtimeSessionSecret = process.env.SESSION_SECRET || '';

export function setSessionSecret(secret: string) {
  if (secret && !process.env.SESSION_SECRET) {
    runtimeSessionSecret = secret;
  }
}

function getSessionSecret(): string {
  if (!runtimeSessionSecret) {
    runtimeSessionSecret =
      process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
  }
  return runtimeSessionSecret;
}

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type AgencyRole = 'manager' | 'employee';

export interface AuthContext {
  role: AgencyRole;
  uid: string;
  email: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export function signSessionToken(payload: AuthContext): string {
  const data = {
    ...payload,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token: string): AuthContext | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as AuthContext & {
      exp: number;
    };
    if (!parsed.exp || Date.now() > parsed.exp) return null;
    if (parsed.role !== 'manager' && parsed.role !== 'employee') return null;
    return {
      role: parsed.role,
      uid: parsed.uid || `agency-${parsed.role}`,
      email: parsed.email || `${parsed.role}@transcar.dz`,
    };
  } catch {
    return null;
  }
}

const CONTRACT_QR_SIG_BYTES = 16;

function computeContractAccessSig(contractId: number, contractNumber: string): string {
  const payload = `contract-access:v1:${contractId}:${contractNumber.trim()}`;
  return crypto
    .createHmac('sha256', getSessionSecret())
    .update(payload)
    .digest()
    .subarray(0, CONTRACT_QR_SIG_BYTES)
    .toString('base64url');
}

export function signContractAccessToken(contractId: number, contractNumber: string): string {
  if (!Number.isInteger(contractId) || contractId <= 0 || !contractNumber.trim()) return '';
  const sig = computeContractAccessSig(contractId, contractNumber);
  return `${contractId}.${sig}`;
}

export function parseContractAccessToken(
  token: string,
): { contractId: number; sig: string } | null {
  const trimmed = String(token || '').trim();
  const dotIdx = trimmed.indexOf('.');
  if (dotIdx <= 0) return null;
  const idPart = trimmed.slice(0, dotIdx);
  const sigPart = trimmed.slice(dotIdx + 1);
  if (!/^\d+$/.test(idPart) || !/^[A-Za-z0-9_-]{16,64}$/.test(sigPart)) return null;
  const contractId = Number(idPart);
  if (!Number.isSafeInteger(contractId) || contractId <= 0) return null;
  return { contractId, sig: sigPart };
}

export function verifyContractAccessToken(
  token: string,
  expectedContract: { id: number; contractNumber: string },
): boolean {
  const parsed = parseContractAccessToken(token);
  if (!parsed || parsed.contractId !== expectedContract.id) return false;
  const expectedSig = computeContractAccessSig(
    expectedContract.id,
    expectedContract.contractNumber,
  );
  const sigBuf = Buffer.from(parsed.sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
}

export async function verifyFirebaseToken(idToken: string) {
  return getAuth().verifyIdToken(idToken);
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
  const bearerToken = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : queryToken;

  if (!bearerToken) {
    res.status(401).json({ error: 'Authentification requise' });
    return;
  }

  const agencyCtx = verifySessionToken(bearerToken);
  if (agencyCtx) {
    req.auth = agencyCtx;
    next();
    return;
  }

  try {
    const decoded = await verifyFirebaseToken(bearerToken);
    req.auth = {
      role: 'employee',
      uid: decoded.uid,
      email: decoded.email || '',
    };
    next();
  } catch {
    res.status(401).json({ error: 'Session expirée ou invalide' });
  }
}

export function requireManager(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    res.status(401).json({ error: 'Authentification requise' });
    return;
  }
  if (req.auth.role !== 'manager') {
    res.status(403).json({ error: 'Accès strictement réservé au Gérant' });
    return;
  }
  next();
}

export async function logAudit(
  actor: AuthContext | undefined,
  action: string,
  entityType: string,
  entityId: string | number,
  details: Record<string, unknown> = {},
) {
  try {
    await db.insert(auditLogs).values({
      actorRole: actor?.role || 'system',
      actorUid: actor?.uid || 'system',
      action,
      entityType,
      entityId: String(entityId),
      detailsJson: details,
    });
  } catch {
    // audit logging should never break primary write after commit
  }
}
