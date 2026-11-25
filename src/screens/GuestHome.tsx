import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { supabase, niceError } from '../lib/supabase';
import { useApp, Member } from '../state';
import Translated from '../components/Translated';
import { Button, C, Card, H, P, Screen, WallBadge } from '../ui';

type Room = { id: string; kind: 'gifts' | 'dresscode' | 'surprise' | 'vendor'; name: string; done: boolean; owner_id: string | null };
type Invite = { room_id: string; status: 'invited' | 'joined' };
type Announcement = { id: string; body: string; created_at: string };

const ROOM_ICON: Record<Room['kind'], string> = { gifts: '🎁', dresscode: '👗', surprise: '🤫', vendor: '🧑‍🍳' };

/** "Name · side · relation", so two guests with the same name can be told apart. */
export function who(m: Pick<Member, 'display_name' | 'side' | 'relation'>) {
  const side = m.side === 'bride' ? "Bride's side" : m.side === 'groom' ? "Groom's side" : 'Vendor';
  return [m.display_name, side, m.relation].filter(Boolean).join(' · ');
}

export default function GuestHome() {
  const { me, wedding, go, openWedding } = useApp();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [anns, setAnns] = useState<Announcement[]>([]);
  const [joiners, setJoiners] = useState<Member[]>([]);
  const wid = wedding!.id;

  const load = useCallback(async () => {
    const [r, i, a, m] = await Promise.all([
      supabase.from('rooms').select('id, kind, name, done, owner_id').eq('wedding_id', wid).order('created_at'),
      supabase.from('room_members').select('room_id, status').eq('user_id', me!.user_id),
      supabase.from('announcements').select('id, body, created_at').eq('wedding_id', wid).order('created_at', { ascending: false }).limit(5),
      supabase.from('members').select('*').eq('wedding_id', wid).eq('role', 'guest').order('joined_at', { ascending: false }).limit(20),
    ]);
    setRooms((r.data ?? []) as Room[]);
    setInvites((i.data ?? []) as Invite[]);
    const list = (a.data ?? []) as Announcement[];
    setAnns(list);
    setJoiners(((m.data ?? []) as Member[]).filter((x) => x.user_id !== me!.user_id));
    // Mark announcements as seen. The couple only ever gets the count.
    if (list.length) await supabase.from('announcement_seen').upsert(list.map((x) => ({ announcement_id: x.id, user_id: me!.user_id })), { ignoreDuplicates: true });
  }, [wid]);

  useEffect(() => {
    load();
    const ch = supabase
      .channel('guest-' + wid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `wedding_id=eq.${wid}` }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_members', filter: `user_id=eq.${me!.user_id}` }, load)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'members', filter: `wedding_id=eq.${wid}` }, load)
      .subscribe();
    const t = setInterval(load, 15_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [wid]);

  async function answer(roomId: string, accept: boolean) {
    const { error } = await supabase.rpc('respond_invite', { p_room: roomId, p_accept: accept });
    if (error) Alert.alert(niceError(error));
    load();
  }

  function flag(m: Member) {
    Alert.alert(`Flag ${m.display_name}?`, "They'll be paused from all rooms and removed from surprise rooms until 2 people from their side clear them.", [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Flag', style: 'destructive', onPress: async () => { await supabase.rpc('flag_member', { p_wedding: wid, p_user: m.user_id }); load(); } },
    ]);
  }

  async function clear(m: Member) {
    const { data, error } = await supabase.rpc('clear_flag', { p_wedding: wid, p_user: m.user_id });
    Alert.alert(error ? niceError(error) : data === 'cleared' ? 'Flag cleared ✅' : 'Thanks. One more person from their side needs to clear it.');
    load();
  }

  if (me!.paused)
    return (
      <Screen title={wedding!.title} right={<Text onPress={() => openWedding(null)} style={{ color: C.brand }}>Switch</Text>}>
        <Card>
          <P>⏸ You're paused for now. Someone wasn't sure who you are. Two people from your side can clear this. Please ask someone in your family.</P>
        </Card>
      </Screen>
    );

  const pendingInvites = invites.filter((i) => i.status === 'invited');
  const visibleRooms = rooms.filter((r) => r.kind !== 'surprise' || invites.some((i) => i.room_id === r.id && i.status === 'joined'));

  return (
    <Screen title={wedding!.title} right={<Text onPress={() => openWedding(null)} style={{ color: C.brand }}>Switch</Text>}>
      {pendingInvites.map((inv) => {
        const room = rooms.find((r) => r.id === inv.room_id);
        return (
          <Card key={inv.room_id} style={{ borderColor: C.gold }}>
            <P>You've been invited to a surprise 🤫{room ? ` "${room.name}"` : ''}. Join?</P>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Button small title="Join" onPress={() => answer(inv.room_id, true)} /></View>
              <View style={{ flex: 1 }}><Button small kind="ghost" title="No thanks" onPress={() => answer(inv.room_id, false)} /></View>
            </View>
          </Card>
        );
      })}

      <H>Announcements</H>
      {anns.length === 0 && <P soft>Nothing from the couple yet.</P>}
      {anns.map((a) => (
        <Card key={a.id}>
          <Translated text={a.body} lang={me!.language} auto />
        </Card>
      ))}

      <H>Rooms</H>
      <WallBadge />
      {visibleRooms.map((r) => (
        <Card key={r.id} onPress={() => go({ name: 'room', roomId: r.id })}>
          <Text style={{ fontSize: 17 }}>{ROOM_ICON[r.kind]} {r.name}{r.done ? ' · done 🎉' : ''}</Text>
        </Card>
      ))}
      <Button title="🤫 Start a surprise room" kind="ghost" onPress={() => go({ name: 'newSurprise' })} />
      <Button title="🎨 What are the couple wearing?" kind="ghost" onPress={() => go({ name: 'colours' })} />
      <Button title="👀 See what the couple sees" kind="ghost" onPress={() => go({ name: 'coupleView' })} />

      <H>New joiners</H>
      <P soft>Don't recognise someone? Flag them. They're paused until 2 people from their side clear them.</P>
      {joiners.map((m) => (
        <Card key={m.user_id}>
          <Text style={{ fontSize: 16 }}>{who(m)}</Text>
          {m.paused ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <P soft>⏸ Paused</P>
              {m.side === me!.side && <Button small kind="ghost" title="I know them, clear" onPress={() => clear(m)} />}
            </View>
          ) : (
            <Text onPress={() => flag(m)} style={{ color: C.soft, marginTop: 4, fontSize: 13 }}>⚑ Flag</Text>
          )}
        </Card>
      ))}
    </Screen>
  );
}
