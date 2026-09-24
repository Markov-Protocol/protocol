import { PRICE_KIND_LABELS, type TypedPrice } from '@markov/contracts';
import { formatDecimalString } from './decimal';

export interface FormatPriceOptions {
  readonly locale?: string;
  readonly maximumFractionDigits?: number;
  readonly minimumFractionDigits?: number;
}

/** "123.45 USDC" with exact digits; the unit is always shown because USD and USDC differ. */
export function formatPriceValue(
  price: Pick<TypedPrice, 'value' | 'unit'>,
  options: FormatPriceOptions = {},
): string {
  const formatted = formatDecimalString(price.value, {
    minimumFractionDigits: options.minimumFractionDigits ?? 2,
    maximumFractionDigits: options.maximumFractionDigits ?? 6,
    rounding: 'truncate',
    ...(options.locale ? { locale: options.locale } : {}),
  });
  return `${formatted} ${price.unit}`;
}

/** Label for a price kind, from the shared contract. */
export function priceKindLabel(kind: TypedPrice['kind']): string {
  return PRICE_KIND_LABELS[kind];
}
