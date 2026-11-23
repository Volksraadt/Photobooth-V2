'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { googleSignInUrl, signIn, signOut, signUp } from '@/lib/auth';
import { field, type FormState } from '@/lib/form';

const Credentials = z.object({
  email: z.email({ message: 'Format email tidak valid.' }),
  password: z.string().min(8, { message: 'Kata sandi minimal 8 karakter.' }).max(200),
});

export async function authAction(_prev: FormState, form: FormData): Promise<FormState> {
  const intent = field(form, 'intent');
  const parsed = Credentials.safeParse({
    email: field(form, 'email').trim(),
    password: field(form, 'password'),
  });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]!.message };

  const { email, password } = parsed.data;
  const result =
    intent === 'signup' ? await signUp(email, password) : await signIn(email, password);
  if (!result.ok) return { status: result.info ? 'info' : 'error', message: result.message };
  redirect('/booths');
}

export async function googleAction(): Promise<void> {
  const url = await googleSignInUrl();
  redirect(url ?? '/login?error=google');
}

export async function logoutAction(): Promise<void> {
  await signOut();
  redirect('/login');
}
