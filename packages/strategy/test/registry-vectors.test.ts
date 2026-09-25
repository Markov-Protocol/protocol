import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  canonicalContent,
  canonicalManifest,
  contentDigestOf,
  manifestHashOf,
} from '../src/index.js';

/**
 * The registry program's Rust tests write `registry-vectors.json` with their
 * own canonical JSON writer; this proves the TypeScript canonicalisation and
 * domain-separated hashes agree with it byte for byte.
 */
interface RegistryVectors {
  manifest: {
    b07: {
      canonicalManifest: string;
      manifestHash: string;
      canonicalContent: string;
      contentDigest: string;
    };
  };
  registration: {
    genesisHash: string;
    manifest: {
      strategyId: string;
      versionNumber: number;
      title: string;
      thesis: string;
      legs: {
        instrumentId: string;
        mint: string;
        tokenProgram: 'spl-token' | 'token-2022';
        weightBps: number;
      }[];
      cashWeightBps: number;
      maintenance: { suggestion: 'hold'; driftThresholdBps: null; reviewEveryDays: null };
      references: string[];
    };
    canonicalManifest: string;
    manifestHash: string;
    canonicalContent: string;
    contentDigest: string;
  };
}

const vectors = JSON.parse(
  readFileSync(
    new URL('../../../programs/strategy-registry/vectors/registry-vectors.json', import.meta.url),
    'utf8',
  ),
) as RegistryVectors;

describe('registry vectors (canonical manifest)', () => {
  it('reproduces the B07 manifest hash and content digest recorded by the Rust writer', () => {
    const { b07 } = vectors.manifest;
    const genesis = vectors.registration.genesisHash;
    expect(manifestHashOf(b07.canonicalManifest, '1', genesis)).toBe(b07.manifestHash);
    expect(contentDigestOf(b07.canonicalContent, '1', genesis)).toBe(b07.contentDigest);
    expect(b07.manifestHash).toBe(
      'd324b072007fd7af46659406f5bb90b373ef088bc19774b99a726d9a95dacc1a',
    );
  });

  it('canonicalises the registrable manifest exactly as the Rust writer does', () => {
    const { registration } = vectors;
    const input = {
      schemaVersion: '1' as const,
      kind: 'stock_spot_basket' as const,
      genesisHash: registration.genesisHash,
      strategyId: registration.manifest.strategyId,
      versionNumber: registration.manifest.versionNumber,
      parentVersionId: null,
      forkOf: null,
      title: registration.manifest.title,
      thesis: registration.manifest.thesis,
      thesisId: null,
      legs: registration.manifest.legs,
      cashWeightBps: registration.manifest.cashWeightBps,
      maintenance: registration.manifest.maintenance,
      references: registration.manifest.references,
    };
    const manifest = canonicalManifest(input);
    const content = canonicalContent(input);
    expect(manifest).toBe(registration.canonicalManifest);
    expect(content).toBe(registration.canonicalContent);
    expect(manifestHashOf(manifest, '1', registration.genesisHash)).toBe(registration.manifestHash);
    expect(contentDigestOf(content, '1', registration.genesisHash)).toBe(
      registration.contentDigest,
    );
  });
});
