import type { Metadata } from 'next';
import { FeatureUnavailable } from '@/features/home/feature-unavailable';

export const metadata: Metadata = { title: 'Status' };

export default function Page() {
  return <FeatureUnavailable pathname="/status" />;
}
