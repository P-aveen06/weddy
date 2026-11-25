import { supabase } from './supabase';

/**
 * PHONE CODE CHECK: PLACEHOLDER.
 *
 * Today: no SMS is sent and the code is always 123456. Under the hood the phone
 * number becomes a Supabase account (p<digits>@phone.weddy.app), so the same
 * number is the same person on every phone, and the server can read the number.
 *
 * To go live, swap the two functions below for the real provider, e.g.
 *   sendCode:  supabase.auth.signInWithOtp({ phone })
 *   checkCode: supabase.auth.verifyOtp({ phone, token: code, type: 'sms' })
 * Nothing else in the app changes: the server's my_phone() already prefers a
 * real verified phone when there is one.
 */
export const PLACEHOLDER_CODE = '123456';
export const IS_PLACEHOLDER = true;

export function digits(phone: string) {
  return phone.replace(/\D/g, '');
}

export async function sendCode(_phone: string): Promise<void> {
  // Placeholder: nothing is sent.
}

export async function checkCode(phone: string, code: string): Promise<void> {
  if (code.trim() !== PLACEHOLDER_CODE) throw new Error('That code did not work. Please try again.');
  const d = digits(phone);
  const email = `p${d}@phone.weddy.app`;
  const password = `weddy-placeholder-${d}`;
  const signIn = await supabase.auth.signInWithPassword({ email, password });
  if (!signIn.error) return;
  const signUp = await supabase.auth.signUp({ email, password, options: { data: { phone: d } } });
  if (signUp.error) throw signUp.error;
  if (!signUp.data.session) throw new Error('Sign-in needs "Confirm email" switched off in Supabase for now.');
}
