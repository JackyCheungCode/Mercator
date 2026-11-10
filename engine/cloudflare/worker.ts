import { DurableObject } from "cloudflare:workers";

interface Env {
  ENGINE_CONTAINER: DurableObjectNamespace<EngineContainer>;
  ENGINE_TOKEN: string;
}

const PORT = 8000;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_START_ATTEMPTS = 90;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export class EngineContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (container?.running) {
      void ctx.blockConcurrencyWhile(() => container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS));
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.env.ENGINE_TOKEN) return json({ error: "ENGINE_TOKEN_NOT_CONFIGURED" }, 503);
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "basic",
        enableInternet: false,
        env: {
          MERCATOR_ENGINE_TOKEN: this.env.ENGINE_TOKEN,
          TESSERACT_LANG: "chi_tra+eng",
        },
      });
    }
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(PORT);
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_START_ATTEMPTS; attempt++) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1500),
        });
        await response.body?.cancel();
        if (response.ok) return;
        lastError = new Error(`Engine health check returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(500);
    }
    throw new Error("Mercator Python engine did not become ready on port 8000", {
      cause: lastError,
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, service: "mercator-engine-gateway", engineConfigured: Boolean(env.ENGINE_TOKEN) });
    }
    if (request.method !== "POST" || url.pathname !== "/v1/analyze") {
      return json({ error: "NOT_FOUND" }, 404);
    }
    if (!env.ENGINE_TOKEN) return json({ error: "ENGINE_TOKEN_NOT_CONFIGURED" }, 503);
    if (request.headers.get("Authorization") !== `Bearer ${env.ENGINE_TOKEN}`) {
      return json({ error: "UNAUTHORIZED" }, 401);
    }
    if (!request.headers.get("Content-Type")?.includes("multipart/form-data")) {
      return json({ error: "INVALID_CONTENT_TYPE" }, 415);
    }
    const id = env.ENGINE_CONTAINER.idFromName("mercator-analysis-engine-v1");
    return env.ENGINE_CONTAINER.get(id).fetch(request);
  },
};
