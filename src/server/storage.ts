import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const STORAGE_ROOT = path.resolve(process.cwd(), 'storage');
export const UPLOADS_ROOT = path.resolve(STORAGE_ROOT, 'uploads');
export const VEHICLES_UPLOAD_DIR = path.resolve(UPLOADS_ROOT, 'vehicles');
export const DOCUMENTS_UPLOAD_DIR = path.resolve(UPLOADS_ROOT, 'documents');
export const LICENCES_UPLOAD_DIR = path.resolve(UPLOADS_ROOT, 'licences');
export const BACKUPS_DIR = path.resolve(STORAGE_ROOT, 'backups');

export function ensureStorageDirectories() {
  for (const dir of [
    STORAGE_ROOT,
    UPLOADS_ROOT,
    VEHICLES_UPLOAD_DIR,
    DOCUMENTS_UPLOAD_DIR,
    LICENCES_UPLOAD_DIR,
    BACKUPS_DIR,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export const ALLOWED_IMAGE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/jpg',
  'image/pjpeg',
  'image/x-png',
  'image/webp',
]);
export const ALLOWED_DOC_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/jpg',
  'image/pjpeg',
  'image/x-png',
  'image/webp',
  'application/pdf',
]);

export function isAllowedImageFile(file: { mimetype?: string; originalname?: string }): boolean {
  const mime = (file.mimetype || '').toLowerCase().trim();
  if (ALLOWED_IMAGE_MIMES.has(mime)) return true;
  if (!mime || mime === 'application/octet-stream') {
    const ext = path.extname(file.originalname || '').toLowerCase();
    return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp';
  }
  return false;
}

export function isAllowedDocFile(file: { mimetype?: string; originalname?: string }): boolean {
  const mime = (file.mimetype || '').toLowerCase().trim();
  if (ALLOWED_DOC_MIMES.has(mime)) return true;
  if (!mime || mime === 'application/octet-stream') {
    const ext = path.extname(file.originalname || '').toLowerCase();
    return ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.pdf';
  }
  return false;
}

export function sanitizeExtension(originalName: string, mimeType: string): string {
  const ext = path.extname(originalName).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg' || ext === '.png' || ext === '.webp' || ext === '.pdf') {
    return ext;
  }
  const mime = (mimeType || '').toLowerCase();
  if (mime === 'application/pdf') return '.pdf';
  if (mime === 'image/png' || mime === 'image/x-png') return '.png';
  if (mime === 'image/webp') return '.webp';
  return '.jpg';
}

export function saveUploadedFile(
  category: 'vehicles' | 'documents' | 'licences',
  buffer: Buffer,
  originalName: string,
  mimeType: string,
): string {
  ensureStorageDirectories();
  const baseDir =
    category === 'vehicles'
      ? VEHICLES_UPLOAD_DIR
      : category === 'documents'
        ? DOCUMENTS_UPLOAD_DIR
        : LICENCES_UPLOAD_DIR;

  const ext = sanitizeExtension(originalName, mimeType);
  const filename = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`;
  const targetPath = path.resolve(baseDir, filename);

  if (!targetPath.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid storage path');
  }

  fs.writeFileSync(targetPath, buffer);
  return `${category}/${filename}`;
}

export function resolveStoredFile(relativePath: string): { absPath: string; mimeType: string } | null {
  if (!relativePath || relativePath.includes('..')) return null;
  const resolved = path.resolve(UPLOADS_ROOT, relativePath);
  if (!resolved.startsWith(UPLOADS_ROOT + path.sep)) {
    return null;
  }
  if (!fs.existsSync(resolved)) return null;
  const ext = path.extname(resolved).toLowerCase();
  const mimeType =
    ext === '.pdf'
      ? 'application/pdf'
      : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : 'image/jpeg';
  return { absPath: resolved, mimeType };
}

export function deleteStoredFile(relativePath: string | null | undefined) {
  if (!relativePath) return;
  const resolved = resolveStoredFile(relativePath);
  if (resolved) {
    try {
      fs.unlinkSync(resolved.absPath);
    } catch {
      // ignore missing file cleanup
    }
  }
}
