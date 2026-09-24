import { BootError, bootWorker, EXIT_SOFTWARE } from './boot.js';

async function main(): Promise<void> {
  let booted: Awaited<ReturnType<typeof bootWorker>>;
  try {
    booted = await bootWorker();
  } catch (error) {
    if (error instanceof BootError) {
      process.stderr.write(`markov-worker failed to start: ${error.message}\n`);
      process.exit(error.exitCode);
    }
    process.stderr.write(
      `markov-worker crashed during boot: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(EXIT_SOFTWARE);
  }

  const stop = (signal: NodeJS.Signals) => {
    process.stderr.write(`markov-worker received ${signal}; draining\n`);
    const hardExit = setTimeout(
      () => process.exit(EXIT_SOFTWARE),
      booted.config.shutdownTimeoutMs + 5_000,
    );
    hardExit.unref();
    booted.shutdown();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    await booted.run();
    process.exit(0);
  } catch (error) {
    process.stderr.write(
      `markov-worker stopped with an error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(EXIT_SOFTWARE);
  }
}

void main();
