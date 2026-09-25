import { generateKeyPairSync } from 'node:crypto';
import { loadConfig } from '@markov/config';
import {
  bindPlatformIdentity,
  createDbClient,
  createPublication,
  createStrategy,
  createWalletChallenge,
  findPublicationById,
  findRegistryRecord,
  findVersionById,
  freezeVersion,
  linkWallet,
  readIndexerState,
  runMigrations,
  updatePublication,
  upsertUserBySubject,
  type VersionContent,
} from '@markov/db';
import { createSilentLogger } from '@markov/observability';
import {
  bytesToBase64,
  compileLegacyMessage,
  FixtureLedger,
  fetchForLedger,
  hexToBytes,
  recordAddress,
  registerVersionInstruction,
  registrationArgs,
  serializeMessage,
  signerFromPrivateKey,
  signTransaction,
  unsignedTransaction,
} from '@markov/registry';
import { SolanaRpcClient } from '@markov/solana-rpc';
import { baseTestEnv, testDatabaseUrl, withTemporaryDatabase } from '@markov/testkit';
import { describe, expect, it } from 'vitest';
import { runIndexerPass } from '../src/index.js';

const adminUrl = testDatabaseUrl();
const GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const PROGRAM_ID = '6SAPG2iavaEAv628NpuZuSwgKxGhqU23C769w7FfGpuZ';
const MINT_A = '62DEN6DTG3vrmCVKAwHsdjpmWM3u4esQjxmppUcXxnfv';
const MINT_B = '89JBaNKMcbL54KJB6scYRgrRm8GhaEtvfpeTqtvBDWnL';
const NOW = new Date('2026-09-25T12:00:00Z');
const AERO = '11111111-1111-4111-8111-111111111111';
const BIO = '22222222-2222-4222-8222-222222222222';

function build(aeroBps: number): VersionContent {
  const legs = [
    {
      instrumentId: AERO,
      weightBps: aeroBps,
      mint: MINT_A,
      tokenProgram: 'spl-token' as const,
      symbol: 'FXAERO',
    },
    {
      instrumentId: BIO,
      weightBps: 9000 - aeroBps,
      mint: MINT_B,
      tokenProgram: 'token-2022' as const,
      symbol: 'FXBIO',
    },
  ];
  return {
    schemaVersion: '1',
    kind: 'stock_spot_basket',
    authorPrincipal: 'user:test',
    title: 'Aerospace tilt',
    thesis: 'Launch cadence is underestimated.',
    thesisId: null,
    legs: legs.map((leg) => ({
      instrumentId: leg.instrumentId,
      weightBps: leg.weightBps,
      note: null,
      issuer: 'prestocks',
      symbol: leg.symbol,
      companyName: leg.symbol,
      admission: {
        status: 'admitted',
        admittedAt: NOW.toISOString(),
        verificationId: 1,
        verifiedAt: NOW.toISOString(),
        mint: leg.mint,
        tokenProgram: leg.tokenProgram,
        decimals: 6,
        genesisHash: GENESIS,
      },
    })),
    cashWeightBps: 1000,
    maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
    disclosures: { issuers: [], companies: [] },
    references: [],
    canonicalManifest: `{"aero":${aeroBps}}`,
    manifestHash: `${aeroBps.toString(16).padStart(4, '0')}${'a'.repeat(60)}`,
    contentDigest: `${aeroBps.toString(16).padStart(4, '0')}${'b'.repeat(60)}`,
  };
}

