import { Hono, type MiddlewareHandler } from "hono";
import {
  type AdviceAnswerResponse,
  type AdvicePersonaResponse,
  type AdviceQuestionsResponse,
  type AdviceTalkResponse,
  type QuickAdviceResponse,
  adviceTalkSchema,
  advicePersonaSchema,
  adviceRequestSchema,
} from "../../shared/advice.ts";
import { type AppEnv, parseJson } from "../http.ts";
import type { AdviceService } from "../services/advice.ts";

export function adviceRoutes(deps: { advice: AdviceService; authed: MiddlewareHandler<AppEnv> }) {
  const { advice } = deps;
  const routes = new Hono<AppEnv>();
  routes.use(deps.authed);

  routes.get("/", async (c) => c.json<AdviceQuestionsResponse>(await advice.questions(c.var.user.id)));

  // Answered by the app itself: works with or without a model.
  routes.get("/quick", async (c) => c.json<QuickAdviceResponse>(await advice.quick(c.var.user.id)));

  routes.post("/", async (c) => {
    const { questionId, amountCents } = await parseJson(c, adviceRequestSchema);
    return c.json<AdviceAnswerResponse>(await advice.ask(c.var.user.id, questionId, amountCents));
  });

  routes.post("/talk", async (c) => {
    const { messages, amountCents } = await parseJson(c, adviceTalkSchema);
    return c.json<AdviceTalkResponse>(await advice.talk(c.var.user.id, messages, amountCents));
  });

  routes.put("/persona", async (c) => {
    const persona = await parseJson(c, advicePersonaSchema);
    return c.json<AdvicePersonaResponse>({ persona: await advice.setPersona(c.var.user.id, persona) });
  });

  return routes;
}
