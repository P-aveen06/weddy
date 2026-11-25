import React, { useState } from 'react';
import { supabase, niceError } from '../lib/supabase';
import { useApp } from '../state';
import { Button, ErrorText, Input, P, Screen } from '../ui';

// Any guest can start a hidden surprise room. The couple never sees it exists.
export default function NewSurprise() {
  const { wedding, back, go } = useApp();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    setBusy(true);
    const { data, error } = await supabase.rpc('create_surprise_room', { p_wedding: wedding!.id, p_name: name.trim() });
    setBusy(false);
    if (error) return setErr(niceError(error));
    back();
    go({ name: 'room', roomId: data as string });
  }

  return (
    <Screen title="New surprise room" onBack={back}>
      <P soft>Only people you add can see this room. Nobody else knows it exists, and the couple never will.</P>
      <Input label="Name" value={name} onChangeText={setName} placeholder="e.g. Sangeet dance" autoFocus />
      <Button title="Create" onPress={create} busy={busy} disabled={!name.trim()} />
      <ErrorText text={err} />
    </Screen>
  );
}
