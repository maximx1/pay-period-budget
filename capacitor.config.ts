import type { CapacitorConfig } from "@capacitor/cli";
import { loadEnv } from "vite";

// `cap sync` runs straight after the Android build, so this reads the same .env.android.
// The address there is only a default the app starts with; it is usually set for development.
const apiUrl = loadEnv("android", process.cwd(), "VITE_").VITE_API_BASE_URL ?? "";

const config: CapacitorConfig = {
  appId: "com.maximx1.payperiodbudget",
  appName: "Pay Period Budget",
  webDir: "dist/android",
  android: {
    // The app's pages are served from https://localhost, and calling a plain-http API from
    // an https page is refused as mixed content. Only a development server is ever plain
    // http, and only debug builds may reach one (see android/app/src/debug).
    allowMixedContent: apiUrl.startsWith("http://"),
  },
};

export default config;
