import { notFound } from 'next/navigation';
import { PostDetail } from '@/components/post-detail';

const UUID = /^[0-9a-f-]{36}$/i;

export default async function RequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  return <PostDetail kind="requirement" id={id} />;
}
