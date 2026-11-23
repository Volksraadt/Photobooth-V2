import { NextResponse, type NextRequest } from 'next/server';
import { authMode } from '@/lib/env';
import { createSupabaseServerClient } from '@/lib/supabase';

/** Supabase email-confirmation / OAuth (Google) redirect target. */
export async function GET(request: NextRequest) {
  const { origin, searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  if (authMode() !== 'supabase' || !code)
    return NextResponse.redirect(`${origin}/login?error=callback`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(error ? `${origin}/login?error=callback` : `${origin}/booths`);
}
