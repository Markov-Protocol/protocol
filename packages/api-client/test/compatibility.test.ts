import { readFileSync } from 'node:fs';
import { meResponseSchema, platformInfoResponseSchema } from '@markov/contracts';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { CONTRACT_MATRIX } from '../src/matrix';

const document = JSON.parse(
  readFileSync(new URL('../../../docs/markov/openapi.json', import.meta.url), 'utf8'),
) as {
  paths: Record<
    string,
    Record<
      string,
      {
        responses: Record<
          string,
          { content?: Record<string, { schema?: { required?: string[]; properties?: object } }> }
        >;
      }
    >
  >;
};

function requiredKeys(schema: z.ZodType): string[] {
  const json = z.toJSONSchema(schema, { io: 'output' }) as {
    required?: string[];
    properties?: Record<string, unknown>;
  };
  return [...(json.required ?? [])].sort();
}

describe('frontend contract matrix against the frozen OpenAPI document', () => {
  for (const entry of CONTRACT_MATRIX) {
    it(`${entry.method.toUpperCase()} ${entry.path} exists and answers ${entry.status} with the expected shape`, () => {
      const operation = document.paths[entry.path]?.[entry.method];
      expect(operation, `${entry.method} ${entry.path} missing from OpenAPI`).toBeDefined();
      const response = operation?.responses[String(entry.status)];
      expect(response, `status ${entry.status} missing`).toBeDefined();
      if (entry.responseSchema === null) {
        return;
      }
      const documented = response?.content?.['application/json']?.schema;
      expect(documented?.required, 'documented required properties').toBeDefined();
      expect([...(documented?.required ?? [])].sort()).toEqual(requiredKeys(entry.responseSchema));
    });
  }

  it('rejects a renamed field, an unknown enum value and missing data at runtime', () => {
    const valid = {
      principal: {
        class: 'user',
        id: '2b7e6b5e-3d3a-4b0e-8f1a-5b0f0a1c2d3e',
        userId: '2b7e6b5e-3d3a-4b0e-8f1a-5b0f0a1c2d3e',
        scopes: ['owner:*'],
        authTime: '2026-09-24T10:00:00.000Z',
        stepUpFresh: true,
      },
      user: {
        id: '2b7e6b5e-3d3a-4b0e-8f1a-5b0f0a1c2d3e',
        subject: 'did:test:alice',
        issuer: 'https://issuer.test',
        createdAt: '2026-09-24T10:00:00.000Z',
      },
      session: {
        sessionId: '2b7e6b5e-3d3a-4b0e-8f1a-5b0f0a1c2d3e',
        expiresAt: '2026-09-25T10:00:00.000Z',
      },
    };
    expect(meResponseSchema.safeParse(valid).success).toBe(true);
    const renamed = {
      ...valid,
      principal: { ...valid.principal, klass: 'user', class: undefined },
    };
    expect(meResponseSchema.safeParse(renamed).success).toBe(false);
    const unknownEnum = { ...valid, principal: { ...valid.principal, class: 'root' } };
    expect(meResponseSchema.safeParse(unknownEnum).success).toBe(false);
    const missing = { ...valid, session: undefined };
    expect(meResponseSchema.safeParse(missing).success).toBe(false);
    expect(
      platformInfoResponseSchema.safeParse({
        service: 'markov-api',
        version: 'dev',
        contractSchemaVersion: '1',
        identity: null,
        identityProvider: 'magic',
        executionWritesEnabled: false,
        capabilities: [],
      }).success,
    ).toBe(false);
  });
});
