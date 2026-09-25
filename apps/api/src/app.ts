import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import type { MarkovConfig } from '@markov/config';
import {
  type BoundPlatformIdentity,
  type CapabilityReadiness,
  CONTRACT_SCHEMA_VERSION,
  ERROR_HTTP_STATUS,
  type ErrorCode,
  type ErrorResponse,
  healthResponseSchema,
  platformInfoResponseSchema,
  type ReadinessCheck,
  type ReadinessResponse,
  readinessResponseSchema,
} from '@markov/contracts';
import type { Logger } from '@markov/observability';
import Fastify, { type FastifyError, type FastifyReply, LogController } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { authPlugin } from './auth/plugin.js';
import type { IdentityService } from './auth/service.js';
import type { CatalogService } from './catalog/service.js';
import { ApiError } from './errors.js';
import type { FundingService } from './funding/service.js';
import type { NetworkIdentitySource } from './network-monitor.js';
import type { PolicyService } from './policy/service.js';
import type { RegistryService } from './registry/service.js';
import type { ResearchService } from './research/service.js';
import { catalogRoutes } from './routes/catalog.js';
import { fundingRoutes } from './routes/funding.js';
import { identityRoutes } from './routes/identity.js';
import { policyRoutes } from './routes/policy.js';
import { registryRoutes } from './routes/registry.js';
import { researchRoutes } from './routes/research.js';
import { strategyRoutes } from './routes/strategies.js';
import { watchlistRoutes } from './routes/watchlists.js';
import type { StrategyService } from './strategies/service.js';
import type { WatchlistService } from './watchlists/service.js';

export interface ProbeOutcome {
  readonly ok: boolean;
  /** Secret-free, operator-facing detail. */
  readonly detail: string;
  readonly durationMs: number;
}

export interface ApiProbes {
  database(): Promise<ProbeOutcome>;
  schema(): Promise<ProbeOutcome & { readonly latestTag: string | null }>;
  platformIdentity(): Promise<ProbeOutcome & { readonly identity: BoundPlatformIdentity | null }>;
  capabilities(): Promise<CapabilityReadiness[]>;
}

export interface ServiceInfo {
  readonly name: string;
  readonly version: string;
  readonly startedAt: number;
}

export interface AppDependencies {
  readonly config: MarkovConfig;
  readonly logger: Logger;
  readonly service: ServiceInfo;
  readonly probes: ApiProbes;
  readonly network: NetworkIdentitySource;
  /** Genesis hash the process is bound to; null only for an unbound localnet export. */
  readonly expectedGenesisHash: string | null;
  readonly identity: IdentityService;
  readonly catalog: CatalogService;
  readonly policy: PolicyService;
  readonly funding: FundingService;
  readonly research: ResearchService;
  readonly watchlists: WatchlistService;
  readonly strategies: StrategyService;
  readonly registry: RegistryService;
  /** Nonproduction only: mints identity tokens from the in-process test issuer. */
  readonly mintTestToken:
    | ((input: { subject: string; authTime?: string }) => Promise<string>)
    | null;
}

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function errorBody(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ErrorResponse['error']['details'],
): ErrorResponse {
  return { error: { code, message, requestId, ...(details ? { details } : {}) } };
}

function sendError(
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: ErrorResponse['error']['details'],
) {
  return reply
    .code(ERROR_HTTP_STATUS[code])
    .type('application/json; charset=utf-8')
    .send(errorBody(code, message, requestId, details));
}

async function timed<T extends ProbeOutcome>(
  probe: () => Promise<T>,
  name: string,
): Promise<T | ProbeOutcome> {
  const started = Date.now();
  try {
    return await probe();
  } catch (error) {
    return {
      ok: false,
      detail: `${name} probe threw: ${error instanceof Error ? error.message.slice(0, 200) : 'unknown error'}`,
      durationMs: Date.now() - started,
    };
  }
}

function check(outcome: ProbeOutcome, observedAt: string): ReadinessCheck {
  return {
    status: outcome.ok ? 'pass' : 'fail',
    required: true,
    detail: outcome.detail,
    observedAt,
    durationMs: outcome.durationMs,
  };
}

