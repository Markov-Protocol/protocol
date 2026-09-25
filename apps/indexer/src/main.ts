import { BootError, bootIndexer, EXIT_SOFTWARE } from './boot.js';

/** `markov-indexer [--once]`: follow publications and mirror registry records. */
async function main(): Promise<void> {
  const once = process.argv.includes('--once');
  let booted: Awaited<ReturnType<typeof bootIndexer>>;
  try {
    booted = await bootIndexer();
  } catch (error) {
    if (error instanceof BootError) {
      process.stderr.write(`markov-indexer failed to start: ${error.message}\n`);
      process.exit(error.exitCode);
    }
    process.stderr.write(
      `markov-indexer crashed during boot: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(EXIT_SOFTWARE);
  }
  if (once) {
    try {
      const report = await booted.runOnce();
      process.stdout.write(`${JSON.stringify(report ?? { idle: true })}\n`);
      await booted.dbClient.close();
      process.exit(0);
    } catch (error) {
      process.stderr.write(
        `markov-indexer pass failed: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
      );
      process.exit(EXIT_SOFTWARE);
    }
  }
  const stop = (signal: NodeJS.Signals) => {
    process.stderr.write(`markov-indexer received ${signal}; stopping\n`);
    booted.shutdown();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  await booted.run();
  process.exit(0);
}

void main();
