import { describe, expect, it } from 'vitest';
import { buildProgram } from '../src/index.js';
import { CliExit, EXIT_CONFIG } from '../src/output.js';

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (text: string) => out.push(text), err: (text: string) => err.push(text) },
    out,
    err,
  };
}

describe('markov cli', () => {
  it('prints its version', async () => {
    const { io, out } = capture();
    await buildProgram(io).parseAsync(['node', 'markov', 'version']);
    expect(out).toEqual(['0.1.0']);
  });

  it('reports configuration issues with the config exit code', async () => {
    const { io, err } = capture();
    const previous = { ...process.env };
    for (const key of Object.keys(process.env)) {
      if (/^(MARKOV_|DATABASE_|SOLANA_|TEMPORAL_|API_|LOG_)/.test(key)) {
        delete process.env[key];
      }
    }
    process.env['MARKOV_ENV'] = 'production';
    process.env['SOLANA_CLUSTER'] = 'devnet';
    process.env['DATABASE_URL'] = 'postgres://markov:markov@127.0.0.1:5432/markov_test';
    process.env['SOLANA_RPC_PRIMARY_URL'] = 'https://rpc.example.test';
    try {
      await expect(
        buildProgram(io).parseAsync(['node', 'markov', 'config', 'check']),
      ).rejects.toMatchObject({
        name: 'CliExit',
        exitCode: EXIT_CONFIG,
      });
      expect(err.join('\n')).toContain('SOLANA_CLUSTER');
      expect(err.join('\n')).toContain('TEMPORAL_TLS');
      expect(err.join('\n')).not.toContain('markov:markov');
    } finally {
      for (const key of Object.keys(process.env)) {
        if (previous[key] === undefined) {
          delete process.env[key];
        }
      }
      Object.assign(process.env, previous);
    }
  });

  it('exposes the exit class for the entry point', () => {
    expect(new CliExit('x', 3).exitCode).toBe(3);
  });
});
