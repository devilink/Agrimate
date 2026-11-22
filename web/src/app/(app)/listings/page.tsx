import { MyPosts } from '@/components/my-posts';

export const metadata = { title: 'Listings' };

export default async function ListingsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <MyPosts kind="listing" status={status} />;
}
