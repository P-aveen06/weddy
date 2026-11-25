import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Public values only. The anon key is safe in the app: row level security on the
// server decides what each person can read. Secrets (Sarvam, Twilio) never live here.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/** Turn a Supabase error into a short, polite sentence for the screen. */
export function niceError(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  return msg.replace(/^.*?exception:\s*/i, '');
}
