import type { AuditEvent, PrincipalClass } from '@markov/contracts';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import type { Database } from './client.js';
import { pgErrorCode } from './migrate.js';
import {
  apiCredentials,
  auditEvents,
  devicePairings,
  devices,
  sessions,
  users,
  walletChallenges,
  walletLinks,
} from './schema.js';

/**
 * Identity persistence. Every owner-facing function takes the owner's user
 * id and scopes its statement to it, so a caller can never reach another
 * account's rows by guessing an identifier. Secrets are stored hashed only.
 */

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type WalletChallengeRow = typeof walletChallenges.$inferSelect;
export type WalletLinkRow = typeof walletLinks.$inferSelect;
export type ApiCredentialRow = typeof apiCredentials.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type DevicePairingRow = typeof devicePairings.$inferSelect;

export class WalletAlreadyLinkedError extends Error {
  override readonly name = 'WalletAlreadyLinkedError';
}

export async function upsertUserBySubject(
  db: Database,
  input: { issuer: string; subject: string },
): Promise<UserRow> {
  await db
    .insert(users)
    .values({ issuer: input.issuer, subject: input.subject })
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.issuer, input.issuer), eq(users.subject, input.subject)))
    .limit(1);
  const row = rows[0];
  if (!row) {
    throw new Error('user upsert did not produce a row');
  }
  return row;
}

export async function findUserById(db: Database, userId: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

export async function createSession(
  db: Database,
  input: { userId: string; prefix: string; secretHash: string; authTime: Date; expiresAt: Date },
): Promise<SessionRow> {
  const rows = await db.insert(sessions).values(input).returning();
  const row = rows[0];
  if (!row) {
    throw new Error('session insert did not return a row');
  }
  return row;
}

export async function findSessionByPrefix(
  db: Database,
  prefix: string,
): Promise<(SessionRow & { user: UserRow }) | null> {
  const rows = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.prefix, prefix))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.session, user: row.user } : null;
}

export async function touchSession(db: Database, sessionId: string): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: sql`now()` }).where(eq(sessions.id, sessionId));
}

export async function revokeSession(
  db: Database,
  input: { sessionId: string; userId: string },
): Promise<boolean> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(sessions.id, input.sessionId),
        eq(sessions.userId, input.userId),
        isNull(sessions.revokedAt),
      ),
    )
    .returning({ id: sessions.id });
  return rows.length > 0;
}

export async function createWalletChallenge(
  db: Database,
  input: {
    userId: string;
    chain: string;
    genesisHash: string;
    address: string;
    nonce: string;
    message: string;
    expiresAt: Date;
  },
): Promise<WalletChallengeRow> {
  const rows = await db.insert(walletChallenges).values(input).returning();
  const row = rows[0];
  if (!row) {
    throw new Error('wallet challenge insert did not return a row');
  }
  return row;
}

/**
 * Atomically consume a challenge: only an unconsumed, unexpired challenge
 * that belongs to the caller and names the same address is returned. A
 * second call with the same challenge returns null (replay protection).
 */
export async function consumeWalletChallenge(
  db: Database,
  input: { challengeId: string; userId: string; address: string; now: Date },
): Promise<WalletChallengeRow | null> {
  const rows = await db
    .update(walletChallenges)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(walletChallenges.id, input.challengeId),
        eq(walletChallenges.userId, input.userId),
        eq(walletChallenges.address, input.address),
        isNull(walletChallenges.consumedAt),
        gt(walletChallenges.expiresAt, input.now),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function linkWallet(
  db: Database,
  input: {
    userId: string;
    chain: string;
    genesisHash: string;
    address: string;
    challengeId: string;
  },
): Promise<WalletLinkRow> {
  try {
    const rows = await db.insert(walletLinks).values(input).returning();
    const row = rows[0];
    if (!row) {
      throw new Error('wallet link insert did not return a row');
    }
    return row;
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new WalletAlreadyLinkedError('this wallet is already linked to an account');
    }
    throw error;
  }
}

export async function listWallets(db: Database, userId: string): Promise<WalletLinkRow[]> {
  return db
    .select()
    .from(walletLinks)
    .where(and(eq(walletLinks.userId, userId), isNull(walletLinks.unlinkedAt)))
    .orderBy(walletLinks.verifiedAt);
}

