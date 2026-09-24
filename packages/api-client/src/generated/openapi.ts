// Generated from docs/markov/openapi.json by packages/api-client/scripts/generate.mjs.
// Do not edit by hand; run `pnpm api-client:generate` after the API contract changes.
export type paths = {
    readonly "/healthz": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Liveness
         * @description The process is running. Says nothing about dependencies.
         */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** @enum {string} */
                            readonly status: "ok";
                            readonly service: string;
                            readonly version: string;
                            readonly uptimeSeconds: number;
                            /** Format: date-time */
                            readonly timestamp: string;
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/readyz": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Readiness
         * @description Every required dependency check passes: database, schema, platform identity and Solana network identity. 503 otherwise.
         */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** @enum {string} */
                            readonly status: "ready" | "not_ready";
                            readonly service: string;
                            /** Format: date-time */
                            readonly timestamp: string;
                            readonly checks: {
                                readonly [key: string]: {
                                    /** @enum {string} */
                                    readonly status: "pass" | "fail" | "unverified";
                                    readonly required: boolean;
                                    readonly detail: string;
                                    readonly observedAt: string | null;
                                    readonly durationMs: number | null;
                                };
                            };
                            readonly platform: {
                                /** @enum {string} */
                                readonly markovEnv: "local" | "test" | "staging" | "mainnet-read-only" | "production";
                                /** @enum {string} */
                                readonly solanaCluster: "localnet" | "devnet" | "testnet" | "mainnet-beta";
                                readonly expectedGenesisHash: string | null;
                                readonly observedGenesisHash: string | null;
                                readonly schemaVersion: string | null;
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** @enum {string} */
                            readonly status: "ready" | "not_ready";
                            readonly service: string;
                            /** Format: date-time */
                            readonly timestamp: string;
                            readonly checks: {
                                readonly [key: string]: {
                                    /** @enum {string} */
                                    readonly status: "pass" | "fail" | "unverified";
                                    readonly required: boolean;
                                    readonly detail: string;
                                    readonly observedAt: string | null;
                                    readonly durationMs: number | null;
                                };
                            };
                            readonly platform: {
                                /** @enum {string} */
                                readonly markovEnv: "local" | "test" | "staging" | "mainnet-read-only" | "production";
                                /** @enum {string} */
                                readonly solanaCluster: "localnet" | "devnet" | "testnet" | "mainnet-beta";
                                readonly expectedGenesisHash: string | null;
                                readonly observedGenesisHash: string | null;
                                readonly schemaVersion: string | null;
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/platform": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Platform identity and capability readiness
         * @description Secret-free description of the running platform, including the verification state of every capability.
         */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly service: string;
                            readonly version: string;
                            /** @enum {string} */
                            readonly contractSchemaVersion: "1";
                            readonly identity: {
                                /** @enum {string} */
                                readonly markovEnv: "local" | "test" | "staging" | "mainnet-read-only" | "production";
                                /** @enum {string} */
                                readonly solanaCluster: "localnet" | "devnet" | "testnet" | "mainnet-beta";
                                readonly genesisHash: string;
                            } | null;
                            /** @enum {string} */
                            readonly identityProvider: "test" | "oidc";
                            readonly executionWritesEnabled: boolean;
                            readonly capabilities: readonly {
                                /** @enum {string} */
                                readonly capability: "platform.api.health" | "platform.db.migrations" | "platform.worker.temporal" | "solana.rpc.read" | "solana.rpc.submit" | "catalog.prestocks.ingest" | "catalog.xstocks.ingest" | "catalog.tessera.ingest" | "identity.provider.verify" | "execution.jupiter.quote" | "execution.jupiter.build" | "execution.spot.submit" | "registry.strategy.publish" | "research.model.generate" | "notifications.email" | "liquidity.meteora.read" | "liquidity.meteora.dbc-simulate" | "automation.unattended";
                                /** @enum {string} */
                                readonly status: "IMPLEMENTED" | "FIXTURE_VERIFIED" | "LIVE_READ_VERIFIED" | "LIVE_WRITE_VERIFIED" | "BLOCKED" | "DISABLED";
                                readonly summary: string;
                                /** @default {} */
                                readonly evidence: {
                                    readonly [key: string]: unknown;
                                };
                                /** Format: date-time */
                                readonly updatedAt: string;
                                readonly updatedBy: string;
                            }[];
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/auth/sessions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Exchange a verified identity token for an opaque Markov session */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly identityToken: string;
                    };
                };
            };
            readonly responses: {
                /** @description Default Response */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** Format: uuid */
                            readonly sessionId: string;
                            readonly sessionToken: string;
                            /** Format: date-time */
                            readonly expiresAt: string;
                            /** Format: date-time */
                            readonly authTime: string;
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/auth/sessions/current": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Sign out the current session */
        readonly delete: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 204: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Describe the calling principal */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly principal: {
                                /** @enum {string} */
                                readonly class: "user" | "agent" | "operator" | "device" | "worker";
                                readonly id: string;
                                readonly userId: string | null;
                                readonly scopes: readonly string[];
                                readonly authTime: string | null;
                                readonly stepUpFresh: boolean;
                            };
                            readonly user: {
                                /** Format: uuid */
                                readonly id: string;
                                readonly subject: string;
                                readonly issuer: string;
                                /** Format: date-time */
                                readonly createdAt: string;
                            } | null;
                            readonly session: {
                                /** Format: uuid */
                                readonly sessionId: string;
                                /** Format: date-time */
                                readonly expiresAt: string;
                            } | null;
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/wallets/challenges": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Start wallet ownership verification (requires recent sign-in) */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly address: string;
                    };
                };
            };
            readonly responses: {
                /** @description Default Response */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** Format: uuid */
                            readonly challengeId: string;
                            readonly message: string;
                            /** Format: date-time */
                            readonly expiresAt: string;
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/wallets": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List verified wallets */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly wallets: readonly {
                                /** Format: uuid */
                                readonly walletId: string;
                                /** @enum {string} */
                                readonly chain: "solana";
                                readonly genesisHash: string;
                                readonly address: string;
                                /** Format: date-time */
                                readonly verifiedAt: string;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Link a wallet by presenting the signed challenge */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        /** Format: uuid */
                        readonly challengeId: string;
                        readonly address: string;
                        readonly signature: string;
                    };
                };
            };
            readonly responses: {
                /** @description Default Response */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** Format: uuid */
                            readonly walletId: string;
                            /** @enum {string} */
                            readonly chain: "solana";
                            readonly genesisHash: string;
                            readonly address: string;
                            /** Format: date-time */
                            readonly verifiedAt: string;
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/wallets/{walletId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Unlink a wallet (requires recent sign-in) */
        readonly delete: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly walletId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 204: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/api-credentials": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List API credentials (never secrets) */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly credentials: readonly {
                                /** Format: uuid */
                                readonly credentialId: string;
                                readonly label: string;
                                readonly prefix: string;
                                readonly scopes: readonly string[];
                                /** Format: date-time */
                                readonly createdAt: string;
                                /** Format: date-time */
                                readonly expiresAt: string;
                                readonly revokedAt: string | null;
                                readonly lastUsedAt: string | null;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        /** Create a scoped, expiring API agent credential (requires recent sign-in) */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly label: string;
                        readonly scopes: readonly ("research:read" | "portfolio:read" | "proposals:create")[];
                        readonly expiresInSeconds: number;
                    };
                };
            };
            readonly responses: {
                /** @description Default Response */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** Format: uuid */
                            readonly credentialId: string;
                            readonly label: string;
                            readonly prefix: string;
                            readonly scopes: readonly string[];
                            /** Format: date-time */
                            readonly createdAt: string;
                            /** Format: date-time */
                            readonly expiresAt: string;
                            readonly revokedAt: string | null;
                            readonly lastUsedAt: string | null;
                            readonly token: string;
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/api-credentials/{credentialId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Revoke an API credential (requires recent sign-in) */
        readonly delete: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly credentialId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 204: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/devices/pairings": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Create a single-use device pairing code (requires recent sign-in) */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly capabilities: readonly ("preferences:sync" | "status:read" | "notifications:receive")[];
                    };
                };
            };
            readonly responses: {
                /** @description Default Response */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** Format: uuid */
                            readonly pairingId: string;
                            readonly code: string;
                            /** Format: date-time */
                            readonly expiresAt: string;
                            readonly capabilities: readonly ("preferences:sync" | "status:read" | "notifications:receive")[];
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/devices/pair": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Pair a device with a code; returns the device credential once */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly code: string;
                        readonly deviceName: string;
                    };
                };
            };
            readonly responses: {
                /** @description Default Response */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            /** Format: uuid */
                            readonly deviceId: string;
                            readonly name: string;
                            readonly capabilities: readonly ("preferences:sync" | "status:read" | "notifications:receive")[];
                            /** Format: date-time */
                            readonly pairedAt: string;
                            readonly lastSeenAt: string | null;
                            readonly revokedAt: string | null;
                            readonly deviceToken: string;
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/devices": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List paired devices */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly devices: readonly {
                                /** Format: uuid */
                                readonly deviceId: string;
                                readonly name: string;
                                readonly capabilities: readonly ("preferences:sync" | "status:read" | "notifications:receive")[];
                                /** Format: date-time */
                                readonly pairedAt: string;
                                readonly lastSeenAt: string | null;
                                readonly revokedAt: string | null;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/me/devices/{deviceId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Revoke a device (requires recent sign-in) */
        readonly delete: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly deviceId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 204: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/ops/users/{userId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Operator view of an account (no secrets) */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly userId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly user: {
                                /** Format: uuid */
                                readonly id: string;
                                readonly subject: string;
                                readonly issuer: string;
                                /** Format: date-time */
                                readonly createdAt: string;
                                readonly disabledAt: string | null;
                            };
                            readonly wallets: readonly {
                                /** Format: uuid */
                                readonly walletId: string;
                                /** @enum {string} */
                                readonly chain: "solana";
                                readonly genesisHash: string;
                                readonly address: string;
                                /** Format: date-time */
                                readonly verifiedAt: string;
                            }[];
                            readonly credentials: readonly {
                                /** Format: uuid */
                                readonly credentialId: string;
                                readonly label: string;
                                readonly prefix: string;
                                readonly scopes: readonly string[];
                                /** Format: date-time */
                                readonly createdAt: string;
                                /** Format: date-time */
                                readonly expiresAt: string;
                                readonly revokedAt: string | null;
                                readonly lastUsedAt: string | null;
                            }[];
                            readonly devices: readonly {
                                /** Format: uuid */
                                readonly deviceId: string;
                                readonly name: string;
                                readonly capabilities: readonly ("preferences:sync" | "status:read" | "notifications:receive")[];
                                /** Format: date-time */
                                readonly pairedAt: string;
                                readonly lastSeenAt: string | null;
                                readonly revokedAt: string | null;
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/ops/api-credentials/{credentialId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        readonly post?: never;
        /** Operator revocation of an agent credential */
        readonly delete: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly credentialId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 204: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content?: never;
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
    readonly "/v1/ops/audit": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Recent audit events */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly limit?: number;
                };
                readonly header?: never;
                readonly path?: never;
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 200: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly events: readonly {
                                readonly id: number;
                                /** Format: date-time */
                                readonly occurredAt: string;
                                /** @enum {string} */
                                readonly actorClass: "user" | "agent" | "operator" | "device" | "worker";
                                readonly actorId: string;
                                readonly action: string;
                                readonly targetType: string;
                                readonly targetId: string;
                                readonly requestId: string | null;
                                readonly details: {
                                    readonly [key: string]: unknown;
                                };
                            }[];
                        };
                    };
                };
                /** @description Default Response */
                readonly 400: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 401: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 403: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 404: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 409: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
                /** @description Default Response */
                readonly 429: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "SERVICE_NOT_READY" | "INTERNAL";
                                readonly message: string;
                                readonly requestId: string;
                                readonly details?: readonly {
                                    readonly path: string;
                                    readonly message: string;
                                }[];
                            };
                        };
                    };
                };
            };
        };
        readonly put?: never;
        readonly post?: never;
        readonly delete?: never;
        readonly options?: never;
        readonly head?: never;
        readonly patch?: never;
        readonly trace?: never;
    };
};
export type webhooks = Record<string, never>;
export type components = {
    schemas: never;
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
};
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
