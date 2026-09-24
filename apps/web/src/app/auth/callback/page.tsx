import type { Metadata } from 'next';
import { type CallbackOutcome, CallbackView, sanitiseDetail } from '@/features/auth/callback-view';
import { safeReturnPath } from '@/features/auth/return-path';

export const metadata: Metadata = { title: 'Sign-in callback' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Provider redirect target. The parameters follow the OAuth 2.0 error
 * response shape (`error`, `error_description`) and authorization code
 * shape (`code`, `state`); a code is acknowledged but not exchanged because
 * no hosted provider adapter is configured yet (OD-05).
 */
export default async function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  const params = await searchParams;
  const error = first(params['error']);
  const code = first(params['code']);
  let outcome: CallbackOutcome = 'none';
  if (error === 'access_denied' || error === 'login_required' || error === 'interaction_required') {
    outcome = 'cancelled';
  } else if (error) {
    outcome = 'failed';
  } else if (code) {
    outcome = 'unsupported';
  }
  return (
    <CallbackView
      outcome={outcome}
      detail={outcome === 'failed' ? sanitiseDetail(params['error_description']) : null}
      next={safeReturnPath(first(params['next']))}
    />
  );
}
