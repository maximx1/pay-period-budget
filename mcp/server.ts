// Entry point of the MCP server: a program an AI assistant starts on this machine and
// talks to over stdin and stdout. It holds an API token, never the account password.
// Built into one file by `npm run build:mcp`; see docs/mcp.md.
import { readFile } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ApiRequestError, createApi } from "./api.ts";
import { ConfigError, readConfig } from "./config.ts";
import { buildMcpServer, whoAmI } from "./mcpServer.ts";

// stdout carries the protocol, so everything meant for a person goes to stderr.
const say = (message: string) => process.stderr.write(`pay-period-budget: ${message}\n`);

try {
  const config = readConfig(process.env);
  const api = createApi(config);

  try {
    say(`connected to ${api.baseUrl} as ${await whoAmI(api)}`);
  } catch (error) {
    // A token the server refuses will never work: stop now, where the reason is visible.
    // A server that can't be reached may be back in a minute: start, and let the tools say so.
    if (error instanceof ApiRequestError && error.status !== 0) throw error;
    say(`${error instanceof Error ? error.message : String(error)} Starting anyway; tools will fail until it can be reached.`);
  }

  const server = buildMcpServer({ api, readFile: (path) => readFile(path, "utf8"), now: () => new Date() });
  await server.connect(new StdioServerTransport());
} catch (error) {
  say(error instanceof ConfigError || error instanceof ApiRequestError ? error.message : String(error));
  process.exit(1);
}