describe.skipIf(adminUrl === null)('registry indexer', () => {
  it('follows submitted publications to finality, mirrors every program record and records its state', async () => {
    if (adminUrl === null) {
      return;
    }
    await withTemporaryDatabase(adminUrl, async (url) => {
      const config = loadConfig(
        baseTestEnv({ DATABASE_URL: url, REGISTRY_PROGRAM_ID: PROGRAM_ID }),
      );
      const client = createDbClient({
        url,
        ssl: 'disable',
        poolMax: 4,
        statementTimeoutMs: 10_000,
        applicationName: 'indexer-test',
      });
      const ledger = new FixtureLedger({ programId: PROGRAM_ID, genesisHash: GENESIS });
      const rpc = new SolanaRpcClient({
        url: 'http://rpc.test',
        timeoutMs: 1000,
        maxResponseBytes: 1_000_000,
        fetchImpl: fetchForLedger(ledger),
      });
      const deps = {
        config,
        db: client.db,
        genesisHash: GENESIS,
        rpc,
        logger: createSilentLogger(),
      };
      try {
        await runMigrations(client.db);
        await bindPlatformIdentity(
          client.db,
          { markovEnv: 'test', solanaCluster: 'devnet', genesisHash: GENESIS },
          'indexer-test',
        );
        const user = await upsertUserBySubject(client.db, { issuer: 'test', subject: 'alice' });
        const signer = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
        ledger.fund(signer.publicKey, 1_000_000_000n);
        const challenge = await createWalletChallenge(client.db, {
          userId: user.id,
          address: signer.publicKey,
          chain: 'solana',
          genesisHash: GENESIS,
          nonce: 'n',
          message: 'm',
          expiresAt: new Date(Date.now() + 60_000),
        });
        const wallet = await linkWallet(client.db, {
          challengeId: challenge.id,
          userId: user.id,
          address: signer.publicKey,
          chain: 'solana',
          genesisHash: GENESIS,
        });
        const created = await createStrategy(client.db, {
          ownerUserId: user.id,
          content: {
            title: 'x',
            thesis: 'y',
            thesisId: null,
            kind: 'stock_spot_basket',
            legs: [{ instrumentId: AERO, weightBps: 6000, note: null }],
            cashWeightBps: 4000,
            maintenance: { suggestion: 'hold', driftThresholdBps: null, reviewEveryDays: null },
            references: [],
          },
          forkOf: null,
          now: NOW,
        });
        const frozen = await freezeVersion(client.db, {
          ownerUserId: user.id,
          strategyId: created.strategy.id,
          ifRevision: null,
          now: NOW,
          build: async () => build(6000),
        });
        if (frozen.outcome !== 'frozen') {
          throw new Error(`unexpected ${frozen.outcome}`);
        }
        const version = frozen.version;
        const args = registrationArgs({
          manifestHash: version.manifestHash,
          contentDigest: version.contentDigest,
          legs: version.legs.map((leg) => ({
            mint: leg.admission.mint,
            tokenProgram: leg.admission.tokenProgram as 'spl-token' | 'token-2022',
            weightBps: leg.weightBps,
          })),
          cashWeightBps: version.cashWeightBps,
          relation: 'none',
        });
        const blockhash = ledger.latestBlockhash();
        const message = compileLegacyMessage({
          feePayer: signer.publicKey,
          instructions: [
            registerVersionInstruction({
              programId: PROGRAM_ID,
              publisher: signer.publicKey,
              args,
            }),
          ],
          recentBlockhash: blockhash.blockhash,
        });
        const address = recordAddress(PROGRAM_ID, hexToBytes(version.manifestHash)).address;
        const publication = await createPublication(client.db, {
          versionId: version.id,
          strategyId: version.strategyId,
          ownerUserId: user.id,
          operation: 'register',
          programId: PROGRAM_ID,
          genesisHash: GENESIS,
          recordAddress: address,
          publisherWalletId: wallet.id,
          publisherAddress: signer.publicKey,
          manifestHash: version.manifestHash,
          contentDigest: version.contentDigest,
          unsignedTransaction: bytesToBase64(unsignedTransaction(message)),
          message: bytesToBase64(serializeMessage(message)),
          recentBlockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
          estimatedCostLamports: 6_686_600,
          now: NOW,
        });
        expect(publication.outcome).toBe('created');
        const signed = signTransaction(unsignedTransaction(message), signer);
        ledger.send(bytesToBase64(signed.bytes));
        await updatePublication(
          client.db,
          publication.publication.id,
          { state: 'submitted', signature: signed.signature, submittedAt: NOW },
          NOW,
        );

        // Not finalized yet: the publication stays submitted, but the record is already mirrored.
        const first = await runIndexerPass(deps);
        expect(first).toMatchObject({
          publicationsChecked: 1,
          publicationsChanged: 0,
          accountsObserved: 1,
          recordsIndexed: 1,
          errors: [],
        });
        expect((await findPublicationById(client.db, publication.publication.id))?.state).toBe(
          'submitted',
        );
        expect((await findRegistryRecord(client.db, address))?.versionId).toBe(version.id);
        expect((await findVersionById(client.db, version.id))?.publication).toBe('submitted');

        ledger.finalize();
        const second = await runIndexerPass(deps);
        expect(second).toMatchObject({
          publicationsChecked: 1,
          publicationsChanged: 1,
          accountsObserved: 1,
        });
        const done = await findPublicationById(client.db, publication.publication.id);
        expect(done).toMatchObject({ state: 'registered', confirmationStatus: 'finalized' });
        expect(done?.evidence).toMatchObject({
          signature: signed.signature,
          recordAddress: address,
        });
        expect(await findVersionById(client.db, version.id)).toMatchObject({
          publication: 'registered',
          publisherWallet: signer.publicKey,
        });
        expect((await findRegistryRecord(client.db, address))?.signature).toBe(signed.signature);
        expect(await readIndexerState(client.db, PROGRAM_ID)).toMatchObject({
          recordsIndexed: 1,
          lastError: null,
          lastObservedSlot: ledger.currentSlot,
        });

        // A permissionless record by someone else is mirrored without a version link.
        const stranger = signerFromPrivateKey(generateKeyPairSync('ed25519').privateKey);
        ledger.fund(stranger.publicKey, 1_000_000_000n);
        const foreign = registrationArgs({
          manifestHash: 'f'.repeat(64),
          contentDigest: 'e'.repeat(64),
          legs: [{ mint: MINT_A, tokenProgram: 'spl-token', weightBps: 10_000 }],
          cashWeightBps: 0,
          relation: 'none',
        });
        const foreignMessage = compileLegacyMessage({
          feePayer: stranger.publicKey,
          instructions: [
            registerVersionInstruction({
              programId: PROGRAM_ID,
              publisher: stranger.publicKey,
              args: foreign,
            }),
          ],
          recentBlockhash: ledger.latestBlockhash().blockhash,
        });
        ledger.send(
          bytesToBase64(signTransaction(unsignedTransaction(foreignMessage), stranger).bytes),
        );
        const third = await runIndexerPass(deps);
        expect(third).toMatchObject({ accountsObserved: 2, recordsIndexed: 2 });
        const foreignAddress = recordAddress(PROGRAM_ID, foreign.manifestHash).address;
        expect(await findRegistryRecord(client.db, foreignAddress)).toMatchObject({
          publisher: stranger.publicKey,
          versionId: null,
          signature: null,
        });

        // An outage is recorded, never mistaken for a failure.
        ledger.outage = true;
        const dark = await runIndexerPass(deps);
        expect(dark?.errors[0]).toContain('program accounts');
        expect((await readIndexerState(client.db, PROGRAM_ID))?.lastError).toContain(
          'program accounts',
        );
        expect((await findPublicationById(client.db, publication.publication.id))?.state).toBe(
          'registered',
        );
      } finally {
        await client.close();
      }
    });
  });

  it('is idle without a program id', async () => {
    if (adminUrl === null) {
      return;
    }
    await withTemporaryDatabase(adminUrl, async (url) => {
      const config = loadConfig(baseTestEnv({ DATABASE_URL: url }));
      const client = createDbClient({
        url,
        ssl: 'disable',
        poolMax: 2,
        statementTimeoutMs: 5_000,
        applicationName: 'idle',
      });
      try {
        await runMigrations(client.db);
        const rpc = new SolanaRpcClient({
          url: 'http://127.0.0.1:1',
          timeoutMs: 200,
          maxResponseBytes: 1000,
        });
        expect(
          await runIndexerPass({
            config,
            db: client.db,
            genesisHash: GENESIS,
            rpc,
            logger: createSilentLogger(),
          }),
        ).toBeNull();
      } finally {
        await client.close();
      }
    });
  });
});
