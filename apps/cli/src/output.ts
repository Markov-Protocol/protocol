export interface CliIo {
  out(text: string): void;
  err(text: string): void;
}

export const stdio: CliIo = {
  out: (text) => process.stdout.write(`${text}\n`),
  err: (text) => process.stderr.write(`${text}\n`),
};

export function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export class CliExit extends Error {
  override readonly name = 'CliExit';
  readonly exitCode: number;

  constructor(message: string, exitCode: number) {
    super(message);
    this.exitCode = exitCode;
  }
}

export const EXIT_USAGE = 64;
export const EXIT_UNAVAILABLE = 69;
export const EXIT_CONFIG = 78;
