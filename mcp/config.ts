/** Why the server cannot start; the message says what to set. */
export class ConfigError extends Error {}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Reads the two settings the server needs from the environment:
 * PPB_URL, the budget server's address, and PPB_TOKEN, an API token created in the app's Settings.
 */
export function readConfig(env: Record<string, string | undefined>): { baseUrl: string; token: string } {
  const address = env.PPB_URL?.trim();
  const token = env.PPB_TOKEN?.trim();
  if (!address) throw new ConfigError("PPB_URL is not set. Set it to your budget server's address, e.g. https://budget.example.com");
  if (!token) throw new ConfigError("PPB_TOKEN is not set. Create an API token in the app's Settings and set PPB_TOKEN to it.");

  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new ConfigError(`PPB_URL is not an address: "${address}". It should look like https://budget.example.com`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ConfigError(`PPB_URL must start with https:// (got "${url.protocol}//").`);
  }
  // The token is as good as a password for the budget; never send it where it can be read in transit.
  if (url.protocol === "http:" && !LOCAL_HOSTS.has(url.hostname)) {
    throw new ConfigError(`PPB_URL must use https:// for anything but this machine: "${address}" would send the token unencrypted.`);
  }
  if (!token.startsWith("ppb_")) {
    throw new ConfigError('PPB_TOKEN does not look like an API token (they start with "ppb_"). Copy it again from Settings.');
  }
  return { baseUrl: url.origin + url.pathname.replace(/\/+$/, ""), token };
}
