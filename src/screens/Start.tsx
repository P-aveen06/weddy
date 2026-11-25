import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { supabase, niceError } from '../lib/supabase';
import { deviceId } from '../lib/device';
import { LANGUAGES } from '../lib/languages';
import { useApp } from '../state';
import { Button, C, Card, Chips, ErrorText, H, Input, P, Screen } from '../ui';

type Mode = 'choose' | 'create' | 'scan' | 'guest' | 'partner' | 'vendor';
type Lang = (typeof LANGUAGES)[number]['code'];

/** What a scanned QR or typed code means. Invitation QR = "weddy:join:CODE". */
function parseCode(raw: string): { kind: 'join' | 'vendor' | 'couple'; code: string } | null {
  const m = raw.trim().match(/^weddy:(join|vendor|couple):([A-Za-z0-9]+)$/);
  if (m) return { kind: m[1] as 'join' | 'vendor' | 'couple', code: m[2].toUpperCase() };
  if (/^[A-Za-z0-9]{6,12}$/.test(raw.trim())) return { kind: 'join', code: raw.trim().toUpperCase() };
  return null;
}

export default function Start() {
  const { myWeddings, openWedding, reloadWeddings } = useApp();
  const [mode, setMode] = useState<Mode>('choose');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [lang, setLang] = useState<Lang>('en-IN');
  const [title, setTitle] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('+91');
  const [side, setSide] = useState<'bride' | 'groom' | null>(null);
  const [relation, setRelation] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [perm, askPerm] = useCameraPermissions();

  async function run(fn: () => Promise<{ data: unknown; error: unknown }>) {
    setBusy(true);
    setErr(null);
    const { data, error } = await fn();
    setBusy(false);
    if (error) return setErr(niceError(error));
    await reloadWeddings();
    openWedding(data as string);
  }

  const dev = () => deviceId();

  const langPicker = (
    <>
      <P soft>Language</P>
      <Chips options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))} value={lang} onChange={setLang} />
    </>
  );

  if (mode === 'choose')
    return (
      <Screen>
        <Text style={{ fontSize: 32, fontWeight: '800', color: C.brand, marginTop: 24 }}>Weddy 💍</Text>
        {myWeddings.length > 0 && (
          <>
            <H>Your weddings</H>
            {myWeddings.map((m) => (
              <Card key={m.wedding_id} onPress={() => openWedding(m.wedding_id)}>
                <Text style={{ fontSize: 17, fontWeight: '600' }}>{m.weddings.title}</Text>
                <P soft>{m.role === 'couple' ? 'You are the couple' : m.role === 'vendor' ? 'Vendor' : 'Guest'}</P>
              </Card>
            ))}
          </>
        )}
        <H>Join a wedding</H>
        <Button title="📷 Scan the invitation QR" onPress={() => setMode('scan')} />
        <Button title="I'm a vendor" kind="ghost" onPress={() => setMode('vendor')} />
        <H>Getting married?</H>
        <Button title="Create our wedding" kind="ghost" onPress={() => setMode('create')} />
        <Button title="My partner sent me a couple link" kind="ghost" onPress={() => setMode('partner')} />
        <View style={{ height: 24 }} />
        <Button title="Sign out" kind="ghost" small onPress={() => supabase.auth.signOut()} />
      </Screen>
    );

  if (mode === 'scan') {
    if (!perm?.granted)
      return (
        <Screen title="Scan the invitation" onBack={() => setMode('choose')}>
          <P>We need the camera to read the QR code on your invitation.</P>
          <Button title="Allow camera" onPress={askPerm} />
          <H>Or type the code</H>
          <Input value={code} onChangeText={setCode} autoCapitalize="characters" placeholder="Code on the invitation" />
          <Button title="Continue" disabled={!parseCode(code)} onPress={() => setMode('guest')} />
        </Screen>
      );
    return (
      <Screen title="Scan the invitation" onBack={() => setMode('choose')} scroll={false}>
        <CameraView
          style={{ flex: 1 }}
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            const p = parseCode(data);
            if (!p) return;
            setCode(p.code);
            setMode(p.kind === 'vendor' ? 'vendor' : p.kind === 'couple' ? 'partner' : 'guest');
          }}
        />
        <View style={{ padding: 16 }}>
          <P soft>Point your camera at the QR code on the invitation.</P>
          <Button title="Type the code instead" kind="ghost" onPress={() => setMode('guest')} />
        </View>
      </Screen>
    );
  }

  if (mode === 'guest')
    return (
      <Screen title="Join the wedding" onBack={() => setMode('choose')}>
        <Input label="Invitation code" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Input label="Your name" value={name} onChangeText={setName} placeholder="e.g. Lakshmi" />
        <P soft>Whose side are you from?</P>
        <Chips options={[{ value: 'bride', label: "Bride's side" }, { value: 'groom', label: "Groom's side" }]} value={side} onChange={setSide} />
        <Input label="How do you know them?" value={relation} onChangeText={setRelation} placeholder="e.g. Aunt, college friend" />
        {langPicker}
        <Button
          title="Join"
          busy={busy}
          disabled={!code || !name.trim() || !side || !relation.trim()}
          onPress={async () =>
            run(async () =>
              supabase.rpc('join_as_guest', {
                p_code: code, p_my_name: name.trim(), p_side: side, p_relation: relation.trim(), p_language: lang, p_device: await dev(),
              }),
            )
          }
        />
        <ErrorText text={err} />
      </Screen>
    );

  if (mode === 'vendor')
    return (
      <Screen title="Join as a vendor" onBack={() => setMode('choose')}>
        <Input label="Vendor code from the couple" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Input label="Your name or business" value={name} onChangeText={setName} placeholder="e.g. Sri Caterers" />
        {langPicker}
        <Button
          title="Join"
          busy={busy}
          disabled={!code || !name.trim()}
          onPress={async () =>
            run(async () => supabase.rpc('join_as_vendor', { p_code: code, p_my_name: name.trim(), p_language: lang, p_device: await dev() }))
          }
        />
        <ErrorText text={err} />
      </Screen>
    );

  if (mode === 'partner')
    return (
      <Screen title="Join as the couple" onBack={() => setMode('choose')}>
        <P soft>Enter the couple code your partner sent you. It only works for your number.</P>
        <Input label="Couple code" value={code} onChangeText={setCode} autoCapitalize="characters" />
        <Input label="Your name" value={name} onChangeText={setName} />
        {langPicker}
        <Button
          title="Join as the couple"
          busy={busy}
          disabled={!code || !name.trim()}
          onPress={async () =>
            run(async () => supabase.rpc('join_as_partner', { p_code: code, p_my_name: name.trim(), p_language: lang, p_device: await dev() }))
          }
        />
        <ErrorText text={err} />
      </Screen>
    );

  // mode === 'create'
  return (
    <Screen title="Create our wedding" onBack={() => setMode('choose')}>
      <Input label="Wedding name" value={title} onChangeText={setTitle} placeholder="e.g. Priya & Arjun" />
      <Input label="Your name" value={name} onChangeText={setName} />
      <Input label="Your partner's phone number (with +91)" value={partnerPhone} onChangeText={setPartnerPhone} keyboardType="phone-pad" />
      <P soft>Both your numbers and this phone are blocked from joining as guests, so you can never stumble on a surprise.</P>
      {langPicker}
      <Button
        title="Create"
        busy={busy}
        disabled={!title.trim() || !name.trim() || partnerPhone.replace(/\D/g, '').length < 11}
        onPress={async () =>
          run(async () =>
            supabase.rpc('create_wedding', {
              p_title: title.trim(), p_partner_phone: partnerPhone, p_my_name: name.trim(), p_language: lang, p_device: await dev(),
            }),
          )
        }
      />
      <ErrorText text={err} />
    </Screen>
  );
}
