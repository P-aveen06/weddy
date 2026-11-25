import * as Application from 'expo-application';
import { Platform } from 'react-native';

/**
 * The phone's ID for the couple block list.
 * iPhone: Apple's "vendor ID". It changes if the app is deleted and installed again
 * (Apple gives no permanent device ID). Android: the Android ID.
 */
export async function deviceId(): Promise<string | null> {
  try {
    if (Platform.OS === 'ios') return await Application.getIosIdForVendorAsync();
    if (Platform.OS === 'android') return Application.getAndroidId();
  } catch {}
  return null;
}
