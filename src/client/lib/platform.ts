import { Capacitor } from "@capacitor/core";

/** True inside the Android app, false in a browser. */
export const isNative: boolean = Capacitor.isNativePlatform();
