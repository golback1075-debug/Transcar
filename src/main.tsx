import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { initPWAInstallCapture } from './hooks/usePWAInstall.ts';
import { initGlobalPrintFit } from './lib/printFit.ts';
import { initPwaUpdater } from './lib/pwaUpdater.ts';

initPWAInstallCapture();
initPwaUpdater();
initGlobalPrintFit();

createRoot(document.getElementById('root')!).render(<App />);
