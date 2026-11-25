// Weddy "ai" function: every Sarvam AI call goes through here, so the Sarvam key
// never lives on a phone. It also runs the helper's duplicate-gift check.
//
// Actions:
//   translate  { text, target }            -> { text }
//   tts        { text, lang }              -> { audio }   (base64 mp3, or null in mock mode)
//   stt        { audio, mime }             -> { transcript, lang }
//   gift_check { message_id }              -> { noted: boolean }
//
// Mock mode: when the Flagsmith switch "sarvam_live" is off, nothing is sent to
// Sarvam and sample answers come back. This keeps spend at zero while building.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SARVAM = 'https://api.sarvam.ai';
const SARVAM_KEY = Deno.env.get('SARVAM_API_KEY') ?? '';
const FLAGSMITH_KEY = Deno.env.get('FLAGSMITH_ENV_KEY') ?? '';
const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// ---------- Flagsmith (server checks the same switches as the phones) ----------
let flagCache: { at: number; flags: Record<string, { enabled: boolean; value: unknown }> } | null = null;
async function flag(name: string, fallback: boolean): Promise<boolean> {
  if (!FLAGSMITH_KEY) return fallback;
  try {
    if (!flagCache || Date.now() - flagCache.at > 30_000) {
      const r = await fetch('https://edge.api.flagsmith.com/api/v1/flags/', { headers: { 'X-Environment-Key': FLAGSMITH_KEY } });
      const list = await r.json();
      const flags: Record<string, { enabled: boolean; value: unknown }> = {};
      for (const f of list) flags[f.feature.name] = { enabled: f.enabled, value: f.feature_state_value };
      flagCache = { at: Date.now(), flags };
    }
    return flagCache.flags[name]?.enabled ?? fallback;
  } catch {
    return fallback;
  }
}
const live = () => flag('sarvam_live', false).then((v) => v && !!SARVAM_KEY);

