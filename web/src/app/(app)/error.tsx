'use client';

import { ErrorView } from '@/components/error-view';

// Keeps the sidebar on screen when a single page fails.
export default function AppError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
