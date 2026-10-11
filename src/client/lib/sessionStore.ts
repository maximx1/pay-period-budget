import { Preferences } from "@capacitor/preferences";
import { AccessControl, BiometricAuthError, NativeBiometric } from "@capgo/capacitor-native-biometric";
import { isNative } from "./platform.ts";

// Where the Android app keeps its session token. A browser never holds one: its session
// is the httpOnly cookie, so everything here does nothing on the web.
//
// The token lives in one of two places, by the user's choice on this device:
//   - plain app-private preferences, read at start-up without asking; or
//   - the biometric vault: encrypted under an Android Keystore key that the OS releases
//     only after a fingerprint or face check. Nothing in JavaScript can read it otherwise.
const TOKEN_KEY = "session.token";
const UNLOCK_KEY = "session.unlock";
const OFFERED_KEY = "session.unlockOffered";

/** Away from the app for longer than this and it asks for the fingerprint again. */
export const AWAY_LIMIT_MS = 5 * 60 * 1000;

// Device storage is asynchronous; this copy lets api.ts read the token without waiting.
let current: string | null = null;
/** The user chose biometric unlock on this device. */
let biometric = false;
/** A token is in the vault and has not been released into memory. */
let locked = false;
let hiddenAt: number | null = null;
const lockListeners = new Set<() => void>();

function setLocked(next: boolean) {
  if (locked === next) return;
  locked = next;
  for (const listener of lockListeners) listener();
}

const vaultHasToken = () =>
  NativeBiometric.isDataSaved({ key: TOKEN_KEY }).then(
    (result) => result.isSaved,
    () => false,
  );

/** Stores without a prompt: encrypting needs only the public half of the key. */
const putInVault = (token: string) =>
  // BIOMETRY_ANY: the key survives a fingerprint being added later, so the owner is not sent
  // back to the password for that. The stricter BIOMETRY_CURRENT_SET would destroy it.
  NativeBiometric.setData({ key: TOKEN_KEY, value: token, accessControl: AccessControl.BIOMETRY_ANY });

const readFromVault = async () =>
  (
    await NativeBiometric.getSecureData({
      key: TOKEN_KEY,
      title: "Unlock Pay Period Budget",
      negativeButtonText: "Cancel",
      maxAttempts: 3,
    })
  ).value;

/**
 * Reads what is stored at start-up. Must finish before the first API request, or the app
 * would ask a signed-in user for their password on every launch. With biometric unlock on
 * it reads nothing: the app starts locked and `unlock()` fetches the token.
 */
export async function loadToken(): Promise<void> {
  if (!isNative) return;
  try {
    biometric = (await Preferences.get({ key: UNLOCK_KEY })).value === "biometric";
    if (biometric) {
      current = null;
      setLocked(await vaultHasToken());
    } else {
      current = (await Preferences.get({ key: TOKEN_KEY })).value;
    }
  } catch {
    // Unreadable storage is the same as being signed out.
    current = null;
    setLocked(false);
  }
}

export function getToken(): string | null {
  return current;
}

/** Keeps the token from a password sign-in, in whichever place the user chose. */
export async function setToken(token: string): Promise<void> {
  if (!isNative) return;
  current = token;
  setLocked(false);
  if (biometric) {
    try {
      await putInVault(token);
      return;
    } catch {
      // The vault stopped working (no fingerprint enrolled any more): go back to plain storage.
      biometric = false;
      await Preferences.remove({ key: UNLOCK_KEY });
    }
  }
  await Preferences.set({ key: TOKEN_KEY, value: token });
}

/** Forgets the token everywhere. The choice of biometric unlock is kept for the next sign-in. */
export async function clearToken(): Promise<void> {
  if (!isNative) return;
  current = null;
  setLocked(false);
  await Promise.allSettled([Preferences.remove({ key: TOKEN_KEY }), NativeBiometric.deleteData({ key: TOKEN_KEY })]);
}

export function isLocked(): boolean {
  return locked;
}

export function subscribeToLock(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => lockListeners.delete(listener);
}

