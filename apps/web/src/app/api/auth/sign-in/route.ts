import { authDeps } from '@/server/auth/deps';
import { handleSignIn } from '@/server/auth/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleSignIn(request, authDeps());
}
