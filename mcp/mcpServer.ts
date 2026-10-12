import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthResponse } from "../src/shared/auth.ts";
import { type Api, ApiRequestError } from "./api.ts";
import { createTools, type ToolDeps, ToolFailure } from "./tools.ts";

export const SERVER_NAME = "pay-period-budget";
export const SERVER_VERSION = "0.1.0";

const INSTRUCTIONS = [
  "Tools for one person's Pay Period Budget: a budget organised by pay period rather than by month.",
  "Money is in integer cents. Results show dollars and cents together; never do cent arithmetic from the dollar figure.",
  "Amounts given to a tool are positive, with kind \"expense\" or \"income\" saying which way the money went.",
  "Dates are wall-clock values in the budget's own time zone (get_budget says which and what today is there).",
  "A transaction belongs to whichever pay period covers its date. Adding, changing or deleting one changes the",
  "starting amount of every later period, so these are the owner's real balances: when unsure, ask before writing.",
  "To load a bank export, convert it to a JSON file with a script and use import_transactions, which previews first.",
].join(" ");

/** The MCP server with every tool registered, not yet connected to a transport. */
export function buildMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION }, { instructions: INSTRUCTIONS });

  for (const tool of createTools(deps)) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: tool.destructive,
          // Everything goes to the owner's own budget server and nowhere else.
          openWorldHint: false,
        },
      },
      async (args: unknown) => {
        try {
          return { content: [{ type: "text" as const, text: await tool.run(args) }] };
        } catch (error) {
          return { content: [{ type: "text" as const, text: failureText(error) }], isError: true };
        }
      },
    );
  }
  return server;
}

/** What to tell the assistant when a tool could not do its work. */
export function failureText(error: unknown): string {
  if (error instanceof ToolFailure) return error.message;
  if (error instanceof ApiRequestError) {
    const fields = Object.entries(error.fields ?? {}).map(([name, message]) => `- ${name}: ${message}`);
    return [error.message, ...fields].join("\n");
  }
  return `Something went wrong inside the budget tools: ${error instanceof Error ? error.message : String(error)}`;
}

/** The account the token belongs to. Fails with a message that says what to fix. */
export async function whoAmI(api: Api): Promise<string> {
  return (await api.get<AuthResponse>("/api/auth/me")).user.username;
}
