import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { clientIp } from "./http.ts";

const addressSeen = async (trustProxy: boolean, forwardedFor?: string) => {
  const app = new Hono().get("/", (c) => c.text(clientIp(c, trustProxy)));
  const headers = forwardedFor === undefined ? undefined : { "X-Forwarded-For": forwardedFor };
  return (await app.request("/", { headers })).text();
};

describe("clientIp", () => {
  it("behind a proxy, believes the address the proxy added", async () => {
    expect(await addressSeen(true, "203.0.113.9")).toBe("203.0.113.9");
  });

  it("ignores addresses the visitor put in the header themselves", async () => {
    // nginx's $proxy_add_x_forwarded_for appends the real address to whatever was sent.
    expect(await addressSeen(true, "10.9.8.7, 198.51.100.4, 203.0.113.9")).toBe("203.0.113.9");
  });

  it("without a proxy, ignores the header altogether", async () => {
    expect(await addressSeen(false, "203.0.113.9")).toBe("unknown");
    expect(await addressSeen(true)).toBe("unknown");
  });
});
