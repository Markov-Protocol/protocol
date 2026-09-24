import { FIXTURE_SOURCES, MAX_BODY_BYTES } from '@markov/research';
import { describe, expect, it } from 'vitest';
import { createRetriever } from '../src/research/retrieval.js';
import { fakeTransport } from './support/fake-transport.js';

const PUBLIC = {
  'news.example.com': ['93.184.216.34'],
  'issuer.example.com': ['2606:2800:220:1:248:1893:25c8:1946'],
};

describe('research retrieval', () => {
  it('fetches a public page pinned to its classified address and sanitises it', async () => {
    const transport = fakeTransport(PUBLIC, {
      'https://issuer.example.com/terms': {
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: FIXTURE_SOURCES['issuer-terms']?.body ?? '',
      },
    });
    const retriever = createRetriever({ fixtures: false, transport });
    const outcome = await retriever.retrieve('https://issuer.example.com/terms#section');
    expect(outcome.status).toBe('fetched');
    if (outcome.status !== 'fetched') {
      return;
    }
    expect(transport.calls).toEqual([
      { url: 'https://issuer.example.com/terms', address: '2606:2800:220:1:248:1893:25c8:1946' },
    ]);
    expect(outcome.origin).toBe('network');
    expect(outcome.title).toBe('Fixture Aerospace Inc — token terms');
    expect(outcome.contentType).toBe('text/html');
    expect(outcome.excerpt).toContain('no shareholder voting rights');
    expect(outcome.excerpt).not.toMatch(/script|onload|evil|javascript:|ignore previous/i);
    expect(outcome.excerpt).not.toMatch(/[<>]/);
    expect(outcome.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome.redirects).toEqual([]);
  });

  it('refuses unsafe URLs before any network activity', async () => {
    const transport = fakeTransport(PUBLIC, {});
    const retriever = createRetriever({ fixtures: false, transport });
    for (const url of [
      'http://news.example.com/plain',
      'https://127.0.0.1/',
      'https://[::1]/',
      'https://169.254.169.254/latest/meta-data/',
      'https://metadata.google.internal/',
      'https://intranet.corp/',
      'https://user:pw@news.example.com/',
      'https://news.example.com:8443/',
      'ftp://news.example.com/',
      'https://2130706433/',
      'https://0x7f000001/',
      'https://fixture.markov.invalid/issuer/terms',
    ]) {
      const outcome = await retriever.retrieve(url);
      expect(outcome.status, url).toBe('blocked');
    }
    expect(transport.calls).toEqual([]);
  });

  it('refuses hosts that resolve to private, loopback, link-local or mapped addresses', async () => {
    const transport = fakeTransport(
      {
        'rebind.example.com': ['93.184.216.34', '10.0.0.5'],
        'loop.example.com': ['127.0.0.1'],
        'mapped.example.com': ['::ffff:192.168.1.1'],
        'link.example.com': ['fe80::1'],
        'nat64.example.com': ['64:ff9b::a00:1'],
        'empty.example.com': [],
      },
      {},
    );
    const retriever = createRetriever({ fixtures: false, transport });
    for (const host of [
      'rebind.example.com',
      'loop.example.com',
      'mapped.example.com',
      'link.example.com',
      'nat64.example.com',
      'empty.example.com',
    ]) {
      const outcome = await retriever.retrieve(`https://${host}/`);
      expect(outcome.status, host).toBe('blocked');
      if (outcome.status === 'blocked') {
        expect(outcome.reason).toContain('refused address');
      }
    }
    expect(transport.calls).toEqual([]);
    const missing = await retriever.retrieve('https://nowhere.example.com/');
    expect(missing.status).toBe('failed');
  });

  it('revalidates every redirect hop and bounds the chain', async () => {
    const hosts = {
      'news.example.com': ['93.184.216.34'],
      'cdn.example.net': ['151.101.1.1'],
      'internal.example.com': ['10.1.2.3'],
    };
    const transport = fakeTransport(hosts, {
      'https://news.example.com/a': { status: 301, location: '/b' },
      'https://news.example.com/b': { status: 302, location: 'https://cdn.example.net/c' },
      'https://cdn.example.net/c': { status: 200, contentType: 'text/plain', body: 'final text' },
      'https://news.example.com/down': { status: 302, location: 'http://news.example.com/plain' },
      'https://news.example.com/private': {
        status: 307,
        location: 'https://internal.example.com/secret',
      },
      'https://news.example.com/literal': { status: 302, location: 'https://169.254.169.254/' },
      'https://news.example.com/loop1': { status: 302, location: '/loop2' },
      'https://news.example.com/loop2': { status: 302, location: '/loop3' },
      'https://news.example.com/loop3': { status: 302, location: '/loop4' },
      'https://news.example.com/loop4': { status: 302, location: '/loop5' },
      'https://news.example.com/noloc': { status: 302 },
    });
    const retriever = createRetriever({ fixtures: false, transport });
    const ok = await retriever.retrieve('https://news.example.com/a');
    expect(ok.status).toBe('fetched');
    if (ok.status === 'fetched') {
      expect(ok.finalUrl).toBe('https://cdn.example.net/c');
      expect(ok.redirects).toEqual(['https://news.example.com/b', 'https://cdn.example.net/c']);
      expect(ok.excerpt).toBe('final text');
      expect(transport.calls.at(-1)).toEqual({
        url: 'https://cdn.example.net/c',
        address: '151.101.1.1',
      });
    }
    for (const path of ['down', 'private', 'literal', 'loop1', 'noloc']) {
      const outcome = await retriever.retrieve(`https://news.example.com/${path}`);
      expect(outcome.status, path).toBe('blocked');
      if (outcome.status === 'blocked') {
        expect(outcome.reason).toMatch(/redirect refused|refused address/);
      }
    }
    // The private redirect target was resolved and refused; it was never requested.
    expect(transport.calls.some((call) => call.url.startsWith('https://internal.'))).toBe(false);
  });

  it('caps payloads by declared and streamed length and refuses unsupported content', async () => {
    const big = new Uint8Array(MAX_BODY_BYTES + 1).fill(97);
    const transport = fakeTransport(PUBLIC, {
      'https://news.example.com/declared': {
        status: 200,
        contentType: 'text/plain',
        contentLength: MAX_BODY_BYTES + 1,
        body: 'x',
      },
      'https://news.example.com/streamed': {
        status: 200,
        contentType: 'text/plain',
        body: [big.subarray(0, 1024 * 1024), big.subarray(1024 * 1024)],
      },
      'https://news.example.com/pdf': {
        status: 200,
        contentType: 'application/pdf',
        body: '%PDF-1.7',
      },
      'https://news.example.com/none': { status: 200, body: 'no type' },
      'https://news.example.com/json': {
        status: 200,
        contentType: 'application/json',
        body: '{"price": "<b>12</b>"}',
      },
      'https://news.example.com/gone': { status: 500, contentType: 'text/plain', body: 'boom' },
    });
    const retriever = createRetriever({ fixtures: false, transport });
    const declared = await retriever.retrieve('https://news.example.com/declared');
    expect(declared).toMatchObject({ status: 'blocked' });
    const streamed = await retriever.retrieve('https://news.example.com/streamed');
    expect(streamed).toMatchObject({ status: 'blocked' });
    expect(transport.closed).toBeGreaterThanOrEqual(2);
    expect(await retriever.retrieve('https://news.example.com/pdf')).toMatchObject({
      status: 'blocked',
      reason: 'content type application/pdf is not supported',
    });
    expect(await retriever.retrieve('https://news.example.com/none')).toMatchObject({
      status: 'blocked',
    });
    const json = await retriever.retrieve('https://news.example.com/json');
    expect(json.status).toBe('fetched');
    if (json.status === 'fetched') {
      expect(json.excerpt).toBe('{"price": " b 12 /b "}');
      expect(json.title).toBeNull();
    }
    expect(await retriever.retrieve('https://news.example.com/gone')).toMatchObject({
      status: 'failed',
      reason: 'HTTP 500 from news.example.com',
    });
  });

  it('serves fixture sources from memory only when fixtures are enabled', async () => {
    const transport = fakeTransport({}, {});
    const withFixtures = createRetriever({ fixtures: true, transport });
    const url = FIXTURE_SOURCES['issuer-terms']?.url ?? '';
    const outcome = await withFixtures.retrieve(url);
    expect(outcome).toMatchObject({ status: 'fetched', origin: 'fixture', finalUrl: url });
    expect(transport.calls).toEqual([]);
    const without = createRetriever({ fixtures: false, transport });
    expect(await without.retrieve(url)).toMatchObject({ status: 'blocked' });
    expect(transport.calls).toEqual([]);
  });
});
