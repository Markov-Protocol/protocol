import { createHmac, randomBytes } from 'node:crypto';
import {
  buildWalletChallengeMessage,
  generateChallengeNonce,
  generateCredential,
  hashCredentialSecret,
  IdentityTokenError,
  type IdentityVerifier,
  isStepUpFresh,
  OWNER_SCOPE,
  type Principal,
  parseCredentialToken,
  secretHashesMatch,
  verifyWalletSignature,
} from '@markov/auth';
import type { MarkovConfig } from '@markov/config';
import {
  type ApiCredential,
  type Device,
  type DeviceCapability,
  encodeBase58,
  type MeResponse,
  type SessionResponse,
  type WalletChallengeResponse,
  type WalletLink,
} from '@markov/contracts';
import {
  type ApiCredentialRow,
  consumeDevicePairing,
  consumeWalletChallenge,
  createApiCredential,
  createDevice,
  createDevicePairing,
  createSession,
  createWalletChallenge,
  type Database,
  type DeviceRow,
  findApiCredentialByPrefix,
  findDeviceByPrefix,
  findSessionByPrefix,
  findUserById,
  linkWallet,
  listApiCredentials,
  listAuditEvents,
  listDevices,
  listWallets,
  recordAuditEvent,
  recordMarkEvent,
  revokeApiCredential,
  revokeDevice,
  revokeSession,
  touchApiCredential,
  touchDevice,
  touchSession,
  unlinkWallet,
  upsertUserBySubject,
  WalletAlreadyLinkedError,
  type WalletLinkRow,
} from '@markov/db';
import { ApiError } from '../errors.js';

export interface IdentityServiceOptions {
  readonly config: MarkovConfig;
  readonly db: Database;
  readonly verifier: IdentityVerifier;
  /** Genesis hash the running process is bound to (from the platform identity). */
  readonly genesisHash: string;
  readonly now?: () => Date;
}

function toWalletLink(row: WalletLinkRow): WalletLink {
  return {
    walletId: row.id,
    chain: 'solana',
    genesisHash: row.genesisHash,
    address: row.address,
    verifiedAt: row.verifiedAt.toISOString(),
  };
}

function toCredential(row: ApiCredentialRow): ApiCredential {
  return {
    credentialId: row.id,
    label: row.label,
    prefix: row.prefix,
    scopes: row.scopes,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    revokedAt: row.revokedAt?.toISOString() ?? null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  };
}

