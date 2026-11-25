# Weddy 💍

Plan the wedding together. The couple never sees the surprises.

Built at Festive Hacks (BIEC Bengaluru, 25 Nov 2026) with Expo (iPhone), Supabase, Sarvam AI and Flagsmith.

## How it works (one line each)

- **Sign in:** phone number + code. The code check is a placeholder for now (code `123456`), see `src/lib/verify.ts`.
- **Couple:** bride or groom creates the wedding, the partner joins with a private couple code, then the wedding goes live.
- **Guests:** scan the invitation QR, pick side, relation and language. In automatically, no quiz.
- **The wall:** the server (row level security in `supabase/migrations/0001_init.sql`) decides who sees what. The couple's phone never receives rooms, members, gifts or messages.
- **Surprise rooms:** hidden, invite-only, Face ID to open, screenshots blocked.
- **Gifts:** claim a gift. Nobody sees who claimed what. The helper privately warns when a gift is already taken, even in a voice note.
- **Sarvam AI:** translate, read aloud, voice notes to text, gift detection (`supabase/functions/ai`).
- **Flagsmith:** `helper_on`, `sarvam_live`, `translate_mode` switches, changed live without a new build.

## Setup

1. Supabase SQL editor: run `supabase/migrations/0001_init.sql`.
2. Supabase, Authentication, Sign In / Providers, Email: turn **off** "Confirm email" (needed by the placeholder sign-in).
3. Supabase Edge Function secrets: `SARVAM_API_KEY`, `FLAGSMITH_ENV_KEY`. Deploy: `npx supabase functions deploy ai --project-ref <ref>`.
4. Flagsmith flags: `helper_on` (on), `sarvam_live` (off while building), `translate_mode` (value `tap` or `auto`).
5. Copy `.env.example` to `.env` and fill it in. Then `npm install` and `npx expo start --tunnel`, and scan the QR with the iPhone camera (Expo Go app).
