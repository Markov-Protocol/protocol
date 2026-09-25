import {
  AGENT_SCOPES,
  type AgentScope,
  type AgentToolDescriptor,
  type AgentToolFamily,
  type AgentToolName,
  agentProposalSchema,
  basketProposeInputSchema,
  exposuresCompareInputSchema,
  exposuresCompareOutputSchema,
  indicativePlanInputSchema,
  indicativePlanSchema,
  instrumentsFactsInputSchema,
  instrumentsFactsOutputSchema,
  instrumentsSearchInputSchema,
  instrumentsSearchOutputSchema,
  investmentProposeInputSchema,
  policyExplainInputSchema,
  policyExplainOutputSchema,
  quoteRequestInputSchema,
  quoteRequestOutputSchema,
  rebalanceProposeInputSchema,
  receiptsReadInputSchema,
  receiptsReadOutputSchema,
  thesisDraftInputSchema,
  thesisDraftOutputSchema,
  weightsValidateInputSchema,
  weightsValidateOutputSchema,
} from '@markov/contracts';
import { z } from 'zod';

/**
 * The typed tool catalog (B15). Each tool is a façade over exactly one
 * domain method and carries the scopes its caller must hold; a person's
 * session holds every owner scope, an agent credential only those it was
 * issued with. The catalog is data: nothing here executes anything.
 */
export interface ToolDefinition<
  I extends z.ZodTypeAny = z.ZodTypeAny,
  O extends z.ZodTypeAny = z.ZodTypeAny,
> {
  readonly name: AgentToolName;
  readonly family: AgentToolFamily;
  readonly scopes: readonly AgentScope[];
  readonly mutation: boolean;
  readonly summary: string;
  readonly description: string;
  readonly input: I;
  readonly output: O;
}

function tool<I extends z.ZodTypeAny, O extends z.ZodTypeAny>(
  definition: ToolDefinition<I, O>,
): ToolDefinition<I, O> {
  return definition;
}

export const AGENT_TOOLS = [
  tool({
    name: 'instruments.search',
    family: 'read',
    scopes: ['research:read'],
    mutation: false,
    summary: 'Search the admitted catalog by text, issuer or kind',
    description:
      'The public catalog projection (admitted or paused instruments only) with reference prices and their freshness. Nothing here is a quote.',
    input: instrumentsSearchInputSchema,
    output: instrumentsSearchOutputSchema,
  }),
  tool({
    name: 'instruments.facts',
    family: 'read',
    scopes: ['research:read'],
    mutation: false,
    summary: 'Sourced facts about one instrument',
    description:
      'The instrument as the catalog verified it (mint, token program, issuer metadata, admission, lifecycle, availability), its latest mint verification and its public corporate actions. The answer says when the reference price is stale or missing.',
    input: instrumentsFactsInputSchema,
    output: instrumentsFactsOutputSchema,
  }),
  tool({
    name: 'exposures.compare',
    family: 'read',
    scopes: ['research:read'],
    mutation: false,
    summary: 'Compare two to six instruments side by side',
    description:
      'Issuer, company, kind, status, token program and reference price per instrument; groups instruments that expose the same company through different issuers; lists the ones whose price is stale or missing.',
    input: exposuresCompareInputSchema,
    output: exposuresCompareOutputSchema,
  }),
  tool({
    name: 'thesis.draft',
    family: 'research',
    scopes: ['research:write'],
    mutation: true,
    summary: 'Draft a private thesis: a title, a claim, counterarguments and candidate instruments',
    description:
      'Creates a private thesis owned by the person, authored by the calling principal. No statement of fact is written: facts enter a thesis through sources and reviewed revisions, never from a model’s memory. Instrument ids must be admitted or paused catalog entries.',
    input: thesisDraftInputSchema,
    output: thesisDraftOutputSchema,
  }),
  tool({
    name: 'weights.validate',
    family: 'draft',
    scopes: ['proposals:create'],
    mutation: false,
    summary: 'Validate basket weights without saving anything',
    description:
      'Runs the strategy rules (exact basis points, cash, duplicates, admission, leg cap, concentration advisories) against the catalog and answers the issues. Nothing is stored.',
    input: weightsValidateInputSchema,
    output: weightsValidateOutputSchema,
  }),
  tool({
    name: 'plan.indicative',
    family: 'quote',
    scopes: ['proposals:create'],
    mutation: false,
    summary: 'What a plan would target for a version or an instrument and a budget',
    description:
      'The planner’s integer allocation (route minimums, fee reserve, cash remainder) for a version the person owns or a registered public one, or a single admitted instrument. No quote is requested, no reservation is held and no intent exists afterwards.',
    input: indicativePlanInputSchema,
    output: indicativePlanSchema,
  }),
  tool({
    name: 'quote.request',
    family: 'quote',
    scopes: ['proposals:create'],
    mutation: false,
    summary: 'One venue quote for an amount of an instrument, checked against the owner’s limits',
    description:
      'Asks the configured venue for an exact-input quote and runs the plan-time checks (slippage never above the owner’s limit, quote age, price impact, reviewed route programs). The quote is answered whether or not it would be accepted, with the checks it failed. Nothing is stored or reserved.',
    input: quoteRequestInputSchema,
    output: quoteRequestOutputSchema,
  }),
  tool({
    name: 'policy.explain',
    family: 'explain',
    scopes: ['portfolio:read'],
    mutation: false,
    summary: 'Explain a policy decision, or evaluate one without a reservation',
    description:
      'Answers an earlier decision of the caller’s account, or evaluates a side, instrument and notional now with reserve=false, and explains every denial with what the owner can do about it. A tool cannot change a limit; it can only say which one applies.',
    input: policyExplainInputSchema,
    output: policyExplainOutputSchema,
  }),
  tool({
    name: 'basket.propose',
    family: 'propose',
    scopes: ['proposals:create'],
    mutation: true,
    summary: 'Propose a basket: a validated strategy draft the owner reviews in the builder',
    description:
      'Validates the content and, when the rules pass, creates a strategy draft owned by the person and a proposal that points at it. Freezing, publishing and investing stay interactive, owner-only actions.',
    input: basketProposeInputSchema,
    output: agentProposalSchema,
  }),
  tool({
    name: 'investment.propose',
    family: 'propose',
    scopes: ['portfolio:read', 'proposals:create'],
    mutation: true,
    summary: 'Propose an investment the owner opens as an ordinary intent',
    description:
      'Checks the wallet is the owner’s, computes the indicative allocation and a pre-quote policy decision without a reservation, and records a proposal carrying the intent request. Only the owner can open it; opening creates the intent as the owner and the usual plan, acknowledgement and wallet signature follow. A proposal never asks for unattended execution.',
    input: investmentProposeInputSchema,
    output: agentProposalSchema,
  }),
  tool({
    name: 'rebalance.propose',
    family: 'propose',
    scopes: ['portfolio:read', 'proposals:create'],
    mutation: true,
    summary: 'Propose a rebalance review from an instance’s drift',
    description:
      'Values the lots attributed to the instance with the same prices and freshness rule as the performance series, compares them with the pinned version’s weights and records a rebalance proposal with the drift per leg. It carries no order: reviewed rebalance intents arrive with the maintenance session.',
    input: rebalanceProposeInputSchema,
    output: agentProposalSchema,
  }),
  tool({
    name: 'receipts.read',
    family: 'read',
    scopes: ['portfolio:read'],
    mutation: false,
    summary: 'Read the owner’s signed receipts',
    description:
      'One receipt by id or the newest ones, as the owner reads them. Another account’s receipt is indistinguishable from a missing one.',
    input: receiptsReadInputSchema,
    output: receiptsReadOutputSchema,
  }),
] as const satisfies readonly ToolDefinition[];

