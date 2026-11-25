import { File, Paths } from 'expo-file-system';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { supabase } from './supabase';

// Every Sarvam call goes through our server function "ai" (the Sarvam key never lives on the phone).
async function call<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('ai', { body });
  if (error) throw error;
  return data as T;
}

const memo = new Map<string, Promise<string>>();

/** Translate text into the reader's language. Same text + language is fetched once. */
export function translate(text: string, target: string): Promise<string> {
  const key = target + '|' + text;
  if (!memo.has(key)) {
    const p = call<{ text: string }>({ action: 'translate', text, target })
      .then((r) => r.text)
      .catch((e) => {
        memo.delete(key);
        throw e;
      });
    memo.set(key, p);
  }
  return memo.get(key)!;
}

let player: ReturnType<typeof createAudioPlayer> | null = null;

/** Read text aloud in a language (Sarvam text-to-speech). Returns false if not available. */
export async function listen(text: string, lang: string): Promise<boolean> {
  const { audio } = await call<{ audio: string | null }>({ action: 'tts', text, lang });
  if (!audio) return false;
  const file = new File(Paths.cache, `say-${Date.now()}.mp3`);
  await file.write(audio, { encoding: 'base64' });
  await setAudioModeAsync({ playsInSilentMode: true });
  player?.remove();
  player = createAudioPlayer({ uri: file.uri });
  player.play();
  return true;
}

/** Voice note -> text (Sarvam speech-to-text). */
export async function transcribe(uri: string): Promise<string> {
  const b64 = await new File(uri).base64();
  const r = await call<{ transcript: string }>({ action: 'stt', audio: b64, mime: 'audio/m4a' });
  return r.transcript;
}

/** Ask the helper to look at a gift message I just sent. It replies privately, if at all. */
export async function giftCheck(messageId: string) {
  try {
    await call({ action: 'gift_check', message_id: messageId });
  } catch {
    // A missed note is better than a wrong one.
  }
}
