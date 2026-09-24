import { describe, expect, it } from 'vitest';
import {
  classifyAddress,
  classifyResolved,
  evaluateContentType,
  evaluateRedirect,
  evaluateUrl,
  expandIPv6,
  MAX_REDIRECTS,
} from '../src/index.js';

describe('address classification', () => {
  it('refuses every private, reserved, loopback, link-local, multicast and mapped range', () => {
    const refused = [
      '0.0.0.0',
      '10.1.2.3',
      '100.64.0.1',
      '127.0.0.1',
      '127.255.255.254',
      '169.254.169.254',
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.1',
      '192.0.2.1',
      '192.88.99.1',
      '192.168.1.1',
      '198.18.0.1',
      '198.51.100.7',
      '203.0.113.9',
      '224.0.0.1',
      '240.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:127.0.0.1',
      '::ffff:10.0.0.1',
      '::ffff:169.254.169.254',
      '64:ff9b::7f00:1',
      '2002:7f00:1::',
      '2002:c0a8:101::',
      '2001::1',
      '2001:db8::1',
      '100::1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
    ];
    for (const address of refused) {
      expect(classifyAddress(address).ok, address).toBe(false);
    }
  });

  it('accepts public addresses and refuses non-canonical or zoned literals', () => {
    for (const address of [
      '8.8.8.8',
      '1.1.1.1',
      '151.101.1.140',
      '2606:4700::1111',
      '2a00:1450:4001:800::200e',
      '::ffff:8.8.8.8',
      '2002:808:808::',
    ]) {
      expect(classifyAddress(address).ok, address).toBe(true);
    }
    for (const address of [
      '0x7f000001',
      '2130706433',
      '0177.0.0.1',
      '127.1',
      '127.0.0.01',
      'fe80::1%eth0',
      'not-an-ip',
      '',
    ]) {
      expect(classifyAddress(address).ok, address).toBe(false);
    }
    expect(expandIPv6('::ffff:8.8.8.8')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0808, 0x0808]);
    expect(expandIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
  });

  it('requires every resolved address to be public', () => {
    expect(classifyResolved(['8.8.8.8', '2606:4700::1111'])).toEqual({ ok: true, family: 6 });
    expect(classifyResolved([]).ok).toBe(false);
    expect(classifyResolved(['8.8.8.8', '10.0.0.1'])).toEqual({
      ok: false,
      reason: '10.0.0.1: private IPv4 range',
    });
  });
});

describe('URL policy', () => {
  it('accepts https hostnames on the default port and strips fragments', () => {
    const verdict = evaluateUrl('https://Example.com/path?x=1#frag');
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.host).toBe('example.com');
      expect(verdict.url.toString()).toBe('https://example.com/path?x=1');
    }
    expect(evaluateUrl('https://example.com:443/').ok).toBe(true);
    expect(evaluateUrl('https://xn--bcher-kva.com/').ok).toBe(true);
    expect(evaluateUrl('https://docs.example/').ok).toBe(false);
  });

  it('refuses unsafe schemes, credentials, ports, literals and local names', () => {
    const cases: Record<string, RegExp> = {
      'http://example.com/': /only https/,
      'ftp://example.com/': /only https/,
      'javascript:alert(1)': /not a valid absolute URL|only https/,
      'file:///etc/passwd': /only https/,
      'https://user:pw@example.com/': /credentials/,
      'https://example.com:8443/': /default https port/,
      'https://127.0.0.1/': /address literals/,
      'https://[::1]/': /address literals/,
      'https://2130706433/': /address literals/,
      'https://0x7f000001/': /address literals/,
      'https://localhost/': /local or special-use/,
      'https://metadata.google.internal/computeMetadata/v1/': /local or special-use/,
      'https://api.internal/': /local or special-use/,
      'https://printer.local/': /local or special-use/,
      'https://evil.onion/': /local or special-use/,
      'https://intranet/': /fully qualified/,
      'not a url': /not a valid absolute URL/,
    };
    for (const [url, reason] of Object.entries(cases)) {
      const verdict = evaluateUrl(url);
      expect(verdict.ok, url).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason, url).toMatch(reason);
      }
    }
    expect(evaluateUrl(`https://example.com/${'a'.repeat(2100)}`).ok).toBe(false);
  });

  it('revalidates redirect targets and bounds the hop count', () => {
    const from = new URL('https://example.com/start');
    expect(evaluateRedirect(from, '/next', 0)).toMatchObject({ ok: true, host: 'example.com' });
    expect(evaluateRedirect(from, 'https://other.org/x', 1)).toMatchObject({
      ok: true,
      host: 'other.org',
    });
    expect(evaluateRedirect(from, 'https://other.example/x', 1)).toMatchObject({ ok: false });
    expect(evaluateRedirect(from, 'http://example.com/downgrade', 0)).toMatchObject({ ok: false });
    expect(evaluateRedirect(from, 'https://169.254.169.254/latest', 0)).toMatchObject({
      ok: false,
    });
    expect(evaluateRedirect(from, 'https://localhost/', 0)).toMatchObject({ ok: false });
    expect(evaluateRedirect(from, null, 0)).toMatchObject({
      ok: false,
      reason: 'redirect without a Location header',
    });
    expect(evaluateRedirect(from, '/loop', MAX_REDIRECTS)).toMatchObject({
      ok: false,
      reason: `more than ${MAX_REDIRECTS} redirects`,
    });
  });

  it('allows only text, html and json content types', () => {
    expect(evaluateContentType('text/html; charset=utf-8')).toEqual({
      ok: true,
      mediaType: 'text/html',
    });
    expect(evaluateContentType('application/json')).toMatchObject({ ok: true });
    expect(evaluateContentType('application/octet-stream').ok).toBe(false);
    expect(evaluateContentType('application/pdf').ok).toBe(false);
    expect(evaluateContentType('image/svg+xml').ok).toBe(false);
    expect(evaluateContentType(null).ok).toBe(false);
  });
});
