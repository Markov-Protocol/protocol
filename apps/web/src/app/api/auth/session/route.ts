import { authDeps } from '@/server/auth/deps';
import { handleSessionGet } from '@/server/auth/handlers';

export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  return handleSessionGet(request, authDeps());
}
