import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { supabase, niceError } from '../lib/supabase';
import { giftCheck, transcribe } from '../lib/ai';
import { useFlags } from '../lib/flags';
import { useApp, Member } from '../state';
import Translated from '../components/Translated';
import { Button, C, Card, H, Input, P, Screen, WallBadge } from '../ui';
import { who } from './GuestHome';

type Room = { id: string; wedding_id: string; kind: 'gifts' | 'dresscode' | 'surprise' | 'vendor'; name: string; done: boolean; owner_id: string | null };
type Msg = { id: string; sender_id: string | null; kind: 'text' | 'voice' | 'system' | 'helper'; body: string | null; private_to: string | null; meta: any; created_at: string };
type Gift = { id: string; name: string; claimed: boolean; mine: boolean };

/** Surprise rooms stay hidden from screenshots, on iPhone too. */
function NoScreenshots() {
  usePreventScreenCapture('surprise');
  return null;
}

export default function RoomScreen({ roomId }: { roomId: string }) {
  const { me, wedding, back } = useApp();
  const flags = useFlags();
  const [room, setRoom] = useState<Room | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [names, setNames] = useState<Record<string, Member>>({});
  const [text, setText] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [gifts, setGifts] = useState<Gift[]>([]);
  const [newGift, setNewGift] = useState('');
  const [manage, setManage] = useState(false);
  const [members, setMembers] = useState<{ user_id: string; status: string }[]>([]);
  const [recording, setRecording] = useState(false);
  const [sending, setSending] = useState(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const list = useRef<FlatList<Msg>>(null);
  const wid = wedding!.id;

  const loadMsgs = useCallback(async () => {
    const { data } = await supabase.from('messages').select('*').eq('room_id', roomId).order('created_at');
    setMsgs((data ?? []) as Msg[]);
  }, [roomId]);

  const loadGifts = useCallback(async () => {
    const { data } = await supabase.from('gift_list').select('id, name, claimed, mine').eq('wedding_id', wid).order('created_at');
    setGifts((data ?? []) as Gift[]);
  }, [wid]);

  const loadMembers = useCallback(async () => {
    const { data } = await supabase.from('room_members').select('user_id, status').eq('room_id', roomId);
    setMembers(data ?? []);
  }, [roomId]);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('rooms').select('*').eq('id', roomId).maybeSingle();
      setRoom(data as Room);
      // App lock: a surprise room opens only with this phone's own Face ID, fingerprint or passcode.
      if (data?.kind === 'surprise') {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: 'Open the surprise room' });
        if (!r.success) return back();
      }
      setUnlocked(true);
    })();
    supabase.from('members').select('*').eq('wedding_id', wid).then(({ data }) => {
      const map: Record<string, Member> = {};
      (data ?? []).forEach((m: Member) => (map[m.user_id] = m));
      setNames(map);
    });
    loadMsgs();
    loadGifts();
    loadMembers();
    const ch = supabase
      .channel('room-' + roomId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, loadMsgs)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'gifts', filter: `wedding_id=eq.${wid}` }, loadGifts)
      .subscribe();
    const t = setInterval(() => { loadMsgs(); loadGifts(); }, 8_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [roomId]);

  async function send(body: string, kind: 'text' | 'voice' = 'text') {
    if (!body.trim()) return;
    setSending(true);
    const { data, error } = await supabase.from('messages').insert({ room_id: roomId, sender_id: me!.user_id, kind, body: body.trim() }).select('id').single();
    setSending(false);
    if (error) return Alert.alert(niceError(error));
    setText('');
    loadMsgs();
    // The helper quietly checks gift mentions. If it has a note, only I see it.
    if (flags.helper_on && (room?.kind === 'gifts' || room?.kind === 'surprise')) giftCheck(data.id).then(loadMsgs);
  }

  async function toggleRecord() {
    if (!recording) {
      const p = await requestRecordingPermissionsAsync();
      if (!p.granted) return Alert.alert('Please allow the microphone to send voice notes.');
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } else {
      await recorder.stop();
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
      if (!recorder.uri) return;
      setSending(true);
      try {
        const transcript = await transcribe(recorder.uri);
        await send('🎤 ' + transcript, 'voice');
      } catch {
        Alert.alert("Couldn't read that voice note. Please try again.");
      }
      setSending(false);
    }
  }

  async function claim(idea: { id: string | null; name: string }) {
    const r = idea.id
      ? await supabase.rpc('claim_gift', { p_gift: idea.id })
      : await supabase.rpc('add_and_claim_gift', { p_wedding: wid, p_name: idea.name });
    if (r.error) return Alert.alert(niceError(r.error));
    if (r.data === false) Alert.alert('Someone just claimed that one 🙏. Try another idea.');
    loadGifts();
  }

  async function addGiftIdea() {
    const { error } = await supabase.from('gifts').insert({ wedding_id: wid, name: newGift.trim() });
    if (error) return Alert.alert(niceError(error));
    setNewGift('');
    loadGifts();
  }

  if (!room || !unlocked) return <Screen title="" onBack={back}><P soft>Opening…</P></Screen>;

  const isOwner = room.owner_id === me!.user_id;
  const visible = msgs.filter((m) => !m.private_to || m.private_to === me!.user_id);

  function renderMsg({ item: m }: { item: Msg }) {
    if (m.kind === 'system')
      return <Text style={{ textAlign: 'center', color: C.soft, fontSize: 13, marginVertical: 6 }}>{m.body}</Text>;
    if (m.kind === 'helper') {
      const ideas: { id: string | null; name: string; label?: string }[] = m.meta?.ideas ?? [];
      return (
        <View style={{ backgroundColor: C.helper, borderRadius: 14, padding: 12, marginVertical: 4, marginLeft: 24 }}>
          {/* Buttons first, so elders can tap instead of type. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
            {ideas.map((i) => {
              const done = gifts.some((g) => g.name.toLowerCase() === i.name.toLowerCase() && g.claimed);
              return (
                <Pressable key={i.name} disabled={done} onPress={() => claim(i)} style={{ backgroundColor: done ? '#DDE3F0' : C.helperInk, borderRadius: 16, paddingVertical: 6, paddingHorizontal: 12 }}>
                  <Text style={{ color: '#fff' }}>{done ? '✓ ' : '🎁 '}{m.meta?.type === 'gift_taken' ? (i.label ?? i.name) : `${i.label ?? 'Claim'}: ${i.name}`}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ fontWeight: '700', color: C.helperInk, fontSize: 12 }}>🤖 Helper · Only you can see this</Text>
          <Text style={{ color: C.ink, fontSize: 15, marginTop: 2 }}>{m.body}</Text>
        </View>
      );
    }
    const mine = m.sender_id === me!.user_id;
    const sender = m.sender_id ? names[m.sender_id] : null;
    return (
      <View style={{ alignSelf: mine ? 'flex-end' : 'flex-start', maxWidth: '85%', backgroundColor: mine ? C.brandSoft : '#fff', borderRadius: 14, padding: 10, marginVertical: 4, borderWidth: 1, borderColor: C.line }}>
        {!mine && sender && <Text style={{ fontSize: 12, color: C.soft, marginBottom: 2 }}>{sender.display_name}</Text>}
        <Translated text={m.body ?? ''} lang={me!.language} auto={flags.translate_mode === 'auto'} />
      </View>
    );
  }

  if (manage)
    return (
      <Screen title={'People in ' + room.name} onBack={() => setManage(false)}>
        <H>In this room</H>
        {members.map((rm) => (
          <Card key={rm.user_id}>
            <Text>{names[rm.user_id] ? who(names[rm.user_id]) : 'Someone'}{rm.status === 'invited' ? ' · invited' : ''}{rm.user_id === room.owner_id ? ' · owner' : ''}</Text>
            {isOwner && rm.user_id !== me!.user_id && (
              <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
                <Text style={{ color: C.soft }} onPress={async () => { await supabase.rpc('remove_from_room', { p_room: roomId, p_user: rm.user_id }); loadMembers(); }}>Remove quietly</Text>
                {rm.status === 'joined' && (
                  <Text style={{ color: C.soft }} onPress={async () => { const r = await supabase.rpc('hand_over_room', { p_room: roomId, p_user: rm.user_id }); if (r.error) Alert.alert(niceError(r.error)); else { setRoom({ ...room, owner_id: rm.user_id }); } }}>Hand room over</Text>
                )}
              </View>
            )}
          </Card>
        ))}
        <H>Add someone from the wedding</H>
        <P soft>Only guests already in the wedding. Everyone in the room sees who added whom.</P>
        {Object.values(names)
          .filter((m) => m.role === 'guest' && !m.paused && !members.some((x) => x.user_id === m.user_id))
          .map((m) => (
            <Card key={m.user_id} onPress={async () => { const r = await supabase.rpc('add_to_room', { p_room: roomId, p_user: m.user_id }); if (r.error) Alert.alert(niceError(r.error)); loadMembers(); loadMsgs(); }}>
              <Text>＋ {who(m)}</Text>
            </Card>
          ))}
        {isOwner && !room.done && (
          <Button title="Surprise done 🎉" kind="ghost" onPress={async () => { await supabase.rpc('surprise_done', { p_room: roomId }); setRoom({ ...room, done: true }); setManage(false); }} />
        )}
      </Screen>
    );

  return (
    <Screen
      title={room.name}
      onBack={back}
      scroll={false}
      right={room.kind === 'surprise' ? <Text style={{ color: C.brand }} onPress={() => { loadMembers(); setManage(true); }}>People</Text> : null}
    >
      {room.kind === 'surprise' && <NoScreenshots />}
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        <FlatList
          ref={list}
          data={visible}
          keyExtractor={(m) => m.id}
          renderItem={renderMsg}
          contentContainerStyle={{ padding: 12 }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            <View>
              <WallBadge />
              {room.kind === 'gifts' && (
                <Card>
                  <Text style={{ fontWeight: '700', marginBottom: 6 }}>Gift list</Text>
                  {gifts.length === 0 && <P soft>No gifts yet.</P>}
                  {gifts.map((g) => (
                    <View key={g.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }}>
                      <Text style={{ fontSize: 15 }}>{g.name}</Text>
                      {g.claimed ? (
                        <Text style={{ color: C.ok }}>{g.mine ? '✓ Yours' : '✓ Claimed'}</Text>
                      ) : (
                        <Text style={{ color: C.brand, fontWeight: '600' }} onPress={() => claim({ id: g.id, name: g.name })}>Claim</Text>
                      )}
                    </View>
                  ))}
                  <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                    <View style={{ flex: 1 }}><Input value={newGift} onChangeText={setNewGift} placeholder="Add a gift idea" /></View>
                    <Text style={{ color: C.brand, fontWeight: '700' }} onPress={addGiftIdea}>Add</Text>
                  </View>
                </Card>
              )}
              {room.done && <P soft>This surprise is done 🎉 The room is read-only now.</P>}
            </View>
          }
        />
        {!room.done && (
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 8, gap: 8, borderTopWidth: 1, borderColor: C.line, backgroundColor: '#fff' }}>
            <Pressable onPress={toggleRecord} style={{ padding: 8 }}>
              <Text style={{ fontSize: 22 }}>{recording ? '⏹' : '🎤'}</Text>
            </Pressable>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder={recording ? 'Recording… tap ⏹ to send' : 'Message'}
              style={{ flex: 1, fontSize: 16, padding: 10, backgroundColor: C.bg, borderRadius: 18 }}
              multiline
            />
            <Pressable onPress={() => send(text)} disabled={sending || !text.trim()} style={{ padding: 8 }}>
              <Text style={{ fontSize: 16, fontWeight: '700', color: sending || !text.trim() ? C.soft : C.brand }}>{sending ? '…' : 'Send'}</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </Screen>
  );
}
