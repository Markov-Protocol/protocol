/** A dependency a test does not exercise: any use is a loud failure, never a silent stub. */
export function unavailable<T extends object>(name: string): T {
  return new Proxy({} as T, {
    get: () => () => {
      throw new Error(`${name} service is not part of this test`);
    },
  });
}
