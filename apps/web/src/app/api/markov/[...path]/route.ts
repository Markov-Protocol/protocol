import { authDeps } from '@/server/auth/deps';
import { handleProxy } from '@/server/proxy/handler';

export const dynamic = 'force-dynamic';

type Context = { readonly params: Promise<{ readonly path: string[] }> };

async function forward(request: Request, context: Context): Promise<Response> {
  const { path } = await context.params;
  const deps = authDeps();
  return handleProxy(request, path, {
    env: deps.env,
    fetch: deps.fetch,
    forwardedFor: deps.forwardedFor,
  });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
