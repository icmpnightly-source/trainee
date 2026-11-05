// What differs between the Android app and the browser.
import { Capacitor, registerPlugin } from "@capacitor/core";

/** True inside the Android app. */
export const isNative = Capacitor.isNativePlatform();

const SERVER_KEY = "normativai.serverUrl";

/**
 * The server the app talks to. In the browser the page itself comes from the
 * server, so it is "" (same origin); the Android app asks for it on first start.
 */
export function getServerUrl(): string {
  if (!isNative) return "";
  try {
    return localStorage.getItem(SERVER_KEY) ?? "";
  } catch {
    return "";
  }
}

/** "192.168.1.20:8080" → "http://192.168.1.20:8080". */
export function normalizeServerUrl(text: string): string {
  let url = text.trim().replace(/\/+$/, "");
  if (url && !/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url;
}

export function setServerUrl(url: string) {
  try {
    localStorage.setItem(SERVER_KEY, normalizeServerUrl(url));
  } catch {
    /* storage unavailable */
  }
}

interface KeepAwakePlugin {
  keepAwake(): Promise<void>;
  allowSleep(): Promise<void>;
}

/** The app's own plugin (android/app/src/main/java/.../KeepAwakePlugin.java). */
const KeepAwake = registerPlugin<KeepAwakePlugin>("KeepAwake");

/** Keeps the screen on (e.g. while the camera counts pull-ups). Returns the undo. */
export async function keepScreenOn(): Promise<() => void> {
  if (isNative) {
    try {
      await KeepAwake.keepAwake();
      return () => void KeepAwake.allowSleep().catch(() => {});
    } catch {
      return () => {};
    }
  }
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } };
    const lock = await nav.wakeLock?.request("screen");
    return () => void lock?.release();
  } catch {
    return () => {};
  }
}
