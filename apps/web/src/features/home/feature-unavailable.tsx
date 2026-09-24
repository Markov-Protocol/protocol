import { Button, EmptyState } from '@markov/ui';
import Link from 'next/link';
import { routeInfoFor } from '@/shell/routes';

/** Honest placeholder for a navigation target whose feature has not been delivered. */
export function FeatureUnavailable({ pathname }: { readonly pathname: string }) {
  const info = routeInfoFor(pathname);
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <h1 className="mb-6 text-heading-lg font-semibold">{info.title}</h1>
      <EmptyState
        title={`${info.title} is not available in this build`}
        description={`This area arrives with frontend session ${info.arrivesWith ?? 'a later session'}${
          info.needsBackend ? ` and needs backend session ${info.needsBackend}` : ''
        }. Nothing here is simulated or pre-filled.`}
        action={
          <Button asChild variant="secondary">
            <Link href="/">Back to home</Link>
          </Button>
        }
      />
    </div>
  );
}
