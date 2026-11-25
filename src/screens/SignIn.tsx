import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { niceError } from '../lib/supabase';
import { checkCode, digits, IS_PLACEHOLDER, PLACEHOLDER_CODE, sendCode } from '../lib/verify';
import { Button, C, ErrorText, H, Input, P, Screen } from '../ui';

// Everyone signs in the same way: phone number + a one-time code.
// No password, no email. (The code check itself is a placeholder for now, see lib/verify.ts.)
export default function SignIn() {
  const [phone, setPhone] = useState('+91');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const clean = '+' + digits(phone);

  async function onSend() {
    setBusy(true);
    setErr(null);
    try {
      await sendCode(clean);
      setSent(true);
    } catch (e) {
      setErr(niceError(e));
    }
    setBusy(false);
  }

  async function onVerify() {
    setBusy(true);
    setErr(null);
    try {
      await checkCode(clean, code);
    } catch (e) {
      setErr(niceError(e));
    }
    setBusy(false);
  }

  return (
    <Screen>
      <View style={{ marginTop: 48, marginBottom: 24 }}>
        <Text style={{ fontSize: 40, fontWeight: '800', color: C.brand }}>Weddy 💍</Text>
        <P soft>Plan the wedding together. The couple never sees the surprises.</P>
      </View>
      {!sent ? (
        <>
          <H>Your phone number</H>
          <Input value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoFocus placeholder="+91 98765 43210" />
          <Button title="Send me a code" onPress={onSend} busy={busy} disabled={digits(phone).length < 11} />
        </>
      ) : (
        <>
          <H>Enter the code</H>
          <P soft>We sent a code to {clean}.</P>
          {IS_PLACEHOLDER && <P soft>(Test mode: the code is {PLACEHOLDER_CODE})</P>}
          <Input value={code} onChangeText={setCode} keyboardType="number-pad" autoFocus placeholder="123456" textContentType="oneTimeCode" />
          <Button title="Continue" onPress={onVerify} busy={busy} disabled={code.trim().length < 4} />
          <Button title="Change number" kind="ghost" onPress={() => { setSent(false); setCode(''); }} />
        </>
      )}
      <ErrorText text={err} />
    </Screen>
  );
}
