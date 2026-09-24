'use client';

import encodeQR from 'qr';
import { useMemo } from 'react';

/**
 * A QR code drawn as SVG rectangles from the encoder's boolean matrix, so no
 * markup from a library is injected. The full text stays visible next to
 * it; the code is a convenience, never the only way to read the address.
 */
export function QrCode({
  value,
  label,
  size = 176,
}: {
  readonly value: string;
  readonly label: string;
  readonly size?: number;
}) {
  const matrix = useMemo(() => encodeQR(value, 'raw', { ecc: 'medium' }), [value]);
  const modules = matrix.length;
  const quiet = 2;
  const total = modules + quiet * 2;
  const rects: string[] = [];
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) {
        rects.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
      }
    });
  });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total} ${total}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-md bg-white"
      data-testid="qr-code"
    >
      <title>{label}</title>
      <path d={rects.join('')} fill="#000" />
    </svg>
  );
}