// ---------- Cache: same text + same language = paid once ----------
async function sha(s: string) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const inflight = new Map<string, Promise<string | null>>();
async function cached(kind: string, input: string, make: () => Promise<string | null>): Promise<string | null> {
  const key = kind + ':' + (await sha(input));
  const hit = await admin.from('ai_cache').select('value').eq('key', key).maybeSingle();
  if (hit.data) return hit.data.value;
  // Single-flight: 40 people opening the same announcement = 1 Sarvam call.
  if (inflight.has(key)) return inflight.get(key)!;
  const p = (async () => {
    const v = await make();
    if (v) await admin.from('ai_cache').upsert({ key, value: v });
    return v;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function sarvamJSON(path: string, body: unknown, tries = 3): Promise<any> {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(SARVAM + path, {
      method: 'POST',
      headers: { 'api-subscription-key': SARVAM_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.ok) return r.json();
    if (r.status === 402) throw new Error('credit_used_up'); // stop retrying, show originals
    if (r.status !== 429 && r.status < 500) throw new Error('sarvam ' + r.status + ' ' + (await r.text()));
    await new Promise((res) => setTimeout(res, 500 * 2 ** i)); // growing gaps
  }
  throw new Error('sarvam busy');
}

// ---------- The four Sarvam services ----------
async function translate(text: string, target: string): Promise<string> {
  if (!text.trim()) return text;
  if (!(await live())) return target.startsWith('en') ? text : `[${target}] ${text}`;
  const out = await cached('tr:' + target, text, async () => {
    const r = await sarvamJSON('/translate', {
      input: text.slice(0, 1000),
      source_language_code: 'auto',
      target_language_code: target,
      model: 'mayura:v1',
      mode: 'modern-colloquial',
    });
    return r.translated_text as string;
  });
  return out ?? text;
}

async function tts(text: string, lang: string): Promise<string | null> {
  if (!(await live())) return null;
  return cached('tts:' + lang, text, async () => {
    const r = await sarvamJSON('/text-to-speech', {
      text: text.slice(0, 2500),
      language_code: lang,
      model: 'bulbul:v3',
      speaker: 'priya',
      output_audio_codec: 'mp3',
    });
    return r.audios?.[0] ?? null;
  });
}

async function stt(audioB64: string, mime: string): Promise<{ transcript: string; lang: string | null }> {
  if (!(await live())) return { transcript: "I'll bring a silver lamp for them", lang: 'en-IN' };
  const bytes = Uint8Array.from(atob(audioB64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: mime || 'audio/m4a' }), 'note.m4a');
  form.append('model', 'saaras:v4');
  form.append('language_code', 'unknown');
  const r = await fetch(SARVAM + '/speech-to-text', { method: 'POST', headers: { 'api-subscription-key': SARVAM_KEY }, body: form });
  if (!r.ok) throw new Error('stt ' + r.status);
  const b = await r.json();
  return { transcript: b.transcript ?? '', lang: b.language_code ?? null };
}

async function chat(system: string, user: string): Promise<string> {
  const r = await sarvamJSON('/v1/chat/completions', {
    model: 'sarvam-105b',
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_tokens: 1500,
    temperature: 0.1,
  });
  return r.choices?.[0]?.message?.content ?? '';
}

// ---------- Helper job 1: stop duplicate gifts ----------
const FIXED_IDEAS = ['Dinner set', 'Pressure cooker', 'Bedsheet set', 'Wall clock', 'Photo frame', 'Mixer grinder', 'Pooja thali', 'Table lamp'];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'for', 'set'].includes(w));
function sameGift(a: string, b: string) {
  const A = new Set(norm(a)), B = norm(b);
  if (!A.size || !B.length) return false;
  const shared = B.filter((w) => A.has(w)).length;
  return shared / Math.min(A.size, B.length) >= 0.5;
}

/** Which gift is this message about, in plain English? null if none. */
async function findGift(text: string, known: string[]): Promise<string | null> {
  // Mock mode, or a quick win: a known gift name appears in the text.
  const direct = known.find((k) => sameGift(text, k));
  if (direct) return direct;
  if (!(await live())) {
    const m = text.toLowerCase().match(/(?:bring|buy|get|gift(?:ing)?)\s+(?:a|an|the)?\s*([a-z ]{3,30})/);
    return m ? m[1].replace(/\s+(for|to)\s.*$/, '').trim() : null;
  }
  const out = await chat(
    'You read one wedding guest message (any Indian language, Hinglish or Tanglish). If the guest says they will give or buy a specific gift for the couple, reply with ONLY JSON {"gift":"<short English gift name>"}. Otherwise reply ONLY {"gift":null}. No other text.',
    text,
  );
  const m = out.match(/\{[^{}]*"gift"[^{}]*\}/);
  try {
    return m ? JSON.parse(m[0]).gift ?? null : null;
  } catch {
    return null;
  }
}

async function giftCheck(userId: string, messageId: string) {
  const { data: msg } = await admin.from('messages').select('id, room_id, sender_id, body').eq('id', messageId).maybeSingle();
  if (!msg || msg.sender_id !== userId || !msg.body) return { noted: false };
  const { data: room } = await admin.from('rooms').select('id, wedding_id, kind').eq('id', msg.room_id).single();
  if (!room || !['gifts', 'surprise'].includes(room.kind)) return { noted: false };
  const { data: wedding } = await admin.from('weddings').select('helper_on').eq('id', room.wedding_id).single();
  const { data: me } = await admin.from('members').select('role, language, paused').eq('wedding_id', room.wedding_id).eq('user_id', userId).single();
  // Fully off means off: the couple's switch and our Flagsmith safety switch.
  if (!wedding?.helper_on || !(await flag('helper_on', true)) || me?.role !== 'guest' || me.paused) return { noted: false };

  const { data: gifts } = await admin.from('gifts').select('id, name, claimed_by').eq('wedding_id', room.wedding_id);
  const all = gifts ?? [];
  const gift = await findGift(msg.body, all.map((g) => g.name));
  if (!gift) return { noted: false }; // vague or unclear: say nothing rather than guess

  const match = all.find((g) => sameGift(g.name, gift));
  const lang = me.language ?? 'en-IN';
  let text: string;
  let meta: Record<string, unknown>;

  if (match && match.claimed_by && match.claimed_by !== userId) {
    // Already covered by someone else. Never say who.
    const ideas = all.filter((g) => !g.claimed_by).map((g) => ({ id: g.id, name: g.name }));
    for (const name of FIXED_IDEAS) {
      if (ideas.length >= 3) break;
      if (!all.some((g) => sameGift(g.name, name))) ideas.push({ id: null as unknown as string, name });
    }
    const three = ideas.slice(0, 3);
    text = await translate(`Someone already has a ${match.name.toLowerCase()} covered 🎁. Here are 3 ideas nobody has claimed yet.`, lang);
    meta = { type: 'gift_taken', ideas: await Promise.all(three.map(async (i) => ({ ...i, label: await translate(i.name, lang) }))) };
  } else if (match && match.claimed_by === userId) {
    return { noted: false };
  } else if (match && !match.claimed_by) {
    text = await translate(`Nobody has claimed the ${match.name.toLowerCase()} yet 🎁. Want to claim it?`, lang);
    meta = { type: 'gift_offer', ideas: [{ id: match.id, name: match.name, label: await translate('Claim', lang) }] };
  } else {
    text = await translate(`Nobody has claimed a ${gift.toLowerCase()} yet 🎁. Want to claim it so nobody else buys one?`, lang);
    meta = { type: 'gift_offer', ideas: [{ id: null, name: gift, label: await translate('Claim', lang) }] };
  }
  // A private note under the guest's own message. Only they can see it.
  await admin.from('messages').insert({ room_id: room.id, kind: 'helper', body: text, private_to: userId, meta: { ...meta, about: msg.id } });
  return { noted: true };
}

// ---------- Entry ----------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const jwt = (req.headers.get('Authorization') ?? '').replace('Bearer ', '');
    const { data: auth } = await admin.auth.getUser(jwt);
    if (!auth.user) return json({ error: 'Please sign in' }, 401);
    const body = await req.json();
    switch (body.action) {
      case 'translate':
        return json({ text: await translate(String(body.text ?? ''), String(body.target ?? 'en-IN')) });
      case 'tts':
        return json({ audio: await tts(String(body.text ?? ''), String(body.lang ?? 'en-IN')) });
      case 'stt':
        return json(await stt(String(body.audio ?? ''), String(body.mime ?? 'audio/m4a')));
      case 'gift_check':
        return json(await giftCheck(auth.user.id, String(body.message_id)));
      default:
        return json({ error: 'unknown action' }, 400);
    }
  } catch (e) {
    const m = (e as Error).message;
    if (m === 'credit_used_up' || m === 'sarvam busy') return json({ error: 'Translation not available right now' }, 503);
    return json({ error: m }, 500);
  }
});
