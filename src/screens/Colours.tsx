import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { supabase, niceError } from '../lib/supabase';
import { useApp } from '../state';
import Translated from '../components/Translated';
import { Button, C, Card, H, Input, P, Screen } from '../ui';

type Colour = { hex: string; name: string };
type Fn = { id: string; function_name: string; function_date: string | null; bride: Colour[]; groom: Colour[]; guest_theme: string | null; updated_at: string };

// A small palette with everyday names. The couple picks a swatch and confirms the name.
const PALETTE: Colour[] = [
  { hex: '#C62828', name: 'red' }, { hex: '#7B1E2B', name: 'maroon' }, { hex: '#6D1A36', name: 'wine' },
  { hex: '#E91E63', name: 'pink' }, { hex: '#F8BBD0', name: 'baby pink' }, { hex: '#FF7043', name: 'orange' },
  { hex: '#FFC107', name: 'yellow' }, { hex: '#C9952B', name: 'gold' }, { hex: '#FFF8E7', name: 'ivory' },
  { hex: '#F5F0E1', name: 'cream' }, { hex: '#8BC34A', name: 'parrot green' }, { hex: '#0B6E4F', name: 'emerald green' },
  { hex: '#4DB6AC', name: 'mint' }, { hex: '#1E88E5', name: 'blue' }, { hex: '#1A237E', name: 'navy blue' },
  { hex: '#9575CD', name: 'lavender' }, { hex: '#5E35B1', name: 'purple' }, { hex: '#ECEFF1', name: 'silver' },
  { hex: '#212121', name: 'black' }, { hex: '#FFFFFF', name: 'white' },
];

function Swatches({ colours, lang }: { colours: Colour[]; lang: string }) {
  if (!colours.length) return <P soft>Not shared yet</P>;
  return (
    <View style={{ gap: 6 }}>
      {colours.map((c, i) => (
        <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ width: 36, height: 36, borderRadius: 8, backgroundColor: c.hex, borderWidth: 1, borderColor: C.line }} />
          {/* A name always sits next to a swatch, translated into the reader's language. */}
          <View style={{ flex: 1 }}><Translated text={c.name} lang={lang} auto /></View>
        </View>
      ))}
    </View>
  );
}

function Picker({ value, onChange }: { value: Colour[]; onChange: (c: Colour[]) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 }}>
      {PALETTE.map((p) => {
        const on = value.some((v) => v.hex === p.hex);
        return (
          <Pressable
            key={p.hex}
            onPress={() => onChange(on ? value.filter((v) => v.hex !== p.hex) : value.length >= 3 ? value : [...value, p])}
            style={{ width: 40, height: 40, borderRadius: 8, backgroundColor: p.hex, borderWidth: on ? 3 : 1, borderColor: on ? C.ink : C.line }}
          />
        );
      })}
    </View>
  );
}

export default function Colours() {
  const { me, wedding, back } = useApp();
  const [fns, setFns] = useState<Fn[]>([]);
  const [editing, setEditing] = useState<Partial<Fn> | null>(null);
  const isCouple = me!.role === 'couple';
  const wid = wedding!.id;

  const load = useCallback(async () => {
    const { data } = await supabase.from('outfit_colours').select('*').eq('wedding_id', wid).order('function_date', { ascending: true, nullsFirst: false });
    setFns((data ?? []) as Fn[]);
  }, [wid]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    const e = editing!;
    const row = { wedding_id: wid, function_name: e.function_name?.trim(), function_date: e.function_date || null, bride: e.bride ?? [], groom: e.groom ?? [], guest_theme: e.guest_theme?.trim() || null, updated_at: new Date().toISOString() };
    const r = e.id ? await supabase.from('outfit_colours').update(row).eq('id', e.id) : await supabase.from('outfit_colours').insert(row);
    if (r.error) return Alert.alert(niceError(r.error));
    // One short announcement so guests hear about it.
    const list = (c?: Colour[]) => (c?.length ? c.map((x) => x.name).join(', ') : 'not shared yet');
    await supabase.from('announcements').insert({
      wedding_id: wid, author_id: me!.user_id,
      body: `🎨 ${row.function_name}${e.id ? ' (updated)' : ''}: bride in ${list(row.bride)}, groom in ${list(row.groom)}.${row.guest_theme ? ' For guests: ' + row.guest_theme : ''}`,
    });
    setEditing(null);
    load();
  }

  if (editing)
    return (
      <Screen title={editing.id ? 'Edit colours' : 'Add a function'} onBack={() => setEditing(null)}>
        <Input label="Function" value={editing.function_name ?? ''} onChangeText={(t) => setEditing({ ...editing, function_name: t })} placeholder="Mehendi, Sangeet, Wedding…" />
        <Input label="Date (YYYY-MM-DD)" value={editing.function_date ?? ''} onChangeText={(t) => setEditing({ ...editing, function_date: t })} placeholder="2026-12-12" />
        <H>Bride (up to 3)</H>
        <Picker value={editing.bride ?? []} onChange={(c) => setEditing({ ...editing, bride: c })} />
        <P soft>{(editing.bride ?? []).map((c) => c.name).join(', ') || 'None picked'}</P>
        <H>Groom (up to 3)</H>
        <Picker value={editing.groom ?? []} onChange={(c) => setEditing({ ...editing, groom: c })} />
        <P soft>{(editing.groom ?? []).map((c) => c.name).join(', ') || 'None picked'}</P>
        <Input label="Request for guests (optional)" value={editing.guest_theme ?? ''} onChangeText={(t) => setEditing({ ...editing, guest_theme: t })} placeholder="e.g. Guests in pastels" />
        <Button title="Save and tell everyone" onPress={save} disabled={!editing.function_name?.trim()} />
      </Screen>
    );

  return (
    <Screen title="Outfit colours" onBack={back}>
      <P soft>What the couple will wear at each function.</P>
      {fns.length === 0 && <P soft>Not shared yet.</P>}
      {fns.map((f) => (
        <Card key={f.id} onPress={isCouple ? () => setEditing(f) : undefined}>
          <Text style={{ fontSize: 18, fontWeight: '700' }}>{f.function_name}{f.function_date ? ' · ' + f.function_date : ''}</Text>
          <H>Bride</H>
          <Swatches colours={f.bride} lang={me!.language} />
          <H>Groom</H>
          <Swatches colours={f.groom} lang={me!.language} />
          {f.guest_theme ? (<><H>Couple's request for guests</H><Translated text={f.guest_theme} lang={me!.language} auto /></>) : null}
        </Card>
      ))}
      {isCouple && <Button title="＋ Add a function" onPress={() => setEditing({ bride: [], groom: [] })} />}
    </Screen>
  );
}
