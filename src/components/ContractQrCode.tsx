import React, { useMemo } from 'react';
import QRCode from 'qrcode';

export function buildContractAccessUrl(digitalAccessToken: string): string {
  const encoded = encodeURIComponent(digitalAccessToken);
  if (typeof window === 'undefined' || !window.location?.origin) {
    return `/?contract=${encoded}`;
  }
  return `${window.location.origin}/?contract=${encoded}`;
}

export async function generateContractQrPngDataUrl(
  url: string,
  width = 512,
): Promise<string> {
  return QRCode.toDataURL(url, {
    width,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#111114',
      light: '#FFFFFF',
    },
  });
}

interface ContractQrCodeProps {
  value: string;
  size?: number;
  quietMargin?: number;
  className?: string;
  label?: string;
}

export const ContractQrCode: React.FC<ContractQrCodeProps> = ({
  value,
  size = 148,
  quietMargin = 2,
  className = '',
  label = 'QR Code contrat',
}) => {
  const qrGeometry = useMemo(() => {
    if (!value) return null;
    try {
      const qr = QRCode.create(value, { errorCorrectionLevel: 'M' });
      const count = qr.modules.size;
      const total = count + quietMargin * 2;
      const segments: string[] = [];

      for (let r = 0; r < count; r++) {
        for (let c = 0; c < count; c++) {
          if (qr.modules.get(r, c)) {
            segments.push(`M${c + quietMargin} ${r + quietMargin}h1v1h-1z`);
          }
        }
      }

      return {
        total,
        pathData: segments.join(''),
      };
    } catch {
      return null;
    }
  }, [value, quietMargin]);

  if (!qrGeometry) return null;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${qrGeometry.total} ${qrGeometry.total}`}
      shapeRendering="crispEdges"
      role="img"
      aria-label={label}
      className={`block bg-white ${className}`}
    >
      <rect width={qrGeometry.total} height={qrGeometry.total} fill="#FFFFFF" />
      <path d={qrGeometry.pathData} fill="#111114" />
    </svg>
  );
};
