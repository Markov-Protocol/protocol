import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createLogger, REDACTED_VALUE } from '../src/index.js';

function collectingStream(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(String(chunk));
      callback();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('createLogger', () => {
  it('emits structured json with service metadata and label levels', () => {
    const sink = collectingStream();
    const logger = createLogger({
      service: 'api',
      version: '1.2.3',
      markovEnv: 'test',
      level: 'info',
      format: 'json',
      destination: sink.stream,
    });
    logger.info({ requestId: 'abc' }, 'hello');
    const [line] = sink.lines();
    expect(line).toMatchObject({
      level: 'info',
      service: 'api',
      version: '1.2.3',
      env: 'test',
      requestId: 'abc',
      msg: 'hello',
    });
    expect(typeof line?.['time']).toBe('string');
  });

  it('redacts sensitive keys at several depths', () => {
    const sink = collectingStream();
    const logger = createLogger({
      service: 'api',
      version: 'dev',
      markovEnv: 'test',
      level: 'info',
      format: 'json',
      destination: sink.stream,
    });
    logger.info(
      {
        apiKey: 'k-top',
        req: { headers: { authorization: 'Bearer abc', cookie: 'session=1' } },
        nested: { deeper: { password: 'p-deep' } },
        DATABASE_URL: 'postgres://u:pw@h/db',
        signedTransaction: 'AAAA',
      },
      'event',
    );
    const [line] = sink.lines();
    const text = JSON.stringify(line);
    expect(text).not.toContain('k-top');
    expect(text).not.toContain('Bearer abc');
    expect(text).not.toContain('session=1');
    expect(text).not.toContain('p-deep');
    expect(text).not.toContain('pw@h');
    expect(text).not.toContain('AAAA');
    expect(text).toContain(REDACTED_VALUE);
  });

  it('honours the configured level', () => {
    const sink = collectingStream();
    const logger = createLogger({
      service: 'api',
      version: 'dev',
      markovEnv: 'test',
      level: 'warn',
      format: 'json',
      destination: sink.stream,
    });
    logger.info('dropped');
    logger.warn('kept');
    expect(sink.lines().map((line) => line['msg'])).toEqual(['kept']);
  });
});
