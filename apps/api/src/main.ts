import { BootError, bootApi, EXIT_SOFTWARE } from './boot.js';

let booted: Awaited<ReturnType<typeof bootApi>> | null = null;

async function main(): Promise<void> {
  try {
    booted = await bootApi();
  } catch (error) {
    if (error instanceof BootError) {
      process.stderr.write(`markov-api failed to start: ${error.message}\n`);
      process.exit(error.exitCode);
    }
    process.stderr.write(
      `markov-api crashed during boot: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exit(EXIT_SOFTWARE);
  }

  const stop = (signal: NodeJS.Signals) => {
    process.stderr.write(`markov-api received ${signal}\n`);
    const hardExit = setTimeout(
      () => process.exit(EXIT_SOFTWARE),
      (booted?.config.shutdownTimeoutMs ?? 10_000) + 5_000,
    );
    hardExit.unref();
    void booted?.shutdown().then(
      () => process.exit(0),
      () => process.exit(EXIT_SOFTWARE),
    );
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

void main();