export async function computeReadiness(deps: AppDependencies): Promise<ReadinessResponse> {
  const now = new Date().toISOString();
  const [database, schema, identity] = await Promise.all([
    timed(deps.probes.database, 'database'),
    timed(deps.probes.schema, 'schema'),
    timed(deps.probes.platformIdentity, 'platform identity'),
  ]);
  const network = deps.network.snapshot();
  const networkCheck: ReadinessCheck = {
    status:
      network.status === 'verified'
        ? 'pass'
        : network.status === 'mismatch'
          ? 'fail'
          : 'unverified',
    required: true,
    detail: network.detail,
    observedAt: network.checkedAt,
    durationMs: network.durationMs,
  };
  const checks: Record<string, ReadinessCheck> = {
    database: check(database, now),
    schema: check(schema, now),
    platform_identity: check(identity, now),
    solana_rpc: networkCheck,
  };
  const ready = Object.values(checks).every((item) => !item.required || item.status === 'pass');
  return {
    status: ready ? 'ready' : 'not_ready',
    service: deps.service.name,
    timestamp: now,
    checks,
    platform: {
      markovEnv: deps.config.markovEnv,
      solanaCluster: deps.config.solana.cluster,
      expectedGenesisHash: deps.expectedGenesisHash,
      observedGenesisHash: network.observedGenesisHash,
      schemaVersion: 'latestTag' in schema ? schema.latestTag : null,
    },
  };
}

