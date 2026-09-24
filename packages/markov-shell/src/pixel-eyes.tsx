import { cn } from '@markov/ui';

/**
 * Presentation expressions only. They are derived from explicit
 * application events and never indicate account, order or execution state.
 */
export type EyeExpression = 'ready' | 'attention' | 'muted';

export interface PixelEyesProps {
  readonly expression?: EyeExpression;
  readonly size?: 'hero' | 'compact';
  readonly className?: string;
}

/** 5x7 pixel matrix for one eye; 1 lights a pixel. */
const EYE_ROWS: readonly string[] = ['01110', '11111', '11111', '11111', '11111', '11111', '01110'];

const LIT_PIXELS: ReadonlyArray<{ readonly id: string; readonly x: number; readonly y: number }> =
  EYE_ROWS.flatMap((row, y) =>
    [...row].flatMap((pixel, x) => (pixel === '1' ? [{ id: `${x}-${y}`, x, y }] : [])),
  );

function Eye({ offsetX, dim }: { readonly offsetX: number; readonly dim: number }) {
  const gap = dim * 0.18;
  return (
    <g transform={`translate(${offsetX} 0)`}>
      {LIT_PIXELS.map((pixel) => (
        <rect
          key={pixel.id}
          x={pixel.x * (dim + gap)}
          y={pixel.y * (dim + gap)}
          width={dim}
          height={dim}
          rx={dim * 0.22}
          fill="currentColor"
        />
      ))}
    </g>
  );
}

/**
 * Two blue pixel eyes drawn as SVG. Decorative: assistive technology reads
 * the companion status text next to them, never the eyes.
 */
export function PixelEyes({ expression = 'ready', size = 'hero', className }: PixelEyesProps) {
  const dim = 10;
  const gap = dim * 0.18;
  const eyeWidth = 5 * dim + 4 * gap;
  const eyeHeight = 7 * dim + 6 * gap;
  const spacing = eyeWidth * 0.9;
  const width = eyeWidth * 2 + spacing;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${width} ${eyeHeight}`}
      className={cn(
        'markov-eyes',
        size === 'hero' ? 'h-16 w-auto sm:h-20' : 'h-4 w-auto',
        expression === 'muted'
          ? 'text-text-muted'
          : expression === 'attention'
            ? 'text-attention'
            : 'text-accent',
        className,
      )}
      data-expression={expression}
      data-size={size}
    >
      <Eye offsetX={0} dim={dim} />
      <Eye offsetX={eyeWidth + spacing} dim={dim} />
    </svg>
  );
}