/**
 * - `unlocked`: the token is in memory.
 * - `cancelled`: the prompt was dismissed or the check failed; still locked, try again.
 * - `locked-out`: too many failed tries; still locked, the OS refuses for a while.
 * - `gone`: the token can no longer be released (fingerprints removed from the phone). It
 *   has been forgotten; only the password signs in now.
 */
export type UnlockResult = "unlocked" | "cancelled" | "locked-out" | "gone";

const LOCKOUT = new Set<number>([BiometricAuthError.USER_LOCKOUT, BiometricAuthError.USER_TEMPORARY_LOCKOUT]);
const UNUSABLE = new Set<number>([
  BiometricAuthError.BIOMETRICS_UNAVAILABLE,
  BiometricAuthError.BIOMETRICS_NOT_ENROLLED,
  BiometricAuthError.PASSCODE_NOT_SET,
  BiometricAuthError.NO_PROTECTED_CREDENTIALS_FOUND,
]);

/** Shows the OS prompt and, if it passes, loads the token into memory. */
export async function unlock(): Promise<UnlockResult> {
  if (!locked) return "unlocked";
  try {
    current = await readFromVault();
    setLocked(false);
    return "unlocked";
  } catch (error) {
    const code = Number((error as { code?: string | number } | null)?.code);
    if (LOCKOUT.has(code)) return "locked-out";
    // If the OS destroyed the key (every fingerprint removed), the stored token went with it.
    if (UNUSABLE.has(code) || !(await vaultHasToken())) {
      await clearToken();
      return "gone";
    }
    return "cancelled";
  }
}

/** Drops the token from memory, so the next use needs the fingerprint again. */
export function lock(): void {
  if (!biometric || current === null) return;
  current = null;
  setLocked(true);
}

// The app locks after a spell in the background. nativeShell.ts reports the two moments.
export function noteAppHidden(now: number = Date.now()): void {
  hiddenAt ??= now;
}

export function noteAppShown(now: number = Date.now()): void {
  if (hiddenAt !== null && now - hiddenAt > AWAY_LIMIT_MS) lock();
  hiddenAt = null;
}

export function biometricUnlockEnabled(): boolean {
  return biometric;
}

/** Whether this device has a fingerprint or face enrolled that the OS counts as strong. */
export async function biometricUnlockAvailable(): Promise<boolean> {
  if (!isNative) return false;
  try {
    return (await NativeBiometric.isAvailable({ useFallback: false })).strongBiometryIsAvailable;
  } catch {
    return false;
  }
}

/**
 * Moves the token into the vault, or back out. Turning it on asks for the fingerprint once,
 * to prove the token can be read back before the plain copy is deleted; false means that
 * check did not pass and nothing changed.
 */
export async function setBiometricUnlock(on: boolean): Promise<boolean> {
  if (!isNative || on === biometric) return true;
  if (current === null) return false;
  const token = current;

  if (on) {
    try {
      await putInVault(token);
      if ((await readFromVault()) !== token) throw new Error("Vault returned a different token");
    } catch {
      await NativeBiometric.deleteData({ key: TOKEN_KEY }).catch(() => undefined);
      return false;
    }
    await Preferences.set({ key: UNLOCK_KEY, value: "biometric" });
    await Preferences.remove({ key: TOKEN_KEY });
    biometric = true;
  } else {
    await Preferences.set({ key: TOKEN_KEY, value: token });
    await Preferences.remove({ key: UNLOCK_KEY });
    await NativeBiometric.deleteData({ key: TOKEN_KEY }).catch(() => undefined);
    biometric = false;
  }
  return true;
}

/** True once per device: signed in with a password, biometrics enrolled, and not asked before. */
export async function shouldOfferBiometricUnlock(): Promise<boolean> {
  if (!isNative || biometric || current === null) return false;
  try {
    if ((await Preferences.get({ key: OFFERED_KEY })).value) return false;
  } catch {
    return false;
  }
  return biometricUnlockAvailable();
}

export async function markBiometricUnlockOffered(): Promise<void> {
  if (!isNative) return;
  await Preferences.set({ key: OFFERED_KEY, value: "1" });
}