export async function buildApp(deps: AppDependencies) {
  const { config } = deps;
  const app = Fastify({
    loggerInstance: deps.logger.child({ component: 'http' }),
    genReqId: (request) => {
      const header = request.headers['x-request-id'];
      return typeof header === 'string' && REQUEST_ID_PATTERN.test(header) ? header : randomUUID();
    },
    logController: new LogController({ requestIdLogLabel: 'requestId' }),
    trustProxy: config.api.trustProxy,
    bodyLimit: config.api.bodyLimitBytes,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    forceCloseConnections: 'idle',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, { global: true });
  await app.register(cors, {
    origin: config.api.allowedOrigins.length === 0 ? false : [...config.api.allowedOrigins],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    maxAge: 600,
  });
  await app.register(rateLimit, {
    global: true,
    max: config.api.rateLimitMaxPerMinute,
    timeWindow: '1 minute',
  });
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'Markov API',
        description:
          'Proposed Markov contracts. Schemas are generated from the runtime validators; see docs/markov/api.md.',
        version: `${CONTRACT_SCHEMA_VERSION}.0.0`,
      },
      tags: [
        { name: 'platform', description: 'Service health, readiness and platform identity' },
        { name: 'identity', description: 'Accounts, sessions, wallets, credentials and devices' },
        { name: 'catalog', description: 'Instrument catalog, mint verification and lifecycle' },
        {
          name: 'policy',
          description:
            'Eligibility, terms, limits, capability states and deterministic trading policy',
        },
        {
          name: 'research',
          description:
            'Sourced theses, safe source retrieval, company mapping and bounded model runs',
        },
        { name: 'watchlists', description: 'Personal, versioned lists of catalog instruments' },
        {
          name: 'strategies',
          description: 'Versioned recipes: drafts, immutable versions, forks and pinned instances',
        },
        {
          name: 'registry',
          description:
            'On-chain registration of frozen versions: prepare, sign with the owner wallet, submit, verify; public views with chain evidence',
        },
      ],
    },
    transform: jsonSchemaTransform,
  });

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  app.setNotFoundHandler((request, reply) => {
    return sendError(reply, 'NOT_FOUND', 'no such route', request.id);
  });

  app.setErrorHandler((error: unknown, request, reply) => {
    if (error instanceof ApiError) {
      return sendError(reply, error.code, error.message, request.id, error.details);
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return sendError(
        reply,
        'VALIDATION_FAILED',
        'request did not match the contract',
        request.id,
        error.validation.map((issue) => ({
          path: `${error.validationContext ?? 'request'}${issue.instancePath}`,
          message: issue.message ?? 'invalid',
        })),
      );
    }
    if (isResponseSerializationError(error)) {
      request.log.error({ err: error }, 'response failed contract serialization');
      return sendError(reply, 'INTERNAL', 'response did not match the contract', request.id);
    }
    const fastifyError = error as Partial<FastifyError>;
    const statusCode = typeof fastifyError.statusCode === 'number' ? fastifyError.statusCode : 500;
    if (statusCode === 429) {
      return sendError(reply, 'RATE_LIMITED', 'too many requests', request.id);
    }
    if (statusCode === 404) {
      return sendError(reply, 'NOT_FOUND', 'no such route', request.id);
    }
    if (statusCode === 413) {
      return sendError(reply, 'VALIDATION_FAILED', 'payload too large', request.id);
    }
    if (statusCode === 415) {
      return sendError(reply, 'VALIDATION_FAILED', 'unsupported media type', request.id);
    }
    if (statusCode >= 400 && statusCode < 500) {
      return sendError(
        reply,
        'VALIDATION_FAILED',
        (fastifyError.message ?? 'bad request').slice(0, 300),
        request.id,
      );
    }
    request.log.error({ err: error }, 'unhandled error');
    return sendError(reply, 'INTERNAL', 'unexpected error', request.id);
  });

  app.get(
    '/healthz',
    {
      schema: {
        tags: ['platform'],
        summary: 'Liveness',
        description: 'The process is running. Says nothing about dependencies.',
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({
      status: 'ok' as const,
      service: deps.service.name,
      version: deps.service.version,
      uptimeSeconds: Math.floor((Date.now() - deps.service.startedAt) / 1000),
      timestamp: new Date().toISOString(),
    }),
  );

  app.get(
    '/readyz',
    {
      schema: {
        tags: ['platform'],
        summary: 'Readiness',
        description:
          'Every required dependency check passes: database, schema, platform identity and Solana network identity. 503 otherwise.',
        response: { 200: readinessResponseSchema, 503: readinessResponseSchema },
      },
    },
    async (_request, reply) => {
      const readiness = await computeReadiness(deps);
      reply.code(readiness.status === 'ready' ? 200 : 503);
      return readiness;
    },
  );

  app.get(
    '/v1/platform',
    {
      schema: {
        tags: ['platform'],
        summary: 'Platform identity and capability readiness',
        description:
          'Secret-free description of the running platform, including the verification state of every capability.',
        response: { 200: platformInfoResponseSchema },
      },
    },
    async () => {
      const [identityProbe, capabilities] = await Promise.all([
        timed(deps.probes.platformIdentity, 'platform identity'),
        deps.probes.capabilities(),
      ]);
      const identity = 'identity' in identityProbe ? identityProbe.identity : null;
      return {
        service: deps.service.name,
        version: deps.service.version,
        contractSchemaVersion: CONTRACT_SCHEMA_VERSION,
        identity:
          identity === null
            ? null
            : {
                markovEnv: identity.markovEnv,
                solanaCluster: identity.solanaCluster,
                genesisHash: identity.genesisHash,
              },
        identityProvider: config.identity.provider,
        executionWritesEnabled: config.execution.writesEnabled,
        capabilities,
      };
    },
  );

  app.get('/openapi.json', { schema: { hide: true } }, async () => app.swagger());

  await app.register(authPlugin, { authenticate: (bearer) => deps.identity.authenticate(bearer) });
  await app.register(identityRoutes, {
    identity: deps.identity,
    mintTestToken: deps.mintTestToken,
  });
  await app.register(catalogRoutes, { catalog: deps.catalog });
  await app.register(policyRoutes, { policy: deps.policy });
  await app.register(fundingRoutes, { funding: deps.funding });
  await app.register(researchRoutes, { research: deps.research });
  await app.register(watchlistRoutes, { watchlists: deps.watchlists });
  await app.register(strategyRoutes, { strategies: deps.strategies });
  await app.register(registryRoutes, { registry: deps.registry });

  return app;
}

export type MarkovApi = Awaited<ReturnType<typeof buildApp>>;
