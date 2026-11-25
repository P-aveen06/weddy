import { useEffect, useState } from 'react';

// Flagsmith: switches we can flip from the dashboard, no new build needed.
// Every flag has a safe default, used when Flagsmith can't be reached.
// Privacy rules (blocking the couple, blank notifications) are NEVER behind a flag.
export type Flags = {
  helper_on: boolean;
  sarvam_live: boolean;
  translate_mode: 'tap' | 'auto';
};

export const DEFAULT_FLAGS: Flags = { helper_on: true, sarvam_live: false, translate_mode: 'tap' };

const KEY = process.env.EXPO_PUBLIC_FLAGSMITH_KEY ?? '';
const URL = 'https://edge.api.flagsmith.com/api/v1/';

let current: Flags = DEFAULT_FLAGS;
const listeners = new Set<(f: Flags) => void>();

/** identity = a random member code, never a name or phone number. */
async function fetchFlags(identity?: string): Promise<Flags> {
  if (!KEY) return DEFAULT_FLAGS;
  const res = await fetch(identity ? `${URL}identities/?identifier=${encodeURIComponent(identity)}` : `${URL}flags/`, {
    headers: { 'X-Environment-Key': KEY },
  });
  if (!res.ok) throw new Error('flagsmith ' + res.status);
  const body = await res.json();
  const list: any[] = Array.isArray(body) ? body : body.flags ?? [];
  const next: Flags = { ...DEFAULT_FLAGS };
  for (const f of list) {
    const name = f.feature?.name;
    if (name === 'helper_on') next.helper_on = !!f.enabled;
    if (name === 'sarvam_live') next.sarvam_live = !!f.enabled;
    if (name === 'translate_mode' && (f.feature_state_value === 'auto' || f.feature_state_value === 'tap'))
      next.translate_mode = f.feature_state_value;
  }
  return next;
}

let started = false;
let identityCode: string | undefined;

export function setFlagIdentity(code: string | undefined) {
  identityCode = code;
  refresh();
}

async function refresh() {
  try {
    current = await fetchFlags(identityCode);
    listeners.forEach((l) => l(current));
  } catch {
    // Keep the last good values (or the defaults).
  }
}

/** Phones check when the app opens and every 30 seconds. */
export function useFlags(): Flags {
  const [flags, setFlags] = useState(current);
  useEffect(() => {
    listeners.add(setFlags);
    if (!started) {
      started = true;
      refresh();
      setInterval(refresh, 30_000);
    }
    return () => {
      listeners.delete(setFlags);
    };
  }, []);
  return flags;
}
