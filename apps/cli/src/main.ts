#!/usr/bin/env node
import { CommanderError } from 'commander';
import { CliExit, EXIT_USAGE } from './output.js';
import { buildProgram } from './program.js';

// A closed pipe (for example `markov db status | head`) is not an error.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') {
    process.exit(0);
  }
  throw error;
});

async function main(): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof CliExit) {
      process.stderr.write(`${error.message}\n`);
      process.exit(error.exitCode);
    }
    if (error instanceof CommanderError) {
      // commander already printed help/version or a usage error
      process.exit(error.exitCode === 0 ? 0 : EXIT_USAGE);
    }
    process.stderr.write(
      `markov: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(70);
  }
}

void main();