export type AnyToolDefinition = (typeof AGENT_TOOLS)[number];

const BY_NAME: ReadonlyMap<string, AnyToolDefinition> = new Map(
  AGENT_TOOLS.map((definition) => [definition.name, definition]),
);

export function findTool(name: string): AnyToolDefinition | null {
  return BY_NAME.get(name) ?? null;
}

/** Whether a principal holding `scopes` (or every owner scope for a user session) may call the tool. */
export function mayCall(
  definition: Pick<ToolDefinition, 'scopes'>,
  principal: { readonly class: string; readonly scopes: readonly string[] },
): boolean {
  if (principal.class === 'user' && principal.scopes.includes('owner:*')) {
    return true;
  }
  if (principal.class !== 'user' && principal.class !== 'agent') {
    return false;
  }
  return definition.scopes.every((scope) => principal.scopes.includes(scope));
}

/** The tools this principal may call, in catalog order. */
export function toolsFor(principal: {
  readonly class: string;
  readonly scopes: readonly string[];
}): AnyToolDefinition[] {
  return AGENT_TOOLS.filter((definition) => mayCall(definition, principal));
}

/** JSON Schema of a validator, for the catalog a model client reads. */
export function jsonSchemaOf(
  schema: z.ZodTypeAny,
  io: 'input' | 'output',
): Record<string, unknown> {
  return z.toJSONSchema(schema, { unrepresentable: 'any', io }) as Record<string, unknown>;
}

export function describeTool(definition: AnyToolDefinition): AgentToolDescriptor {
  return {
    name: definition.name,
    family: definition.family,
    scopes: [...definition.scopes],
    mutation: definition.mutation,
    summary: definition.summary,
    description: definition.description,
    inputSchema: jsonSchemaOf(definition.input, 'input'),
    outputSchema: jsonSchemaOf(definition.output, 'output'),
  };
}

export interface ParsedInput {
  readonly ok: true;
  readonly value: unknown;
}
export interface ParseFailure {
  readonly ok: false;
  readonly issues: readonly { path: string; message: string }[];
}

/** Validates a tool input against its schema; the model's shape is never trusted. */
export function parseToolInput(
  definition: AnyToolDefinition,
  input: unknown,
): ParsedInput | ParseFailure {
  const result = definition.input.safeParse(input);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return {
    ok: false,
    issues: result.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.map(String).join('.') || '(root)',
      message: issue.message.slice(0, 200),
    })),
  };
}

/** Every agent scope with the tools it unlocks: the reviewed permission matrix. */
export function scopeMatrix(): Record<AgentScope, AgentToolName[]> {
  const matrix = {} as Record<AgentScope, AgentToolName[]>;
  for (const scope of AGENT_SCOPES) {
    matrix[scope] = [];
  }
  for (const definition of AGENT_TOOLS) {
    for (const scope of definition.scopes) {
      matrix[scope].push(definition.name);
    }
  }
  return matrix;
}
