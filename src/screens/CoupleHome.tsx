import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Switch, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { supabase, niceError } from '../lib/supabase';
import { deviceId } from '../lib/device';
import { useApp } from '../state';
import Translated from '../components/Translated';
import { Button, C, Card, ErrorText, H, Input, P, Screen } from '../ui';

type Announcement = { id: string; body: string; for_vendors: boolean; created_at: string; seen?: number };

/**
 * The couple's whole world: announcements (with a seen COUNT, never names),
 * their outfit colours, the codes to share, and the helper switch. Nothing else.
 * preview = a guest looking at "See what the couple sees" (same screen, no actions).
 */
export default function CoupleHome({ preview }: { preview?: boolean }) {
  const { me, wedding, openWedding, reloadWeddings, go, back } = useApp();
  const [codes, setCodes] = useState<{ join_code: string; vendor_code: string; partner_code: string } | null>(null);
  const [items, setItems] = useState<Announcement[]>([]);
  const [text, setText] = useState('');
  const [forVendors, setForVendors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const wid = wedding!.id;

  const load = useCallback(async () => {
    const { data } = await supabase.from('announcements').select('id, body, for_vendors, created_at').eq('wedding_id', wid).order('created_at', { ascending: false });
    const list = (data ?? []) as Announcement[];
    const counts = await Promise.all(list.map((a) => supabase.rpc('seen_count', { p_announcement: a.id })));
    setItems(list.map((a, i) => ({ ...a, seen: (counts[i].data as number) ?? 0 })));
  }, [wid]);

  useEffect(() => {
    load();
    if (!preview) {
      supabase.rpc('get_codes', { p_wedding: wid }).then(({ data }) => setCodes((data as any)?.[0] ?? null));
      // Every phone the couple signs in on goes on the block list.
      deviceId().then((d) => supabase.rpc('couple_register_device', { p_wedding: wid, p_device: d }));
    }
    const ch = supabase
      .channel('ann-' + wid)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements', filter: `wedding_id=eq.${wid}` }, load)
      .subscribe();
    const t = setInterval(load, 10_000); // refresh seen counts
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [wid, wedding?.status]);

  async function post() {
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from('announcements').insert({ wedding_id: wid, author_id: me!.user_id, body: text.trim(), for_vendors: forVendors });
    setBusy(false);
    if (error) return setErr(niceError(error));
    setText('');
    setForVendors(false);
    load();
  }

  async function setHelper(on: boolean) {
    await supabase.rpc('set_helper', { p_wedding: wid, p_on: on });
    reloadWeddings();
  }

  const pending = wedding!.status === 'pending';

  return (
    <Screen
      title={wedding!.title}
      onBack={preview ? back : undefined}
      right={!preview ? <Text onPress={() => openWedding(null)} style={{ color: C.brand }}>Switch</Text> : null}
    >
      {preview && (
        <Card style={{ backgroundColor: '#E8F5EC', borderColor: '#BFE3CB' }}>
          <P>👀 This is exactly what the couple sees. No rooms, no gifts, no surprises, no names.</P>
        </Card>
      )}

      {pending && !preview && codes && (
        <Card>
          <H>Waiting for your partner</H>
          <P>Send your partner this couple code. It only works for their number. The wedding goes live when they join.</P>
          <Text selectable style={{ fontSize: 28, fontWeight: '800', letterSpacing: 4, textAlign: 'center', marginVertical: 12 }}>{codes.partner_code}</Text>
          <Button title="I've sent it, refresh" kind="ghost" onPress={reloadWeddings} />
        </Card>
      )}

      {!pending && !preview && codes && (
        <Card>
          <H>Invitation QR</H>
          <P soft>Print this on your invitations. Share it only with friends and family.</P>
          <View style={{ alignItems: 'center', marginVertical: 12 }}>
            <QRCode value={`weddy:join:${codes.join_code}`} size={200} />
            <Text selectable style={{ marginTop: 8, fontSize: 18, letterSpacing: 3 }}>{codes.join_code}</Text>
          </View>
          <P soft>Vendor code (send to your caterer, decorator…): <Text selectable style={{ fontWeight: '700', color: C.ink }}>{codes.vendor_code}</Text></P>
        </Card>
      )}

      <H>Announcements</H>
      {!preview && !pending && (
        <Card>
          <Input value={text} onChangeText={setText} placeholder="Say it once, everyone gets it in their language" multiline style={{ minHeight: 70 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <P soft>Also for vendors</P>
            <Switch value={forVendors} onValueChange={setForVendors} />
          </View>
          <Button title="Post announcement" onPress={post} busy={busy} disabled={!text.trim()} />
          <ErrorText text={err} />
        </Card>
      )}
      {items.length === 0 && <P soft>No announcements yet.</P>}
      {items.map((a) => (
        <Card key={a.id}>
          <Translated text={a.body} lang={me!.language} auto />
          <P soft style={{ marginTop: 6, fontSize: 13 }}>
            👁 Seen by {a.seen}{a.for_vendors ? ' · also for vendors' : ''}
          </P>
        </Card>
      ))}

      <H>Your outfit colours</H>
      <Button title="🎨 Outfit colours" kind="ghost" onPress={() => go({ name: 'colours' })} />

      {!preview && (
        <>
          <H>Helper</H>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <P>🤖 Helper on for our wedding</P>
              <Switch value={wedding!.helper_on} onValueChange={setHelper} />
            </View>
          </Card>
          <Button
            title="End the event"
            kind="ghost"
            small
            onPress={() =>
              Alert.alert('End the event?', 'All rooms and data are deleted a few days later.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'End', style: 'destructive', onPress: async () => { await supabase.rpc('end_event', { p_wedding: wid }); reloadWeddings(); } },
              ])
            }
          />
        </>
      )}
    </Screen>
  );
}
