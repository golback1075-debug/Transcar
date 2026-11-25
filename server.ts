import 'dotenv/config';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApiRouter } from './src/server/routes.ts';
import { startBackgroundSchedulers } from './src/server/scheduler.ts';
import { ensureStorageDirectories } from './src/server/storage.ts';

const NO_HMR_VITE_CLIENT_SHIM = `
const sheetsMap = new Map();
const linkSheetsMap = new Map();
if (typeof document !== 'undefined') {
  document.querySelectorAll('style[data-vite-dev-id]').forEach((el) => {
    sheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
  document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
    linkSheetsMap.set(el.getAttribute('data-vite-dev-id'), el);
  });
}
export function updateStyle(id, content) {
  if (linkSheetsMap.has(id) || typeof document === 'undefined') return;
  let style = sheetsMap.get(id);
  if (!style) {
    style = document.createElement('style');
    style.setAttribute('type', 'text/css');
    style.setAttribute('data-vite-dev-id', id);
    style.textContent = content;
    document.head.appendChild(style);
  } else if (style.textContent !== content) {
    style.textContent = content;
  }
  sheetsMap.set(id, style);
}
export function removeStyle(id) {
  if (typeof document === 'undefined') return;
  if (linkSheetsMap.has(id)) {
    document.querySelectorAll('link[rel="stylesheet"][data-vite-dev-id]').forEach((el) => {
      if (el.getAttribute('data-vite-dev-id') === id) el.remove();
    });
    linkSheetsMap.delete(id);
  }
  const style = sheetsMap.get(id);
  if (style && style.parentNode) {
    style.parentNode.removeChild(style);
    sheetsMap.delete(id);
  }
}
export function createHotContext() {
  const noop = () => {};
  return {
    data: {},
    accept: noop,
    acceptExports: noop,
    dispose: noop,
    prune: noop,
    invalidate: noop,
    decline: noop,
    on: noop,
    off: noop,
    send: noop,
  };
}
export function injectQuery(url, queryToInject) {
  if (url[0] !== '.' && url[0] !== '/') return url;
  const pathname = url.replace(/[?#].*$/, '');
  const parsed = new URL(url, 'http://vite.dev');
  return pathname + '?' + queryToInject + (parsed.search ? '&' + parsed.search.slice(1) : '') + (parsed.hash || '');
}
export class ErrorOverlay extends (typeof HTMLElement !== 'undefined' ? HTMLElement : Object) {}
`;

async function startServer() {
  ensureStorageDirectories();

  const app = express();
  const httpServer = http.createServer(app);
  const PORT = Number(process.env.PORT || 3000);
  const disableHmr = process.env.DISABLE_HMR === 'true';

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  const isNoCachePath = (p: string, acceptHeader?: string): boolean =>
    p === '/' ||
    p === '/index.html' ||
    p === '/book' ||
    p.startsWith('/book/') ||
    p.startsWith('/contract/') ||
    p === '/contract' ||
    p === '/version.json' ||
    p === '/sw.js' ||
    p === '/dev-sw.js' ||
    p === '/registerSW.js' ||
    p === '/manifest.webmanifest' ||
    /^\/workbox-[^/]+\.js$/.test(p) ||
    (Boolean(acceptHeader?.includes('text/html')) && !p.startsWith('/api/'));

  const applyStrictNoCache = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.removeHeader('ETag');
  };

  app.use((req, res, next) => {
    const p = req.path || '';
    if (isNoCachePath(p, req.headers.accept)) {
      applyStrictNoCache(res);
      const origWriteHead = res.writeHead.bind(res);
      res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
        applyStrictNoCache(res);
        return origWriteHead(...args);
      }) as typeof res.writeHead;
    }
    next();
  });

  app.use('/api', createApiRouter());

  if (process.env.NODE_ENV !== 'production') {
    // Retire stale production /sw.js registrations cleanly in dev mode instead of serving text/html
    app.get('/sw.js', (_req, res) => {
      applyStrictNoCache(res);
      res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      res.send(
        'self.addEventListener("install",function(){self.skipWaiting()});self.addEventListener("activate",function(e){e.waitUntil(self.registration.unregister())});',
      );
    });

    if (disableHmr) {
      app.get('/@vite/client', (_req, res) => {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.send(NO_HMR_VITE_CLIENT_SHIM);
      });
    }
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: disableHmr ? false : { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          const base = path.basename(filePath);
          if (
            base === 'version.json' ||
            base === 'sw.js' ||
            base === 'registerSW.js' ||
            base === 'index.html' ||
            base === 'manifest.webmanifest' ||
            /^workbox-[^/]+\.js$/.test(base)
          ) {
            applyStrictNoCache(res);
          } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          }
        },
      }),
    );
    app.get('*', (_req, res) => {
      applyStrictNoCache(res);
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`TRANSCAR server listening on http://0.0.0.0:${PORT}`);
    startBackgroundSchedulers();
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
