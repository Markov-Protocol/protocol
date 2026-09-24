import type { Metadata } from 'next';
import { FeatureUnavailable } from '@/features/home/feature-unavailable';

export const metadata: Metadata = { title: 'Build a strategy' };

export default function Page() {
  return <FeatureUnavailable pathname="/strategies/new" />;
}
