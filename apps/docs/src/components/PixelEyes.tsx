import type { ReactElement } from 'react';

/**
 * Mark I's two blue pixel eyes as an inline SVG, the same 5x7 matrix the
 * app draws (packages/markov-shell/src/pixel-eyes.tsx). Decorative only:
 * the text next to them carries the meaning.
 */
const EYE_ROWS: readonly string[] = ['01110', '11111', '11111', '11111', '11111', '11111', '01110'];
const DIM = 10;
const GAP = DIM * 0.18;
const EYE_WIDTH = 5 * DIM + 4 * GAP;
const EYE_HEIGHT = 7 * DIM + 6 * GAP;
const SPACING = EYE_WIDTH * 0.9;
const WIDTH = EYE_WIDTH * 2 + SPACING;

const LIT: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> =
  EYE_ROWS.flatMap((row, y) =>
    [...row].flatMap((pixel, x) => (pixel === '1' ? [{ id: `${x}-${y}`, x, y }] : [])),
  );

function Eye({ offsetX }: { readonly offsetX: number }): ReactElement {
  return (
    <g transform={`translate(${offsetX} 0)`}>
      {LIT.map((pixel) => (
        <rect
          key={pixel.id}
          x={pixel.x * (DIM + GAP)}
          y={pixel.y * (DIM + GAP)}
          width={DIM}
          height={DIM}
          rx={DIM * 0.22}
          fill="currentColor"
        />
      ))}
    </g>
  );
}

export function PixelEyes({ className }: { readonly className?: string }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${WIDTH} ${EYE_HEIGHT}`}
      className={className ? `markov-eyes ${className}` : 'markov-eyes'}
    >
      <Eye offsetX={0} />
      <Eye offsetX={EYE_WIDTH + SPACING} />
    </svg>
  );
}
