import { MyPosts } from '@/components/my-posts';

export const metadata = { title: 'Requirements' };

export default async function RequirementsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <MyPosts kind="requirement" status={status} />;
}
