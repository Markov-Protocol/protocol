import { Button } from '@markov/ui';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12 sm:px-6">
      <h1 className="text-heading-md font-semibold">Page not found</h1>
      <p className="mt-2 text-body text-text-muted">There is nothing at this address.</p>
      <div className="mt-6">
        <Button asChild variant="secondary">
          <Link href="/">Back to home</Link>
        </Button>
      </div>
    </div>
  );
}