export async function unlinkWallet(
  db: Database,
  input: { walletId: string; userId: string },
): Promise<WalletLinkRow | null> {
  const rows = await db
    .update(walletLinks)
    .set({ unlinkedAt: sql`now()` })
    .where(
      and(
        eq(walletLinks.id, input.walletId),
        eq(walletLinks.userId, input.userId),
        isNull(walletLinks.unlinkedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function createApiCredential(
  db: Database,
  input: {
    userId: string | null;
    principalClass: 'agent' | 'operator';
    label: string;
    prefix: string;
    secretHash: string;
    scopes: readonly string[];
    expiresAt: Date;
  },
): Promise<ApiCredentialRow> {
  const rows = await db
    .insert(apiCredentials)
    .values({ ...input, scopes: [...input.scopes] })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('credential insert did not return a row');
  }
  return row;
}

export async function findApiCredentialByPrefix(
  db: Database,
  prefix: string,
): Promise<ApiCredentialRow | null> {
  const rows = await db
    .select()
    .from(apiCredentials)
    .where(eq(apiCredentials.prefix, prefix))
    .limit(1);
  return rows[0] ?? null;
}

export async function touchApiCredential(db: Database, credentialId: string): Promise<void> {
  await db
    .update(apiCredentials)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(apiCredentials.id, credentialId));
}

export async function listApiCredentials(
  db: Database,
  userId: string,
): Promise<ApiCredentialRow[]> {
  return db
    .select()
    .from(apiCredentials)
    .where(eq(apiCredentials.userId, userId))
    .orderBy(desc(apiCredentials.createdAt));
}

/** Owner revocation (userId set) or operator revocation (userId null) of an agent credential. */
export async function revokeApiCredential(
  db: Database,
  input: { credentialId: string; userId: string | null },
): Promise<ApiCredentialRow | null> {
  const ownerCondition =
    input.userId === null
      ? eq(apiCredentials.principalClass, 'agent')
      : eq(apiCredentials.userId, input.userId);
  const rows = await db
    .update(apiCredentials)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(apiCredentials.id, input.credentialId),
        ownerCondition,
        isNull(apiCredentials.revokedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function createDevicePairing(
  db: Database,
  input: { userId: string; codeHash: string; capabilities: readonly string[]; expiresAt: Date },
): Promise<DevicePairingRow> {
  const rows = await db
    .insert(devicePairings)
    .values({ ...input, capabilities: [...input.capabilities] })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('device pairing insert did not return a row');
  }
  return row;
}

/** Single use: the first device to present a valid code wins; the code cannot be reused. */
export async function consumeDevicePairing(
  db: Database,
  input: { codeHash: string; now: Date },
): Promise<DevicePairingRow | null> {
  const rows = await db
    .update(devicePairings)
    .set({ consumedAt: input.now })
    .where(
      and(
        eq(devicePairings.codeHash, input.codeHash),
        isNull(devicePairings.consumedAt),
        gt(devicePairings.expiresAt, input.now),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function createDevice(
  db: Database,
  input: {
    userId: string;
    pairingId: string;
    name: string;
    capabilities: readonly string[];
    prefix: string;
    secretHash: string;
  },
): Promise<DeviceRow> {
  const rows = await db
    .insert(devices)
    .values({ ...input, capabilities: [...input.capabilities] })
    .returning();
  const row = rows[0];
  if (!row) {
    throw new Error('device insert did not return a row');
  }
  return row;
}

export async function findDeviceByPrefix(db: Database, prefix: string): Promise<DeviceRow | null> {
  const rows = await db.select().from(devices).where(eq(devices.prefix, prefix)).limit(1);
  return rows[0] ?? null;
}

export async function listDevices(db: Database, userId: string): Promise<DeviceRow[]> {
  return db
    .select()
    .from(devices)
    .where(eq(devices.userId, userId))
    .orderBy(desc(devices.pairedAt));
}

export async function revokeDevice(
  db: Database,
  input: { deviceId: string; userId: string },
): Promise<DeviceRow | null> {
  const rows = await db
    .update(devices)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(devices.id, input.deviceId),
        eq(devices.userId, input.userId),
        isNull(devices.revokedAt),
      ),
    )
    .returning();
  return rows[0] ?? null;
}

export async function touchDevice(db: Database, deviceId: string): Promise<void> {
  await db.update(devices).set({ lastSeenAt: sql`now()` }).where(eq(devices.id, deviceId));
}

export async function recordAuditEvent(
  db: Database,
  input: {
    actorClass: PrincipalClass;
    actorId: string;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string | null;
    details?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(auditEvents).values({ ...input, details: input.details ?? {} });
}

export async function listAuditEvents(
  db: Database,
  input: { limit: number; targetType?: string; targetId?: string },
): Promise<AuditEvent[]> {
  const conditions = [];
  if (input.targetType) {
    conditions.push(eq(auditEvents.targetType, input.targetType));
  }
  if (input.targetId) {
    conditions.push(eq(auditEvents.targetId, input.targetId));
  }
  const rows = await db
    .select()
    .from(auditEvents)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditEvents.id))
    .limit(input.limit);
  return rows.map((row) => ({
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorClass: row.actorClass as PrincipalClass,
    actorId: row.actorId,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    requestId: row.requestId,
    details: row.details,
  }));
}
