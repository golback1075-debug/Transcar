// Precise A4 Portrait (210mm x 297mm) single-page CSS density optimizer
// Uses CSS typography & spacing tiers (never image/zoom scaling) so text stays full-width, crisp, and selectable.

export const A4_PRINTABLE_HEIGHT_PX = 1074; // ~284mm inside 210mm x 297mm A4 with 5mm margins at 96dpi
export type PrintDensityTier = 'spacious' | 'standard' | 'compact' | 'dense' | 'ultra';

const CONTRACT_TIERS: PrintDensityTier[] = ['standard', 'compact', 'dense', 'ultra'];
const CONDITIONS_TIERS: PrintDensityTier[] = ['spacious', 'standard', 'compact', 'dense', 'ultra'];

let printListenersBound = false;

export function clearSinglePagePrintFit(): void {
  if (typeof document === 'undefined') return;
  const sheets = document.querySelectorAll<HTMLElement>('.print-only-sheet');
  sheets.forEach((sheet) => {
    sheet.classList.remove('print-measure-a4');
    sheet.removeAttribute('data-print-density');
  });
}

export function selectOptimalPrintDensity(sheet: HTMLElement): PrintDensityTier {
  const isConditions = sheet.classList.contains('print-conditions-sheet');
  const tiers = isConditions ? CONDITIONS_TIERS : CONTRACT_TIERS;

  sheet.classList.add('print-measure-a4');
  let chosen: PrintDensityTier = tiers[tiers.length - 1];

  for (const tier of tiers) {
    sheet.setAttribute('data-print-density', tier);
    const naturalHeight = Math.max(sheet.scrollHeight, sheet.getBoundingClientRect().height);
    if (naturalHeight <= A4_PRINTABLE_HEIGHT_PX) {
      chosen = tier;
      break;
    }
  }

  sheet.classList.remove('print-measure-a4');
  sheet.setAttribute('data-print-density', chosen);
  return chosen;
}

export function applySinglePagePrintFit(target?: HTMLElement | null): PrintDensityTier | null {
  if (typeof document === 'undefined') return null;
  const sheet =
    target || document.querySelector<HTMLElement>('.print-only-sheet');
  if (!sheet) return null;

  return selectOptimalPrintDensity(sheet);
}

export function initGlobalPrintFit(): void {
  if (typeof window === 'undefined' || printListenersBound) return;
  printListenersBound = true;

  window.addEventListener('beforeprint', () => {
    applySinglePagePrintFit();
  });

  window.addEventListener('afterprint', () => {
    clearSinglePagePrintFit();
  });
}

export function triggerOnePagePrint(): void {
  applySinglePagePrintFit();
  window.print();
  // Safety cleanup if embedded iframe suppresses afterprint
  window.setTimeout(() => {
    clearSinglePagePrintFit();
  }, 1500);
}
