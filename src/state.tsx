import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './lib/supabase';
import { setFlagIdentity } from './lib/flags';

export type Role = 'couple' | 'guest' | 'vendor';
export type Member = {
  wedding_id: string;
  user_id: string;
  role: Role;
  display_name: string;
  side: 'bride' | 'groom' | null;
  relation: string | null;
  language: string;
  paused: boolean;
  joined_at: string;
};
export type Wedding = { id: string; title: string; status: 'pending' | 'live' | 'ended'; helper_on: boolean };

export type Route =
  | { name: 'home' }
  | { name: 'room'; roomId: string }
  | { name: 'colours' }
  | { name: 'coupleView' }
  | { name: 'newSurprise' };

type Ctx = {
  session: Session | null;
  ready: boolean;
  me: Member | null; // my member row in the open wedding
  wedding: Wedding | null;
  myWeddings: (Member & { weddings: Wedding })[];
  openWedding: (id: string | null) => void;
  reloadWeddings: () => Promise<void>;
  route: Route;
  go: (r: Route) => void;
  back: () => void;
};

const AppCtx = createContext<Ctx>(null as unknown as Ctx);
export const useApp = () => useContext(AppCtx);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [myWeddings, setMyWeddings] = useState<(Member & { weddings: Wedding })[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const reloadWeddings = useCallback(async () => {
    if (!session) return setMyWeddings([]);
    const { data } = await supabase
      .from('members')
      .select('*, weddings(id, title, status, helper_on)')
      .eq('user_id', session.user.id)
      .order('joined_at', { ascending: false });
    const rows = (data ?? []) as (Member & { weddings: Wedding })[];
    setMyWeddings(rows);
    if (rows.length === 1 && !openId) setOpenId(rows[0].wedding_id);
  }, [session, openId]);

  useEffect(() => {
    reloadWeddings();
  }, [session]);

  const current = myWeddings.find((m) => m.wedding_id === openId) ?? null;

  // Flagsmith sees a random member code only (a hash of ids), never names or phone numbers.
  useEffect(() => {
    setFlagIdentity(current ? (current.user_id.slice(0, 8) + current.wedding_id.slice(0, 8)) : undefined);
  }, [current?.user_id, current?.wedding_id]);

  // Keep the wedding row fresh (status pending -> live, helper switch).
  useEffect(() => {
    if (!openId) return;
    const ch = supabase
      .channel('wed-' + openId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `wedding_id=eq.${openId}` }, () => reloadWeddings())
      .subscribe();
    const t = setInterval(reloadWeddings, 15_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [openId]);

  const value: Ctx = {
    session,
    ready,
    me: current,
    wedding: current?.weddings ?? null,
    myWeddings,
    openWedding: (id) => {
      setOpenId(id);
      setStack([{ name: 'home' }]);
    },
    reloadWeddings,
    route: stack[stack.length - 1],
    go: (r) => setStack((s) => [...s, r]),
    back: () => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)),
  };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}
