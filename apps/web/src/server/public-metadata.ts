import 'server-only';
import { publicStrategySchema, publicVersionSchema } from '@markov/contracts';
import type { Metadata } from 'next';
import { webEnv } from './web-env';

/**
 * Page metadata for shareable public pages, read anonymously from the
 * API's public projection with a short timeout. The public routes answer
 * only registered, unmoderated versions, so nothing private can reach a
 * title, a description or a crawler; any failure falls back to a generic
 * title rather than a guess.
 */
async function readPublic(path: string): Promise<unknown> {
  const response = await fetch(`${webEnv().apiOrigin}${path}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(2000),
  });
  if (!response.ok) {
    return null;
  }
  return response.json();
}

export async function publicStrategyMetadata(strategyId: string): Promise<Metadata> {
  const generic: Metadata = { title: 'Strategy', robots: { index: false } };
  try {
    const parsed = publicStrategySchema.safeParse(await readPublic(`/v1/strategies/${strategyId}`));
    if (!parsed.success) {
      return generic;
    }
    const count = parsed.data.versions.length;
    return {
      title: parsed.data.title,
      description: `Public Markov strategy with ${count} version${count === 1 ? '' : 's'} registered on chain.`,
    };
  } catch {
    return generic;
  }
}

export async function publicVersionMetadata(
  strategyId: string,
  versionId: string,
): Promise<Metadata> {
  const generic: Metadata = { title: 'Strategy version', robots: { index: false } };
  try {
    const parsed = publicVersionSchema.safeParse(
      await readPublic(`/v1/strategies/${strategyId}/versions/${versionId}`),
    );
    if (!parsed.success) {
      return generic;
    }
    return {
      title: `${parsed.data.title} · version ${parsed.data.versionNumber}`,
      description: `Immutable Markov strategy version registered on chain (manifest hash ${parsed.data.manifestHash.slice(0, 16)}…).`,
    };
  } catch {
    return generic;
  }
}
