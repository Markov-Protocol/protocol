import { authDeps } from '@/server/auth/deps';
import { handleSignOut } from '@/server/auth/handlers';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleSignOut(request, authDeps());
}
