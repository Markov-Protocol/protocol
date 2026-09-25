/**
 * @markov/model-xai
 *
 * xAI (Grok) adapters for the research and companion model contracts over
 * the OpenAI-compatible chat completions API (B17). No provider SDK: one
 * bounded HTTP client with a timeout, a byte cap, redacted errors and
 * classified failures; strict JSON parsing and deterministic validation of
 * everything the model says. The model never holds authority: its text is
 * validated by the research service and the companion loop before it is
 * stored or acted on.
 */
export * from './client.js';
export * from './companion.js';
export * from './research.js';
