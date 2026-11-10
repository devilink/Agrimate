import { Suspense } from 'react';
import { ListSkeleton } from '@/components/ui';
import { DispatchClient } from './dispatch-client';

export default function DispatchPage() {
  return <Suspense fallback={<ListSkeleton />}><DispatchClient /></Suspense>;
}
