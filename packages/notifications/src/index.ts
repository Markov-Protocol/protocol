/**
 * @markov/notifications
 *
 * Notification rules and adapters (B16): routing of owner events and
 * schedule outcomes to categories, titles, bodies and links; channels under
 * the owner's preferences; plain-text email rendering without credentials;
 * the email adapter contract with a recording fixture and a configured HTTP
 * provider; verification-code hashing; retry backoff.
 */
export * from './email.js';
export * from './routing.js';
