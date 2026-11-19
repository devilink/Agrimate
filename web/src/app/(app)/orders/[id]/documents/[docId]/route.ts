import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';

const UUID = /^[0-9a-f-]{36}$/i;

/** Opens a document through a 60-second signed link, after row-level security confirms the user may see it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
  const { id, docId } = await params;
  if (!UUID.test(id) || !UUID.test(docId)) return new NextResponse('Not found', { status: 404 });

  const supabase = await createClient();
  const { data: doc } = await supabase.from('documents').select('storage_path, order_id')
    .eq('id', docId).eq('order_id', id).maybeSingle();
  if (!doc) return new NextResponse('Not found', { status: 404 });

  const { data, error } = await adminClient().storage.from('documents').createSignedUrl(doc.storage_path, 60);
  if (error || !data) return new NextResponse('Not found', { status: 404 });
  return NextResponse.redirect(data.signedUrl);
}
