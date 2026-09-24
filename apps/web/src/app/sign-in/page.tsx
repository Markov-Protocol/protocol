import type { Metadata } from 'next';
import { safeReturnPath } from '@/features/auth/return-path';
import { SignInView } from '@/features/auth/sign-in-view';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Page({ searchParams }: { readonly searchParams: SearchParams }) {
  const params = await searchParams;
  const next = safeReturnPath(first(params['next']));
  const switching = first(params['switch']) === '1';
  return <SignInView next={next} switching={switching} />;
}
