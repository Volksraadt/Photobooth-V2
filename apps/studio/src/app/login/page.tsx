import { Alert, Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@pb/ui';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import { authMode } from '@/lib/env';
import { googleAction } from './actions';
import { LoginForm } from './login-form';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getCurrentUser()) redirect('/booths');
  const { error } = await searchParams;
  const supabase = authMode() === 'supabase';

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Photobooth Studio</CardTitle>
          <CardDescription>Masuk atau daftar untuk mengelola booth Anda.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="destructive">Gagal masuk. Silakan coba lagi.</Alert>}
          <LoginForm />
          <div className="relative py-1 text-center text-xs text-muted-foreground">atau</div>
          <form action={googleAction}>
            <Button type="submit" variant="outline" className="w-full" disabled={!supabase}>
              Masuk dengan Google
            </Button>
          </form>
          {!supabase && (
            <p className="text-xs text-muted-foreground">
              Mode dev: login Google aktif saat <code>PB_AUTH_MODE=supabase</code>.
            </p>
          )}
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/tentang" className="underline">
              Tentang
            </Link>{' '}
            ·{' '}
            <Link href="/privasi" className="underline">
              Kebijakan Privasi
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
