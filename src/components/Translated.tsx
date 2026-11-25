import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { listen, translate } from '../lib/ai';
import { C } from '../ui';

/**
 * Text with "Translate" and "Listen" buttons underneath.
 * auto = show it already translated (announcements, or the "auto" group in the Flagsmith test).
 */
export default function Translated({ text, lang, auto, style }: { text: string; lang: string; auto?: boolean; style?: any }) {
  const [shown, setShown] = useState<string | null>(null);
  const [state, setState] = useState<'idle' | 'translating' | 'failed'>('idle');
  const [speaking, setSpeaking] = useState(false);
  const [noAudio, setNoAudio] = useState(false);

  async function doTranslate() {
    setState('translating');
    try {
      setShown(await translate(text, lang));
      setState('idle');
    } catch {
      setState('failed');
    }
  }

  useEffect(() => {
    setShown(null);
    if (auto && !lang.startsWith('en')) doTranslate();
  }, [text, lang, auto]);

  async function doListen() {
    setSpeaking(true);
    try {
      const ok = await listen(shown ?? text, lang);
      setNoAudio(!ok);
    } catch {
      setNoAudio(true);
    }
    setSpeaking(false);
  }

  return (
    <View>
      <Text style={[{ fontSize: 16, color: C.ink, lineHeight: 22 }, style]}>{shown ?? text}</Text>
      <View style={{ flexDirection: 'row', gap: 16, marginTop: 4 }}>
        {!shown && (
          <Pressable onPress={doTranslate} hitSlop={8}>
            <Text style={{ color: C.helperInk, fontSize: 13 }}>
              {state === 'translating' ? 'Translating…' : state === 'failed' ? 'Translation not available right now' : '🌐 Translate'}
            </Text>
          </Pressable>
        )}
        {shown && (
          <Pressable onPress={() => setShown(null)} hitSlop={8}>
            <Text style={{ color: C.soft, fontSize: 13 }}>Show original</Text>
          </Pressable>
        )}
        <Pressable onPress={doListen} hitSlop={8}>
          <Text style={{ color: C.helperInk, fontSize: 13 }}>{speaking ? '🔊 …' : noAudio ? 'Listen not available yet' : '🔊 Listen'}</Text>
        </Pressable>
      </View>
    </View>
  );
}
