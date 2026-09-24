/**
 * @markov/cli
 *
 * Operator and developer command line. Every command goes through the same
 * domain packages as the services; nothing here bypasses configuration
 * validation or platform identity checks.
 */
export { buildProgram } from './program.js';
