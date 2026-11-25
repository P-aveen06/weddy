import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/state';
import SignIn from './src/screens/SignIn';
import Start from './src/screens/Start';
import CoupleHome from './src/screens/CoupleHome';
import GuestHome from './src/screens/GuestHome';
import VendorHome from './src/screens/VendorHome';
import RoomScreen from './src/screens/Room';
import Colours from './src/screens/Colours';
import NewSurprise from './src/screens/NewSurprise';
import { C } from './src/ui';

function Router() {
  const { ready, session, me, route } = useApp();
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.brand} /></View>;
  if (!session) return <SignIn />;
  if (!me) return <Start />;

  // The role decides the screens. The server decides the data: even if a screen
  // were shown by mistake, the couple's phone would receive nothing.
  switch (route.name) {
    case 'room':
      return me.role === 'couple' ? <CoupleHome /> : <RoomScreen roomId={route.roomId} />;
    case 'colours':
      return me.role === 'vendor' ? <VendorHome /> : <Colours />;
    case 'coupleView':
      return <CoupleHome preview />;
    case 'newSurprise':
      return me.role === 'guest' ? <NewSurprise /> : <CoupleHome />;
  }
  if (me.role === 'couple') return <CoupleHome />;
  if (me.role === 'vendor') return <VendorHome />;
  return <GuestHome />;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <StatusBar style="dark" />
        <Router />
      </AppProvider>
    </SafeAreaProvider>
  );
}
