import { z } from 'zod';
import { genesisHashSchema } from './platform.js';

/**
 * Principals and credentials. Identity and role are always derived from a
 * verified credential on the server; no caller-supplied user id, wallet,
 * tenant or role is ever trusted.
 */
export const PRINCIPAL_CLASSES = ['user', 'agent', 'operator', 'device', 'worker'] as const;
export const principalClassSchema = z.enum(PRINCIPAL_CLASSES);
export type PrincipalClass = z.infer<typeof principalClassSchema>;

/** Scopes an API agent credential may hold in V1. None can submit or approve a transaction. */
export const AGENT_SCOPES = ['research:read', 'portfolio:read', 'proposals:create'] as const;
export const agentScopeSchema = z.enum(AGENT_SCOPES);
export type AgentScope = z.infer<typeof agentScopeSchema>;

/** Operator scopes. Issued only through the CLI with database access, never through the public API. */
export const OPERATOR_SCOPES = [
  'ops:read',
  'ops:credentials:revoke',
  'ops:capabilities:write',
  'ops:catalog:read',
  'ops:catalog:write',
] as const;
export const operatorScopeSchema = z.enum(OPERATOR_SCOPES);
export type OperatorScope = z.infer<typeof operatorScopeSchema>;

/** Capabilities a paired device may be granted. None includes spending authority. */
export const DEVICE_CAPABILITIES = [
  'preferences:sync',
  'status:read',
  'notifications:receive',
] as const;
export const deviceCapabilitySchema = z.enum(DEVICE_CAPABILITIES);
export type DeviceCapability = z.infer<typeof deviceCapabilitySchema>;

export const idSchema = z.string().uuid();
export const base58AddressSchema = z
  .string()
  .min(32)
  .max(44)
  .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'must be base58');

export const sessionExchangeRequestSchema = z.object({
  /** Identity-provider access token; verified server-side against the configured issuer and audience. */
  identityToken: z.string().min(20).max(8192),
});

export const sessionResponseSchema = z.object({
  sessionId: idSchema,
  /** Opaque bearer secret, returned exactly once. Store it server-side in an HttpOnly cookie; never in a URL. */
  sessionToken: z.string(),
  expiresAt: z.iso.datetime(),
  authTime: z.iso.datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const meResponseSchema = z.object({
  principal: z.object({
    class: principalClassSchema,
    id: z.string(),
    userId: idSchema.nullable(),
    scopes: z.array(z.string()),
    authTime: z.iso.datetime().nullable(),
    /** Whether a security-sensitive operation may proceed without re-authentication. */
    stepUpFresh: z.boolean(),
  }),
  user: z
    .object({
      id: idSchema,
      subject: z.string(),
      issuer: z.string(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  /** The interactive session behind the call, so a client can schedule expiry recovery; null for credentials. */
  session: z
    .object({
      sessionId: idSchema,
      expiresAt: z.iso.datetime(),
    })
    .nullable(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

export const walletChallengeRequestSchema = z.object({
  address: base58AddressSchema,
});

export const walletChallengeResponseSchema = z.object({
  challengeId: idSchema,
  /** Exact text the wallet must sign; any change invalidates the challenge. */
  message: z.string(),
  expiresAt: z.iso.datetime(),
});
export type WalletChallengeResponse = z.infer<typeof walletChallengeResponseSchema>;

export const walletLinkRequestSchema = z.object({
  challengeId: idSchema,
  address: base58AddressSchema,
  /** Base58 Ed25519 signature over the exact challenge message. */
  signature: z
    .string()
    .min(80)
    .max(90)
    .regex(/^[1-9A-HJ-NP-Za-km-z]+$/, 'must be base58'),
});

export const walletLinkSchema = z.object({
  walletId: idSchema,
  chain: z.literal('solana'),
  genesisHash: genesisHashSchema,
  address: base58AddressSchema,
  verifiedAt: z.iso.datetime(),
});
export type WalletLink = z.infer<typeof walletLinkSchema>;

export const walletListResponseSchema = z.object({ wallets: z.array(walletLinkSchema) });

export const apiCredentialCreateRequestSchema = z.object({
  label: z.string().min(1).max(100),
  scopes: z.array(agentScopeSchema).min(1).max(AGENT_SCOPES.length),
  /** Lifetime in seconds; at most 90 days. */
  expiresInSeconds: z
    .number()
    .int()
    .min(300)
    .max(90 * 24 * 3600),
});

export const apiCredentialSchema = z.object({
  credentialId: idSchema,
  label: z.string(),
  prefix: z.string(),
  scopes: z.array(z.string()),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
  lastUsedAt: z.iso.datetime().nullable(),
});
export type ApiCredential = z.infer<typeof apiCredentialSchema>;

export const apiCredentialCreatedResponseSchema = apiCredentialSchema.extend({
  /** Returned exactly once. */
  token: z.string(),
});

export const apiCredentialListResponseSchema = z.object({
  credentials: z.array(apiCredentialSchema),
});

export const devicePairingCreateRequestSchema = z.object({
  capabilities: z.array(deviceCapabilitySchema).min(1),
});

export const devicePairingResponseSchema = z.object({
  pairingId: idSchema,
  /** Single-use code shown on the owner's screen; expires quickly. */
  code: z.string(),
  expiresAt: z.iso.datetime(),
  capabilities: z.array(deviceCapabilitySchema),
});

export const devicePairRequestSchema = z.object({
  code: z.string().min(8).max(64),
  deviceName: z.string().min(1).max(100),
});

export const deviceSchema = z.object({
  deviceId: idSchema,
  name: z.string(),
  capabilities: z.array(deviceCapabilitySchema),
  pairedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
});
export type Device = z.infer<typeof deviceSchema>;

export const devicePairedResponseSchema = deviceSchema.extend({
  /** Device credential, returned exactly once; never a wallet key. */
  deviceToken: z.string(),
});

export const deviceListResponseSchema = z.object({ devices: z.array(deviceSchema) });

export const operatorUserSummarySchema = z.object({
  user: z.object({
    id: idSchema,
    subject: z.string(),
    issuer: z.string(),
    createdAt: z.iso.datetime(),
    disabledAt: z.iso.datetime().nullable(),
  }),
  wallets: z.array(walletLinkSchema),
  credentials: z.array(apiCredentialSchema),
  devices: z.array(deviceSchema),
});

export const auditEventSchema = z.object({
  id: z.number().int(),
  occurredAt: z.iso.datetime(),
  actorClass: principalClassSchema,
  actorId: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  requestId: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;
