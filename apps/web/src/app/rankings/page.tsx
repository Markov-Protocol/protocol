import type { Metadata } from 'next';
import { FeatureUnavailable } from '@/features/home/feature-unavailable';

export const metadata: Metadata = { title: 'Rankings' };

export default function Page() {
  return <FeatureUnavailable pathname="/rankings" />;
}
