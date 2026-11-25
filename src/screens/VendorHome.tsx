import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { supabase } from '../lib/supabase';
import { useApp } from '../state';
import Translated from '../components/Translated';
import { C, Card, H, P, Screen } from '../ui';

// Vendors see only the vendor room and announcements marked "for vendors".
export default function VendorHome() {
  const { me, wedding, go, openWedding } = useApp();
  const [anns, setAnns] = useState<{ id: string; body: string }[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('announcements').select('id, body').eq('wedding_id', wedding!.id).order('created_at', { ascending: false })
      .then(({ data }) => setAnns(data ?? []));
    supabase.from('rooms').select('id').eq('wedding_id', wedding!.id).eq('kind', 'vendor').maybeSingle()
      .then(({ data }) => setRoomId(data?.id ?? null));
  }, [wedding?.id]);

  return (
    <Screen title={wedding!.title} right={<Text onPress={() => openWedding(null)} style={{ color: C.brand }}>Switch</Text>}>
      <H>For vendors</H>
      {anns.length === 0 && <P soft>Nothing yet.</P>}
      {anns.map((a) => (
        <Card key={a.id}><Translated text={a.body} lang={me!.language} auto /></Card>
      ))}
      {roomId && (
        <Card onPress={() => go({ name: 'room', roomId })}>
          <Text style={{ fontSize: 17 }}>🧑‍🍳 Vendor room</Text>
        </Card>
      )}
    </Screen>
  );
}
