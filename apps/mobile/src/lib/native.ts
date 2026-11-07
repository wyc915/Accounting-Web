import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { StatusBar, Style } from '@capacitor/status-bar';

export const isNative = Capacitor.isNativePlatform();

/** light tap feedback (keypad, toggles) */
export const tap = () => isNative && Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
export const success = () => isNative && Haptics.notification({ type: NotificationType.Success }).catch(() => {});
export const warn = () => isNative && Haptics.notification({ type: NotificationType.Error }).catch(() => {});

const toBase64 = async (data: Blob) => {
  const buf = new Uint8Array(await data.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};
export { toBase64 };

/** Save/share a generated file: native → share sheet (Files, Drive, LINE…); web → download */
export async function saveFile(name: string, data: Blob) {
  if (!isNative) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return;
  }
  const { uri } = await Filesystem.writeFile({ path: name, data: await toBase64(data), directory: Directory.Cache });
  await Share.share({ title: name, files: [uri], dialogTitle: '儲存或分享檔案' });
}

export async function syncStatusBar(dark: boolean) {
  if (!isNative) return;
  await StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light }).catch(() => {});
  if (Capacitor.getPlatform() === 'android') await StatusBar.setBackgroundColor({ color: dark ? '#0b1210' : '#f4f8f6' }).catch(() => {});
}
