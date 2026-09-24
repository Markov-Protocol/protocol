import { z } from 'zod';

const mintedSchema = z.object({ identityToken: z.string().min(20) });

/**
 * NONPRODUCTION. Asks the API's in-process test issuer for an identity
 * token. The route only exists when the API runs `IDENTITY_PROVIDER=test`,
 * which its configuration refuses outside local and test; this call is
 * additionally gated by the web environment before it is ever made.
 */
export async function mintDevelopmentIdentityToken(
  apiOrigin: string,
  subject: string,
  fetchImpl: (request: Request) => Promise<Response>,
  forwardedFor: string | null = null,
): Promise<{ ok: true; identityToken: string } | { ok: false; status: number; message: string }> {
  const request = new Request(`${apiOrigin}/v1/auth/test-tokens`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {}),
    },
    body: JSON.stringify({ subject }),
    signal: AbortSignal.timeout(5000),
  });
  const response = await fetchImpl(request);
  if (response.status === 404) {
    return { ok: false, status: 404, message: 'the API does not run the development issuer' };
  }
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      message: `test issuer answered ${response.status}`,
    };
  }
  const parsed = mintedSchema.safeParse(await response.json());
  if (!parsed.success) {
    return { ok: false, status: 502, message: 'test issuer answered with an unexpected shape' };
  }
  return { ok: true, identityToken: parsed.data.identityToken };
}