function toDevice(row: DeviceRow): Device {
  return {
    deviceId: row.id,
    name: row.name,
    capabilities: row.capabilities as Device['capabilities'],
    pairedAt: row.pairedAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;

/**
 * All identity operations. Every method takes the verified principal and
 * scopes its reads and writes to that principal's own resources; another
 * account's resources are indistinguishable from missing ones.
 */
export function createIdentityService(options: IdentityServiceOptions) {
  const { config, db, verifier } = options;
  const now = options.now ?? (() => new Date());
  const pepper = config.auth.credentialPepper;

  const audit = (input: {
    actor: Principal | { class: 'device' | 'user'; id: string };
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    details?: Record<string, unknown>;
  }) =>
    recordAuditEvent(db, {
      actorClass: input.actor.class,
      actorId: input.actor.id,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      requestId: input.requestId,
      ...(input.details ? { details: input.details } : {}),
    });

  const requireUserId = (principal: Principal): string => {
    if (principal.class !== 'user' || principal.userId === null) {
      throw new ApiError('FORBIDDEN', 'this operation requires an interactive user session');
    }
    return principal.userId;
  };

  const requireStepUp = (principal: Principal): string => {
    const userId = requireUserId(principal);
    if (!isStepUpFresh(principal, config.auth.stepUpMaxAgeSeconds, now())) {
      throw new ApiError('STEP_UP_REQUIRED', 'sign in again to change security settings');
    }
    return userId;
  };

  return {
    async exchangeIdentityToken(
      identityToken: string,
      requestId: string,
    ): Promise<SessionResponse> {
      let identity: Awaited<ReturnType<IdentityVerifier['verify']>>;
      try {
        identity = await verifier.verify(identityToken);
      } catch (error) {
        if (error instanceof IdentityTokenError) {
          throw new ApiError('AUTH_REQUIRED', `identity token rejected (${error.kind})`);
        }
        throw error;
      }
      const user = await upsertUserBySubject(db, {
        issuer: identity.issuer,
        subject: identity.subject,
      });
      if (user.disabledAt !== null) {
        throw new ApiError('FORBIDDEN', 'this account is disabled');
      }
      const credential = generateCredential('session', pepper);
      const expiresAt = new Date(now().getTime() + config.auth.sessionTtlSeconds * 1000);
      const session = await createSession(db, {
        userId: user.id,
        prefix: credential.prefix,
        secretHash: credential.secretHash,
        authTime: identity.authTime,
        expiresAt,
      });
      await audit({
        actor: { class: 'user', id: user.id },
        action: 'session.created',
        targetType: 'session',
        targetId: session.id,
        requestId,
      });
      return {
        sessionId: session.id,
        sessionToken: credential.token,
        expiresAt: expiresAt.toISOString(),
        authTime: identity.authTime.toISOString(),
      };
    },

    /** Resolve a bearer token to a principal; null means the token is unknown, expired or revoked. */
    async authenticate(bearer: string): Promise<Principal | null> {
      const parsed = parseCredentialToken(bearer);
      if (!parsed) {
        return null;
      }
      const secretHash = hashCredentialSecret(parsed.secret, pepper);
      const current = now();
      if (parsed.kind === 'session') {
        const session = await findSessionByPrefix(db, parsed.prefix);
        if (
          !session ||
          !secretHashesMatch(session.secretHash, secretHash) ||
          session.revokedAt !== null ||
          session.expiresAt <= current ||
          session.user.disabledAt !== null
        ) {
          return null;
        }
        void touchSession(db, session.id).catch(() => undefined);
        return {
          class: 'user',
          id: session.userId,
          userId: session.userId,
          scopes: [OWNER_SCOPE],
          authTime: session.authTime,
          sessionId: session.id,
          sessionExpiresAt: session.expiresAt,
          credentialId: null,
        };
      }
      if (parsed.kind === 'agent' || parsed.kind === 'operator' || parsed.kind === 'worker') {
        const credential = await findApiCredentialByPrefix(db, parsed.prefix);
        if (
          !credential ||
          credential.principalClass !== parsed.kind ||
          !secretHashesMatch(credential.secretHash, secretHash) ||
          credential.revokedAt !== null ||
          credential.expiresAt <= current
        ) {
          return null;
        }
        void touchApiCredential(db, credential.id).catch(() => undefined);
        return {
          class: parsed.kind,
          id: credential.id,
          userId: credential.userId,
          scopes: credential.scopes,
          authTime: null,
          sessionId: null,
          sessionExpiresAt: null,
          credentialId: credential.id,
        };
      }
      const device = await findDeviceByPrefix(db, parsed.prefix);
      if (
        !device ||
        !secretHashesMatch(device.secretHash, secretHash) ||
        device.revokedAt !== null
      ) {
        return null;
      }
      void touchDevice(db, device.id).catch(() => undefined);
      return {
        class: 'device',
        id: device.id,
        userId: device.userId,
        scopes: device.capabilities,
        authTime: null,
        sessionId: null,
        sessionExpiresAt: null,
        credentialId: null,
      };
    },

    async logout(principal: Principal, requestId: string): Promise<void> {
      const userId = requireUserId(principal);
      if (principal.sessionId) {
        await revokeSession(db, { sessionId: principal.sessionId, userId });
        await audit({
          actor: principal,
          action: 'session.revoked',
          targetType: 'session',
          targetId: principal.sessionId,
          requestId,
        });
      }
    },

    async me(principal: Principal): Promise<MeResponse> {
      const user = principal.userId ? await findUserById(db, principal.userId) : null;
      return {
        principal: {
          class: principal.class,
          id: principal.id,
          userId: principal.userId,
          scopes: [...principal.scopes],
          authTime: principal.authTime?.toISOString() ?? null,
          stepUpFresh: isStepUpFresh(principal, config.auth.stepUpMaxAgeSeconds, now()),
        },
        user: user
          ? {
              id: user.id,
              subject: user.subject,
              issuer: user.issuer,
              createdAt: user.createdAt.toISOString(),
            }
          : null,
        session:
          principal.sessionId && principal.sessionExpiresAt
            ? {
                sessionId: principal.sessionId,
                expiresAt: principal.sessionExpiresAt.toISOString(),
              }
            : null,
      };
    },

    async createWalletChallenge(
      principal: Principal,
      address: string,
      requestId: string,
    ): Promise<WalletChallengeResponse> {
      const userId = requireStepUp(principal);
      const issuedAt = now();
      const expiresAt = new Date(issuedAt.getTime() + config.auth.walletChallengeTtlSeconds * 1000);
      const nonce = generateChallengeNonce();
      const message = buildWalletChallengeMessage({
        domain: config.auth.walletChallengeDomain,
        address,
        chain: 'solana',
        genesisHash: options.genesisHash,
        userId,
        nonce,
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      const challenge = await createWalletChallenge(db, {
        userId,
        chain: 'solana',
        genesisHash: options.genesisHash,
        address,
        nonce,
        message,
        expiresAt,
      });
      await audit({
        actor: principal,
        action: 'wallet.challenge.created',
        targetType: 'wallet_challenge',
        targetId: challenge.id,
        requestId,
        details: { address },
      });
      return { challengeId: challenge.id, message, expiresAt: expiresAt.toISOString() };
    },

    async linkWallet(
      principal: Principal,
      input: { challengeId: string; address: string; signature: string },
      requestId: string,
    ): Promise<WalletLink> {
      const userId = requireStepUp(principal);
      const challenge = await consumeWalletChallenge(db, {
        challengeId: input.challengeId,
        userId,
        address: input.address,
        now: now(),
      });
      if (!challenge) {
        throw new ApiError(
          'CHALLENGE_INVALID',
          'the challenge is unknown, expired, already used, or belongs to another account or address',
        );
      }
      if (
        !verifyWalletSignature({
          address: input.address,
          message: challenge.message,
          signature: input.signature,
        })
      ) {
        await audit({
          actor: principal,
          action: 'wallet.link.rejected',
          targetType: 'wallet_challenge',
          targetId: challenge.id,
          requestId,
          details: { reason: 'signature' },
        });
        throw new ApiError(
          'SIGNATURE_MISMATCH',
          'the signature does not verify for this address and challenge',
        );
      }
      try {
        const link = await linkWallet(db, {
          userId,
          chain: 'solana',
          genesisHash: challenge.genesisHash,
          address: input.address,
          challengeId: challenge.id,
        });
        await audit({
          actor: principal,
          action: 'wallet.linked',
          targetType: 'wallet',
          targetId: link.id,
          requestId,
          details: { address: input.address },
        });
        return toWalletLink(link);
      } catch (error) {
        if (error instanceof WalletAlreadyLinkedError) {
          throw new ApiError(
            'WALLET_ALREADY_LINKED',
            'this wallet is linked to another account; unlink it there first',
          );
        }
        throw error;
      }
    },

    async listWallets(principal: Principal): Promise<WalletLink[]> {
      if (principal.userId === null) {
        throw new ApiError('FORBIDDEN', 'no account is associated with this credential');
      }
      return (await listWallets(db, principal.userId)).map(toWalletLink);
    },

    async unlinkWallet(principal: Principal, walletId: string, requestId: string): Promise<void> {
      const userId = requireStepUp(principal);
      const removed = await unlinkWallet(db, { walletId, userId });
      if (!removed) {
        throw new ApiError('NOT_FOUND', 'no such wallet');
      }
      await audit({
        actor: principal,
        action: 'wallet.unlinked',
        targetType: 'wallet',
        targetId: walletId,
        requestId,
      });
    },

    async createApiCredential(
      principal: Principal,
      input: { label: string; scopes: readonly string[]; expiresInSeconds: number },
      requestId: string,
    ): Promise<ApiCredential & { token: string }> {
      const userId = requireStepUp(principal);
      const generated = generateCredential('agent', pepper);
      const row = await createApiCredential(db, {
        userId,
        principalClass: 'agent',
        label: input.label,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
        scopes: input.scopes,
        expiresAt: new Date(now().getTime() + input.expiresInSeconds * 1000),
      });
      await audit({
        actor: principal,
        action: 'credential.created',
        targetType: 'api_credential',
        targetId: row.id,
        requestId,
        details: { scopes: input.scopes },
      });
      return { ...toCredential(row), token: generated.token };
    },

    async listApiCredentials(principal: Principal): Promise<ApiCredential[]> {
      const userId = requireUserId(principal);
      return (await listApiCredentials(db, userId)).map(toCredential);
    },

    async revokeApiCredential(
      principal: Principal,
      credentialId: string,
      requestId: string,
    ): Promise<void> {
      const userId = requireStepUp(principal);
      const revoked = await revokeApiCredential(db, { credentialId, userId });
      if (!revoked) {
        throw new ApiError('NOT_FOUND', 'no such credential');
      }
      await audit({
        actor: principal,
        action: 'credential.revoked',
        targetType: 'api_credential',
        targetId: credentialId,
        requestId,
      });
    },

    async createDevicePairing(
      principal: Principal,
      capabilities: readonly DeviceCapability[],
      requestId: string,
    ): Promise<{
      pairingId: string;
      code: string;
      expiresAt: string;
      capabilities: DeviceCapability[];
    }> {
      const userId = requireStepUp(principal);
      const code = encodeBase58(randomBytes(9));
      const expiresAt = new Date(now().getTime() + 5 * 60_000);
      const pairing = await createDevicePairing(db, {
        userId,
        codeHash: createHmac('sha256', pepper).update(code).digest('hex'),
        capabilities,
        expiresAt,
      });
      await audit({
        actor: principal,
        action: 'device.pairing.created',
        targetType: 'device_pairing',
        targetId: pairing.id,
        requestId,
        details: { capabilities },
      });
      return {
        pairingId: pairing.id,
        code,
        expiresAt: expiresAt.toISOString(),
        capabilities: [...capabilities],
      };
    },

    async pairDevice(
      input: { code: string; deviceName: string },
      requestId: string,
    ): Promise<Device & { deviceToken: string }> {
      const pairing = await consumeDevicePairing(db, {
        codeHash: createHmac('sha256', pepper).update(input.code).digest('hex'),
        now: now(),
      });
      if (!pairing) {
        throw new ApiError(
          'CHALLENGE_INVALID',
          'the pairing code is unknown, expired or already used',
        );
      }
      const generated = generateCredential('device', pepper);
      const device = await createDevice(db, {
        userId: pairing.userId,
        pairingId: pairing.id,
        name: input.deviceName,
        capabilities: pairing.capabilities,
        prefix: generated.prefix,
        secretHash: generated.secretHash,
      });
      await audit({
        actor: { class: 'device', id: device.id },
        action: 'device.paired',
        targetType: 'device',
        targetId: device.id,
        requestId,
        details: { userId: pairing.userId },
      });
      return { ...toDevice(device), deviceToken: generated.token };
    },

    async listDevices(principal: Principal): Promise<Device[]> {
      const userId = requireUserId(principal);
      return (await listDevices(db, userId)).map(toDevice);
    },

    async revokeDevice(principal: Principal, deviceId: string, requestId: string): Promise<void> {
      const userId = requireStepUp(principal);
      const revoked = await revokeDevice(db, { deviceId, userId });
      if (!revoked) {
        throw new ApiError('NOT_FOUND', 'no such device');
      }
      await audit({
        actor: principal,
        action: 'device.revoked',
        targetType: 'device',
        targetId: deviceId,
        requestId,
      });
      // The owner's Mark I event (B15): every surface learns the device may no longer act.
      await recordMarkEvent(db, {
        ownerUserId: userId,
        kind: 'device.revoked',
        subject: { type: 'device', id: deviceId },
        payload: { deviceId, name: revoked.name, capabilities: revoked.capabilities },
        now: now(),
      });
    },

    async operatorUserSummary(userId: string) {
      const user = await findUserById(db, userId);
      if (!user) {
        throw new ApiError('NOT_FOUND', 'no such user');
      }
      const [wallets, credentials, deviceRows] = await Promise.all([
        listWallets(db, userId),
        listApiCredentials(db, userId),
        listDevices(db, userId),
      ]);
      return {
        user: {
          id: user.id,
          subject: user.subject,
          issuer: user.issuer,
          createdAt: user.createdAt.toISOString(),
          disabledAt: user.disabledAt?.toISOString() ?? null,
        },
        wallets: wallets.map(toWalletLink),
        credentials: credentials.map(toCredential),
        devices: deviceRows.map(toDevice),
      };
    },

    async operatorRevokeCredential(
      principal: Principal,
      credentialId: string,
      requestId: string,
    ): Promise<void> {
      const revoked = await revokeApiCredential(db, { credentialId, userId: null });
      if (!revoked) {
        throw new ApiError('NOT_FOUND', 'no such agent credential');
      }
      await audit({
        actor: principal,
        action: 'credential.revoked.by-operator',
        targetType: 'api_credential',
        targetId: credentialId,
        requestId,
      });
    },

    operatorAuditEvents(limit: number) {
      return listAuditEvents(db, { limit });
    },
  };
}
