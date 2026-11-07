import { BiometricAuth, BiometryType } from '@aparajita/capacitor-biometric-auth';
import { isNative } from './native';

export type BioInfo = { available: boolean; label: string };

/** Which strong biometric this device offers (fingerprint / face / iris) */
export async function biometricInfo(): Promise<BioInfo> {
  if (!isNative) return { available: false, label: '生物辨識' };
  try {
    const r = await BiometricAuth.checkBiometry();
    const label =
      r.biometryType === BiometryType.faceId || r.biometryType === BiometryType.faceAuthentication
        ? '臉部辨識'
        : r.biometryType === BiometryType.touchId || r.biometryType === BiometryType.fingerprintAuthentication
          ? '指紋辨識'
          : r.biometryType === BiometryType.irisAuthentication
            ? '虹膜辨識'
            : '生物辨識';
    // only strong biometrics; device PIN/pattern is not accepted as a substitute
    return { available: r.isAvailable && r.strongBiometryIsAvailable !== false, label };
  } catch {
    return { available: false, label: '生物辨識' };
  }
}

/** resolves true on success, false on cancel/failure */
export async function biometricUnlock(reason = '解鎖點滴記帳'): Promise<boolean> {
  try {
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: '使用 PIN',
      allowDeviceCredential: false,
      androidTitle: '點滴記帳',
      androidSubtitle: reason,
      androidConfirmationRequired: false,
    });
    return true;
  } catch {
    return false;
  }
}
