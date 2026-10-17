import { Hono, type MiddlewareHandler } from "hono";
import {
  type AdviceAnswerResponse,
  type AdvicePersonaResponse,
  type AdviceQuestionsResponse,
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

  routes.post("/", async (c) => {
    const { questionId } = await parseJson(c, adviceRequestSchema);
    return c.json<AdviceAnswerResponse>(await advice.ask(c.var.user.id, questionId));
  });

  routes.put("/persona", async (c) => {
    const persona = await parseJson(c, advicePersonaSchema);
    return c.json<AdvicePersonaResponse>({ persona: await advice.setPersona(c.var.user.id, persona) });
  });

  return routes;
}
