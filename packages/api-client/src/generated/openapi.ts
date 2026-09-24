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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/catalog/instruments": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Search admitted and paused instruments
         * @description Reference prices carry their kind (issuer mark, implied valuation, secondary market or underlying equity) and are never executable quotes. Lifecycle facts (halts, pending corporate actions, migrations, sunsets, the multiplier in force) come with every instrument.
         */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly q?: string;
                    readonly issuer?: "prestocks" | "xstocks" | "tessera";
                    readonly kind?: "pre_ipo_exposure" | "listed_stock";
                    readonly cursor?: string;
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
                            readonly instruments: readonly {
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                readonly issuerProductId: string;
                                readonly symbol: string;
                                readonly name: string;
                                readonly companyName: string;
                                /** @enum {string} */
                                readonly kind: "pre_ipo_exposure" | "listed_stock";
                                /** @enum {string} */
                                readonly chain: "solana";
                                readonly genesisHash: string;
                                readonly mint: string;
                                readonly decimals: number;
                                /** @enum {string} */
                                readonly tokenProgram: "spl-token" | "token-2022" | "unknown";
                                /** @enum {string} */
                                readonly status: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                                readonly statusReason: string | null;
                                readonly metadata: {
                                    readonly website: string | null;
                                    readonly description: string | null;
                                };
                                readonly referencePrice: {
                                    readonly value: string;
                                    readonly unit: string;
                                    /** @enum {string} */
                                    readonly kind: "issuer_mark" | "implied_valuation" | "secondary_market" | "underlying_equity";
                                    /** Format: date-time */
                                    readonly observedAt: string;
                                    readonly source: string;
                                    readonly stale: boolean;
                                    readonly expiresAt: null;
                                } | null;
                                readonly underlying: {
                                    readonly ticker: string | null;
                                    readonly exchange: string | null;
                                };
                                readonly lifecycle: {
                                    readonly halted: boolean;
                                    readonly haltedReason: string | null;
                                    readonly pendingActions: readonly {
                                        /** Format: uuid */
                                        readonly actionId: string;
                                        /** @enum {string} */
                                        readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                                        /** Format: date-time */
                                        readonly effectiveAt: string;
                                    }[];
                                    readonly migration: {
                                        readonly targetProductId: string;
                                        readonly targetInstrumentId: string | null;
                                        /** Format: date-time */
                                        readonly deadlineAt: string;
                                    } | null;
                                    readonly sunsetAt: string | null;
                                    readonly currentMultiplier: string | null;
                                    readonly multiplierEffectiveAt: string | null;
                                };
                                readonly availability: {
                                    readonly research: boolean;
                                    readonly strategy: boolean;
                                    /** @enum {boolean} */
                                    readonly trade: false;
                                    readonly reasons: readonly string[];
                                };
                                readonly admittedAt: string | null;
                                /** Format: date-time */
                                readonly updatedAt: string;
                            }[];
                            readonly nextCursor: string | null;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/catalog/instruments/{instrumentId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Instrument detail with its latest mint verification and extension assessment */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
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
                            /** Format: uuid */
                            readonly instrumentId: string;
                            /** @enum {string} */
                            readonly issuer: "prestocks" | "xstocks" | "tessera";
                            readonly issuerProductId: string;
                            readonly symbol: string;
                            readonly name: string;
                            readonly companyName: string;
                            /** @enum {string} */
                            readonly kind: "pre_ipo_exposure" | "listed_stock";
                            /** @enum {string} */
                            readonly chain: "solana";
                            readonly genesisHash: string;
                            readonly mint: string;
                            readonly decimals: number;
                            /** @enum {string} */
                            readonly tokenProgram: "spl-token" | "token-2022" | "unknown";
                            /** @enum {string} */
                            readonly status: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                            readonly statusReason: string | null;
                            readonly metadata: {
                                readonly website: string | null;
                                readonly description: string | null;
                            };
                            readonly referencePrice: {
                                readonly value: string;
                                readonly unit: string;
                                /** @enum {string} */
                                readonly kind: "issuer_mark" | "implied_valuation" | "secondary_market" | "underlying_equity";
                                /** Format: date-time */
                                readonly observedAt: string;
                                readonly source: string;
                                readonly stale: boolean;
                                readonly expiresAt: null;
                            } | null;
                            readonly underlying: {
                                readonly ticker: string | null;
                                readonly exchange: string | null;
                            };
                            readonly lifecycle: {
                                readonly halted: boolean;
                                readonly haltedReason: string | null;
                                readonly pendingActions: readonly {
                                    /** Format: uuid */
                                    readonly actionId: string;
                                    /** @enum {string} */
                                    readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                                    /** Format: date-time */
                                    readonly effectiveAt: string;
                                }[];
                                readonly migration: {
                                    readonly targetProductId: string;
                                    readonly targetInstrumentId: string | null;
                                    /** Format: date-time */
                                    readonly deadlineAt: string;
                                } | null;
                                readonly sunsetAt: string | null;
                                readonly currentMultiplier: string | null;
                                readonly multiplierEffectiveAt: string | null;
                            };
                            readonly availability: {
                                readonly research: boolean;
                                readonly strategy: boolean;
                                /** @enum {boolean} */
                                readonly trade: false;
                                readonly reasons: readonly string[];
                            };
                            readonly admittedAt: string | null;
                            /** Format: date-time */
                            readonly updatedAt: string;
                            readonly latestMintVerification: {
                                readonly verificationId: number;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** Format: date-time */
                                readonly verifiedAt: string;
                                readonly rpcHost: string;
                                readonly slot: number | null;
                                /** @enum {string} */
                                readonly result: "verified" | "mismatch" | "not_found" | "not_a_mint" | "error";
                                readonly onChain: {
                                    /** @enum {string} */
                                    readonly tokenProgram: "spl-token" | "token-2022" | "unknown";
                                    readonly decimals: number;
                                    readonly supply: string;
                                    readonly mintAuthority: string | null;
                                    readonly freezeAuthority: string | null;
                                    readonly isInitialized: boolean;
                                    readonly extensions: readonly string[];
                                    readonly unknownExtensionTypes: readonly number[];
                                } | null;
                                readonly mismatches: readonly string[];
                                readonly compatibility: {
                                    /** @enum {string} */
                                    readonly compatibility: "supported" | "review_required" | "unsupported";
                                    readonly findings: readonly {
                                        readonly extension: string;
                                        /** @enum {string} */
                                        readonly verdict: "supported" | "review_required" | "unsupported";
                                        readonly detail: string;
                                    }[];
                                    readonly scaledUiAmount: {
                                        readonly authority: string | null;
                                        readonly multiplier: string;
                                        readonly multiplierExact: string;
                                        readonly newMultiplier: string;
                                        readonly newMultiplierExact: string;
                                        readonly newMultiplierEffectiveAt: string | null;
                                    } | null;
                                    readonly transferFee: {
                                        readonly basisPoints: number;
                                        readonly maximumFee: string;
                                        readonly newerEpoch: string;
                                        readonly olderBasisPoints: number;
                                    } | null;
                                    readonly paused: boolean | null;
                                    readonly defaultAccountState: ("initialized" | "frozen") | null;
                                    readonly permanentDelegate: string | null;
                                    readonly transferHookProgram: string | null;
                                    readonly interestBearing: {
                                        readonly currentRateBasisPoints: number;
                                    } | null;
                                } | null;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/catalog/instruments/{instrumentId}/corporate-actions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Pending and applied corporate actions of a visible instrument */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
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
                            readonly actions: readonly {
                                /** Format: uuid */
                                readonly actionId: string;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                readonly externalId: string;
                                /** @enum {string} */
                                readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                                /** @enum {string} */
                                readonly status: "pending" | "applied" | "rejected" | "superseded";
                                /** Format: date-time */
                                readonly announcedAt: string;
                                /** Format: date-time */
                                readonly effectiveAt: string;
                                readonly summary: string;
                                readonly details: {
                                    readonly ratio: {
                                        readonly numerator: number;
                                        readonly denominator: number;
                                    } | null;
                                    readonly newMultiplier: string | null;
                                    readonly distribution: {
                                        readonly amountPerToken: string;
                                        readonly unit: string;
                                    } | null;
                                    readonly migration: {
                                        readonly targetProductId: string;
                                        /** Format: date-time */
                                        readonly deadlineAt: string;
                                    } | null;
                                    readonly sunsetAt: string | null;
                                    readonly reference: string | null;
                                };
                                readonly appliedAt: string | null;
                                readonly appliedBy: string | null;
                                readonly statusReason: string | null;
                                /** Format: uuid */
                                readonly sourceSnapshotId: string;
                                /** Format: date-time */
                                readonly createdAt: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/catalog/instruments/{instrumentId}/multipliers": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Multiplier evidence history (on-chain reads, applied corporate actions, operator entries) */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
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
                            /** Format: uuid */
                            readonly instrumentId: string;
                            readonly multipliers: readonly {
                                readonly multiplierId: number;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** Format: date-time */
                                readonly effectiveAt: string;
                                readonly multiplier: string;
                                readonly multiplierExact: string;
                                /** @enum {string} */
                                readonly source: "on_chain" | "corporate_action" | "operator" | "issuer_feed";
                                readonly evidence: {
                                    readonly [key: string]: string;
                                };
                                /** Format: date-time */
                                readonly recordedAt: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/catalog/instruments/{instrumentId}/multiplier": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** The multiplier in force at a time; incomplete evidence is reported, never assumed to be 1 */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly asOf?: string;
                };
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
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
                            /** Format: uuid */
                            readonly instrumentId: string;
                            /** Format: date-time */
                            readonly asOf: string;
                            readonly multiplier: string | null;
                            readonly effectiveAt: string | null;
                            readonly source: ("on_chain" | "corporate_action" | "operator" | "issuer_feed") | null;
                            readonly complete: boolean;
                            readonly detail: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/catalog/instruments/{instrumentId}/quantities": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /**
         * Convert between raw base units and scaled display quantities with explicit rounding
         * @description Exactly one of `raw` or `scaled`. The multiplier used and whether rounding lost information are always returned.
         */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly raw?: string;
                    readonly scaled?: string;
                    readonly asOf?: string;
                    readonly rounding?: "down" | "up" | "half_up" | "half_even";
                };
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
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
                            /** Format: uuid */
                            readonly instrumentId: string;
                            /** Format: date-time */
                            readonly asOf: string;
                            readonly decimals: number;
                            readonly multiplier: string;
                            readonly multiplierEffectiveAt: string | null;
                            /** @enum {string} */
                            readonly multiplierSource: "on_chain" | "corporate_action" | "operator" | "issuer_feed";
                            readonly raw: string;
                            readonly scaled: string;
                            readonly scaledExact: string;
                            /** @enum {string} */
                            readonly rounding: "down" | "up" | "half_up" | "half_even";
                            readonly rounded: boolean;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/instruments": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** List instruments in any status (operator) */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly q?: string;
                    readonly issuer?: "prestocks" | "xstocks" | "tessera";
                    readonly kind?: "pre_ipo_exposure" | "listed_stock";
                    readonly cursor?: string;
                    readonly limit?: number;
                    readonly status?: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
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
                            readonly instruments: readonly {
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                readonly issuerProductId: string;
                                readonly symbol: string;
                                readonly name: string;
                                readonly companyName: string;
                                /** @enum {string} */
                                readonly kind: "pre_ipo_exposure" | "listed_stock";
                                /** @enum {string} */
                                readonly chain: "solana";
                                readonly genesisHash: string;
                                readonly mint: string;
                                readonly decimals: number;
                                /** @enum {string} */
                                readonly tokenProgram: "spl-token" | "token-2022" | "unknown";
                                /** @enum {string} */
                                readonly status: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                                readonly statusReason: string | null;
                                readonly metadata: {
                                    readonly website: string | null;
                                    readonly description: string | null;
                                };
                                readonly referencePrice: {
                                    readonly value: string;
                                    readonly unit: string;
                                    /** @enum {string} */
                                    readonly kind: "issuer_mark" | "implied_valuation" | "secondary_market" | "underlying_equity";
                                    /** Format: date-time */
                                    readonly observedAt: string;
                                    readonly source: string;
                                    readonly stale: boolean;
                                    readonly expiresAt: null;
                                } | null;
                                readonly underlying: {
                                    readonly ticker: string | null;
                                    readonly exchange: string | null;
                                };
                                readonly lifecycle: {
                                    readonly halted: boolean;
                                    readonly haltedReason: string | null;
                                    readonly pendingActions: readonly {
                                        /** Format: uuid */
                                        readonly actionId: string;
                                        /** @enum {string} */
                                        readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                                        /** Format: date-time */
                                        readonly effectiveAt: string;
                                    }[];
                                    readonly migration: {
                                        readonly targetProductId: string;
                                        readonly targetInstrumentId: string | null;
                                        /** Format: date-time */
                                        readonly deadlineAt: string;
                                    } | null;
                                    readonly sunsetAt: string | null;
                                    readonly currentMultiplier: string | null;
                                    readonly multiplierEffectiveAt: string | null;
                                };
                                readonly availability: {
                                    readonly research: boolean;
                                    readonly strategy: boolean;
                                    /** @enum {boolean} */
                                    readonly trade: false;
                                    readonly reasons: readonly string[];
                                };
                                readonly admittedAt: string | null;
                                /** Format: date-time */
                                readonly updatedAt: string;
                            }[];
                            readonly nextCursor: string | null;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/instruments/{instrumentId}": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Instrument detail in any status (operator) */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
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
                            /** Format: uuid */
                            readonly instrumentId: string;
                            /** @enum {string} */
                            readonly issuer: "prestocks" | "xstocks" | "tessera";
                            readonly issuerProductId: string;
                            readonly symbol: string;
                            readonly name: string;
                            readonly companyName: string;
                            /** @enum {string} */
                            readonly kind: "pre_ipo_exposure" | "listed_stock";
                            /** @enum {string} */
                            readonly chain: "solana";
                            readonly genesisHash: string;
                            readonly mint: string;
                            readonly decimals: number;
                            /** @enum {string} */
                            readonly tokenProgram: "spl-token" | "token-2022" | "unknown";
                            /** @enum {string} */
                            readonly status: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                            readonly statusReason: string | null;
                            readonly metadata: {
                                readonly website: string | null;
                                readonly description: string | null;
                            };
                            readonly referencePrice: {
                                readonly value: string;
                                readonly unit: string;
                                /** @enum {string} */
                                readonly kind: "issuer_mark" | "implied_valuation" | "secondary_market" | "underlying_equity";
                                /** Format: date-time */
                                readonly observedAt: string;
                                readonly source: string;
                                readonly stale: boolean;
                                readonly expiresAt: null;
                            } | null;
                            readonly underlying: {
                                readonly ticker: string | null;
                                readonly exchange: string | null;
                            };
                            readonly lifecycle: {
                                readonly halted: boolean;
                                readonly haltedReason: string | null;
                                readonly pendingActions: readonly {
                                    /** Format: uuid */
                                    readonly actionId: string;
                                    /** @enum {string} */
                                    readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                                    /** Format: date-time */
                                    readonly effectiveAt: string;
                                }[];
                                readonly migration: {
                                    readonly targetProductId: string;
                                    readonly targetInstrumentId: string | null;
                                    /** Format: date-time */
                                    readonly deadlineAt: string;
                                } | null;
                                readonly sunsetAt: string | null;
                                readonly currentMultiplier: string | null;
                                readonly multiplierEffectiveAt: string | null;
                            };
                            readonly availability: {
                                readonly research: boolean;
                                readonly strategy: boolean;
                                /** @enum {boolean} */
                                readonly trade: false;
                                readonly reasons: readonly string[];
                            };
                            readonly admittedAt: string | null;
                            /** Format: date-time */
                            readonly updatedAt: string;
                            readonly latestMintVerification: {
                                readonly verificationId: number;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** Format: date-time */
                                readonly verifiedAt: string;
                                readonly rpcHost: string;
                                readonly slot: number | null;
                                /** @enum {string} */
                                readonly result: "verified" | "mismatch" | "not_found" | "not_a_mint" | "error";
                                readonly onChain: {
                                    /** @enum {string} */
                                    readonly tokenProgram: "spl-token" | "token-2022" | "unknown";
                                    readonly decimals: number;
                                    readonly supply: string;
                                    readonly mintAuthority: string | null;
                                    readonly freezeAuthority: string | null;
                                    readonly isInitialized: boolean;
                                    readonly extensions: readonly string[];
                                    readonly unknownExtensionTypes: readonly number[];
                                } | null;
                                readonly mismatches: readonly string[];
                                readonly compatibility: {
                                    /** @enum {string} */
                                    readonly compatibility: "supported" | "review_required" | "unsupported";
                                    readonly findings: readonly {
                                        readonly extension: string;
                                        /** @enum {string} */
                                        readonly verdict: "supported" | "review_required" | "unsupported";
                                        readonly detail: string;
                                    }[];
                                    readonly scaledUiAmount: {
                                        readonly authority: string | null;
                                        readonly multiplier: string;
                                        readonly multiplierExact: string;
                                        readonly newMultiplier: string;
                                        readonly newMultiplierExact: string;
                                        readonly newMultiplierEffectiveAt: string | null;
                                    } | null;
                                    readonly transferFee: {
                                        readonly basisPoints: number;
                                        readonly maximumFee: string;
                                        readonly newerEpoch: string;
                                        readonly olderBasisPoints: number;
                                    } | null;
                                    readonly paused: boolean | null;
                                    readonly defaultAccountState: ("initialized" | "frozen") | null;
                                    readonly permanentDelegate: string | null;
                                    readonly transferHookProgram: string | null;
                                    readonly interestBearing: {
                                        readonly currentRateBasisPoints: number;
                                    } | null;
                                } | null;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/instruments/{instrumentId}/decisions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Decision history of an instrument (operator) */
        readonly get: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
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
                            readonly decisions: readonly {
                                readonly decisionId: number;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** @enum {string} */
                                readonly decision: "admit" | "reject" | "pause" | "resume" | "delist";
                                readonly reason: string;
                                readonly evidence: {
                                    readonly [key: string]: string;
                                };
                                /** @enum {string} */
                                readonly previousStatus: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                                /** @enum {string} */
                                readonly newStatus: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                                readonly decidedBy: string;
                                /** Format: date-time */
                                readonly decidedAt: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
        /**
         * Admit, reject, pause, resume or delist an instrument (operator)
         * @description Admission and resumption require a matching mint verification recorded after the last upstream change, no unsupported token extension, and `evidence.extensionReview` when extensions need review.
         */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        /** @enum {string} */
                        readonly decision: "admit" | "reject" | "pause" | "resume" | "delist";
                        readonly reason: string;
                        /** @default {} */
                        readonly evidence?: {
                            readonly [key: string]: string;
                        };
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
                            readonly decisionId: number;
                            /** Format: uuid */
                            readonly instrumentId: string;
                            /** @enum {string} */
                            readonly decision: "admit" | "reject" | "pause" | "resume" | "delist";
                            readonly reason: string;
                            readonly evidence: {
                                readonly [key: string]: string;
                            };
                            /** @enum {string} */
                            readonly previousStatus: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                            /** @enum {string} */
                            readonly newStatus: "quarantined" | "admitted" | "paused" | "rejected" | "delisted";
                            readonly decidedBy: string;
                            /** Format: date-time */
                            readonly decidedAt: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/ingestions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Ingest an issuer product feed into quarantine (operator)
         * @description Fixture sources exist only in local and test modes. A feed that drifts from the contract is recorded as a rejected snapshot and changes nothing.
         */
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
                        /** @enum {string} */
                        readonly issuer: "prestocks" | "xstocks" | "tessera";
                        /** @enum {string} */
                        readonly source: "fixture" | "configured_url";
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
                            readonly snapshot: {
                                /** Format: uuid */
                                readonly snapshotId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                /** @enum {string} */
                                readonly kind: "products" | "corporate_actions";
                                /** @enum {string} */
                                readonly source: "fixture" | "configured_url";
                                readonly sourceRef: string;
                                /** Format: date-time */
                                readonly fetchedAt: string;
                                readonly contentHash: string;
                                readonly schemaVersion: string | null;
                                readonly itemCount: number;
                                /** @enum {string} */
                                readonly status: "accepted" | "rejected";
                                readonly rejectionReason: string | null;
                                readonly createdBy: string;
                            };
                            readonly products: readonly {
                                readonly issuerProductId: string;
                                readonly symbol: string | null;
                                /** @enum {string} */
                                readonly outcome: "inserted" | "updated" | "unchanged" | "rejected" | "paused";
                                readonly reasons: readonly string[];
                            }[];
                            readonly counts: {
                                readonly inserted: number;
                                readonly updated: number;
                                readonly unchanged: number;
                                readonly rejected: number;
                                readonly paused: number;
                            };
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/corporate-actions/ingestions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Ingest an issuer corporate-action feed as pending events (operator)
         * @description Events for unknown products are reported as unmatched and never create instruments; applied or rejected events are never rewritten by a feed.
         */
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
                        /** @enum {string} */
                        readonly issuer: "prestocks" | "xstocks" | "tessera";
                        /** @enum {string} */
                        readonly source: "fixture" | "configured_url";
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
                            readonly snapshot: {
                                /** Format: uuid */
                                readonly snapshotId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                /** @enum {string} */
                                readonly kind: "products" | "corporate_actions";
                                /** @enum {string} */
                                readonly source: "fixture" | "configured_url";
                                readonly sourceRef: string;
                                /** Format: date-time */
                                readonly fetchedAt: string;
                                readonly contentHash: string;
                                readonly schemaVersion: string | null;
                                readonly itemCount: number;
                                /** @enum {string} */
                                readonly status: "accepted" | "rejected";
                                readonly rejectionReason: string | null;
                                readonly createdBy: string;
                            };
                            readonly events: readonly {
                                readonly externalId: string;
                                readonly productId: string;
                                /** @enum {string} */
                                readonly outcome: "inserted" | "updated" | "unchanged" | "rejected" | "unmatched";
                                readonly reasons: readonly string[];
                            }[];
                            readonly counts: {
                                readonly inserted: number;
                                readonly updated: number;
                                readonly unchanged: number;
                                readonly rejected: number;
                                readonly unmatched: number;
                            };
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/corporate-actions": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Corporate actions in any status (operator) */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly issuer?: "prestocks" | "xstocks" | "tessera";
                    readonly status?: "pending" | "applied" | "rejected" | "superseded";
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
                            readonly actions: readonly {
                                /** Format: uuid */
                                readonly actionId: string;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                readonly externalId: string;
                                /** @enum {string} */
                                readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                                /** @enum {string} */
                                readonly status: "pending" | "applied" | "rejected" | "superseded";
                                /** Format: date-time */
                                readonly announcedAt: string;
                                /** Format: date-time */
                                readonly effectiveAt: string;
                                readonly summary: string;
                                readonly details: {
                                    readonly ratio: {
                                        readonly numerator: number;
                                        readonly denominator: number;
                                    } | null;
                                    readonly newMultiplier: string | null;
                                    readonly distribution: {
                                        readonly amountPerToken: string;
                                        readonly unit: string;
                                    } | null;
                                    readonly migration: {
                                        readonly targetProductId: string;
                                        /** Format: date-time */
                                        readonly deadlineAt: string;
                                    } | null;
                                    readonly sunsetAt: string | null;
                                    readonly reference: string | null;
                                };
                                readonly appliedAt: string | null;
                                readonly appliedBy: string | null;
                                readonly statusReason: string | null;
                                /** Format: uuid */
                                readonly sourceSnapshotId: string;
                                /** Format: date-time */
                                readonly createdAt: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/corporate-actions/{actionId}/apply": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /**
         * Apply a pending corporate action once it is effective (operator)
         * @description Halts, resumes, migrations and sunsets change the lifecycle; splits, reverse splits and multiplier changes record multiplier evidence derived from the multiplier in force before the effective time.
         */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly actionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly reason: string;
                        /** @default {} */
                        readonly evidence?: {
                            readonly [key: string]: string;
                        };
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
                            readonly action: {
                                /** Format: uuid */
                                readonly actionId: string;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                readonly externalId: string;
                                /** @enum {string} */
                                readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                                /** @enum {string} */
                                readonly status: "pending" | "applied" | "rejected" | "superseded";
                                /** Format: date-time */
                                readonly announcedAt: string;
                                /** Format: date-time */
                                readonly effectiveAt: string;
                                readonly summary: string;
                                readonly details: {
                                    readonly ratio: {
                                        readonly numerator: number;
                                        readonly denominator: number;
                                    } | null;
                                    readonly newMultiplier: string | null;
                                    readonly distribution: {
                                        readonly amountPerToken: string;
                                        readonly unit: string;
                                    } | null;
                                    readonly migration: {
                                        readonly targetProductId: string;
                                        /** Format: date-time */
                                        readonly deadlineAt: string;
                                    } | null;
                                    readonly sunsetAt: string | null;
                                    readonly reference: string | null;
                                };
                                readonly appliedAt: string | null;
                                readonly appliedBy: string | null;
                                readonly statusReason: string | null;
                                /** Format: uuid */
                                readonly sourceSnapshotId: string;
                                /** Format: date-time */
                                readonly createdAt: string;
                            };
                            readonly multiplier: {
                                readonly multiplierId: number;
                                /** Format: uuid */
                                readonly instrumentId: string;
                                /** Format: date-time */
                                readonly effectiveAt: string;
                                readonly multiplier: string;
                                readonly multiplierExact: string;
                                /** @enum {string} */
                                readonly source: "on_chain" | "corporate_action" | "operator" | "issuer_feed";
                                readonly evidence: {
                                    readonly [key: string]: string;
                                };
                                /** Format: date-time */
                                readonly recordedAt: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/corporate-actions/{actionId}/reject": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Reject a pending corporate action (operator) */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly actionId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody: {
                readonly content: {
                    readonly "application/json": {
                        readonly reason: string;
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
                            readonly actionId: string;
                            /** Format: uuid */
                            readonly instrumentId: string;
                            /** @enum {string} */
                            readonly issuer: "prestocks" | "xstocks" | "tessera";
                            readonly externalId: string;
                            /** @enum {string} */
                            readonly type: "split" | "reverse_split" | "distribution" | "migration" | "sunset" | "halt" | "resume" | "multiplier_change";
                            /** @enum {string} */
                            readonly status: "pending" | "applied" | "rejected" | "superseded";
                            /** Format: date-time */
                            readonly announcedAt: string;
                            /** Format: date-time */
                            readonly effectiveAt: string;
                            readonly summary: string;
                            readonly details: {
                                readonly ratio: {
                                    readonly numerator: number;
                                    readonly denominator: number;
                                } | null;
                                readonly newMultiplier: string | null;
                                readonly distribution: {
                                    readonly amountPerToken: string;
                                    readonly unit: string;
                                } | null;
                                readonly migration: {
                                    readonly targetProductId: string;
                                    /** Format: date-time */
                                    readonly deadlineAt: string;
                                } | null;
                                readonly sunsetAt: string | null;
                                readonly reference: string | null;
                            };
                            readonly appliedAt: string | null;
                            readonly appliedBy: string | null;
                            readonly statusReason: string | null;
                            /** Format: uuid */
                            readonly sourceSnapshotId: string;
                            /** Format: date-time */
                            readonly createdAt: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/instruments/{instrumentId}/mint-verifications": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        readonly get?: never;
        readonly put?: never;
        /** Compare the declared mint with the chain and assess its token extensions (operator) */
        readonly post: {
            readonly parameters: {
                readonly query?: never;
                readonly header?: never;
                readonly path: {
                    readonly instrumentId: string;
                };
                readonly cookie?: never;
            };
            readonly requestBody?: never;
            readonly responses: {
                /** @description Default Response */
                readonly 201: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly verificationId: number;
                            /** Format: uuid */
                            readonly instrumentId: string;
                            /** Format: date-time */
                            readonly verifiedAt: string;
                            readonly rpcHost: string;
                            readonly slot: number | null;
                            /** @enum {string} */
                            readonly result: "verified" | "mismatch" | "not_found" | "not_a_mint" | "error";
                            readonly onChain: {
                                /** @enum {string} */
                                readonly tokenProgram: "spl-token" | "token-2022" | "unknown";
                                readonly decimals: number;
                                readonly supply: string;
                                readonly mintAuthority: string | null;
                                readonly freezeAuthority: string | null;
                                readonly isInitialized: boolean;
                                readonly extensions: readonly string[];
                                readonly unknownExtensionTypes: readonly number[];
                            } | null;
                            readonly mismatches: readonly string[];
                            readonly compatibility: {
                                /** @enum {string} */
                                readonly compatibility: "supported" | "review_required" | "unsupported";
                                readonly findings: readonly {
                                    readonly extension: string;
                                    /** @enum {string} */
                                    readonly verdict: "supported" | "review_required" | "unsupported";
                                    readonly detail: string;
                                }[];
                                readonly scaledUiAmount: {
                                    readonly authority: string | null;
                                    readonly multiplier: string;
                                    readonly multiplierExact: string;
                                    readonly newMultiplier: string;
                                    readonly newMultiplierExact: string;
                                    readonly newMultiplierEffectiveAt: string | null;
                                } | null;
                                readonly transferFee: {
                                    readonly basisPoints: number;
                                    readonly maximumFee: string;
                                    readonly newerEpoch: string;
                                    readonly olderBasisPoints: number;
                                } | null;
                                readonly paused: boolean | null;
                                readonly defaultAccountState: ("initialized" | "frozen") | null;
                                readonly permanentDelegate: string | null;
                                readonly transferHookProgram: string | null;
                                readonly interestBearing: {
                                    readonly currentRateBasisPoints: number;
                                } | null;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
    readonly "/v1/ops/catalog/snapshots": {
        readonly parameters: {
            readonly query?: never;
            readonly header?: never;
            readonly path?: never;
            readonly cookie?: never;
        };
        /** Recent issuer snapshots (operator) */
        readonly get: {
            readonly parameters: {
                readonly query?: {
                    readonly issuer?: "prestocks" | "xstocks" | "tessera";
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
                            readonly snapshots: readonly {
                                /** Format: uuid */
                                readonly snapshotId: string;
                                /** @enum {string} */
                                readonly issuer: "prestocks" | "xstocks" | "tessera";
                                /** @enum {string} */
                                readonly kind: "products" | "corporate_actions";
                                /** @enum {string} */
                                readonly source: "fixture" | "configured_url";
                                readonly sourceRef: string;
                                /** Format: date-time */
                                readonly fetchedAt: string;
                                readonly contentHash: string;
                                readonly schemaVersion: string | null;
                                readonly itemCount: number;
                                /** @enum {string} */
                                readonly status: "accepted" | "rejected";
                                readonly rejectionReason: string | null;
                                readonly createdBy: string;
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
                readonly 503: {
                    headers: {
                        readonly [name: string]: unknown;
                    };
                    content: {
                        readonly "application/json": {
                            readonly error: {
                                /** @enum {string} */
                                readonly code: "AUTH_REQUIRED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION_FAILED" | "RATE_LIMITED" | "ELIGIBILITY_UNKNOWN" | "ASSET_NOT_ADMITTED" | "QUOTE_EXPIRED" | "INSUFFICIENT_FUNDS" | "POLICY_DENIED" | "PLAN_CHANGED" | "SIGNATURE_MISMATCH" | "PARTIAL_EXECUTION" | "SUBMISSION_UNKNOWN" | "PROVIDER_UNAVAILABLE" | "IDEMPOTENCY_CONFLICT" | "STEP_UP_REQUIRED" | "CHALLENGE_INVALID" | "WALLET_ALREADY_LINKED" | "ADMISSION_BLOCKED" | "SERVICE_NOT_READY" | "INTERNAL";
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
