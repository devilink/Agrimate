import { Suspense } from 'react';
import { ListSkeleton } from '@/components/ui';
import { SelfCertClient } from './self-cert-client';

export default function SelfCertPage() {
  return <Suspense fallback={<ListSkeleton />}><SelfCertClient /></Suspense>;
}
