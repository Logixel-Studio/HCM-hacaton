import "server-only";

/*
 * Model router for the AI copilot. Free models only, tried in order until one answers:
 *   1. Groq (primary)          GROQ_API_KEY         models: GROQ_MODELS (comma separated)
 *   2. OpenRouter (fallback)   OPENROUTER_API_KEY   models: OPENROUTER_MODELS (":free" models or "openrouter/free")
 * A model that is busy, rate-limited, out of quota or down is skipped before any text reaches the user.
 * Tools (function calling) run between rounds; a model that rejects tools is retried once without them.
 */
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Msg =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
export type ToolDef = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
type Provider = { name: string; url: string; key: string; models: string[]; headers?: Record<string, string> };

export function providers(): Provider[] {
  const list: Provider[] = [];
  const base = (v: string | undefined, d: string) => (v || d).replace(/\/$/, "");
  const csv = (v: string | undefined, d: string) => (v || d).split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.GROQ_API_KEY) list.push({
    name: "Groq", url: base(process.env.GROQ_BASE_URL, "https://api.groq.com/openai/v1") + "/chat/completions", key: process.env.GROQ_API_KEY,
    models: csv(process.env.GROQ_MODELS, "openai/gpt-oss-120b,llama-3.3-70b-versatile,openai/gpt-oss-20b"),
  });
  if (process.env.OPENROUTER_API_KEY) list.push({
    name: "OpenRouter", url: base(process.env.OPENROUTER_BASE_URL, "https://openrouter.ai/api/v1") + "/chat/completions", key: process.env.OPENROUTER_API_KEY,
    models: csv(process.env.OPENROUTER_MODELS, "openrouter/free"),
    headers: { "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://hcm.logixels.com", "X-Title": "HCM Master Suite" },
  });
  return list;
}
export const aiReady = () => providers().length > 0;

/** Reasoning models answer faster and cleaner with short, hidden reasoning. */
function extra(provider: string, model: string): Record<string, unknown> {
  if (provider !== "Groq") return {};
  if (/gpt-oss/.test(model)) return { reasoning_effort: "low", include_reasoning: false };
  if (/qwen/.test(model)) return { reasoning_format: "hidden" };
  return {};
}

export type StreamEvent = { model?: string; text?: string; tool?: { name: string; args: Record<string, unknown> } };

/**
 * Streams the answer. Yields {model} when a model starts answering, {tool} when it looks something up,
 * and {text} pieces. runTool executes a tool call and returns JSON text for the model.
 */
export async function* streamChat(messages: Msg[], tools: ToolDef[], runTool: (name: string, args: Record<string, unknown>) => Promise<string>, signal: AbortSignal): AsyncGenerator<StreamEvent> {
  const convo = [...messages];
  const errors: string[] = [];
  let announced = "";
  const plan = providers().flatMap((p) => p.models.map((m) => ({ p, m })));
  let start = 0;

  for (let round = 0; round < 6; round++) {
    let done = false;
    for (let k = start; k < plan.length && !done; k++) {
      const { p, m } = plan[k];
      for (const withTools of tools.length ? [true, false] : [false]) {
        let res: Response;
        try {
          res = await fetch(p.url, {
            method: "POST", signal, headers: { "content-type": "application/json", authorization: `Bearer ${p.key}`, ...p.headers },
            body: JSON.stringify({ model: m, messages: convo, stream: true, temperature: 0.2, max_tokens: 1600, ...(withTools ? { tools, tool_choice: "auto" } : {}), ...extra(p.name, m) }),
          });
        } catch (e) { if (signal.aborted) return; errors.push(`${p.name} ${m}: ${(e as Error).message}`); break; }
        if (!res.ok || !res.body) {
          const detail = await res.text().catch(() => "");
          errors.push(`${p.name} ${m}: ${res.status}`);
          // A model that does not support tools: try it once more without them, using the context already in the prompt.
          if (withTools && res.status === 400 && /tool|function/i.test(detail)) continue;
          break;
        }
        const reader = res.body.getReader(), dec = new TextDecoder();
        let buf = "", text = "", got = false;
        const calls: { id: string; name: string; args: string }[] = [];
        try {
          while (true) {
            const { value, done: end } = await reader.read();
            if (end) break;
            buf += dec.decode(value, { stream: true });
            let i: number;
            while ((i = buf.indexOf("\n")) >= 0) {
              const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
              if (!line.startsWith("data:")) continue;
              const data = line.slice(5).trim();
              if (data === "[DONE]") continue;
              let j: { model?: string; error?: { message?: string }; choices?: { delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[] };
              try { j = JSON.parse(data); } catch { continue; }
              if (j.error) throw new Error(j.error.message ?? "model error");
              const d = j.choices?.[0]?.delta;
              if (!d) continue;
              if (d.tool_calls) for (const tc of d.tool_calls) {
                const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
                if (tc.id) c.id = tc.id;
                if (tc.function?.name) c.name += tc.function.name;
                if (tc.function?.arguments) c.args += tc.function.arguments;
                got = true;
              }
              if (d.content) {
                const label = `${p.name} · ${j.model ?? m}`;
                if (announced !== label) { announced = label; yield { model: label }; }
                got = true; text += d.content; yield { text: d.content };
              }
            }
          }
        } catch (e) {
          if (signal.aborted) return;
          if (text) { yield { text: "\n\n_(The answer was cut off. Tap Regenerate.)_" }; return; }
          errors.push(`${p.name} ${m}: ${(e as Error).message}`); break;
        }
        if (!got) { errors.push(`${p.name} ${m}: empty answer`); break; }
        const real = calls.filter((c) => c && c.name);
        if (!real.length) return; // finished answer
        // Run the lookups, then continue the same model for the next round.
        const tcs: ToolCall[] = real.map((c, n) => ({ id: c.id || `call_${round}_${n}`, type: "function", function: { name: c.name, arguments: c.args || "{}" } }));
        convo.push({ role: "assistant", content: text || null, tool_calls: tcs });
        for (const tc of tcs) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.function.arguments || "{}"); } catch { /* bad JSON: run with no args */ }
          yield { tool: { name: tc.function.name, args } };
          const out = await runTool(tc.function.name, args).catch((e) => JSON.stringify({ error: String(e) }));
          convo.push({ role: "tool", tool_call_id: tc.id, content: out.slice(0, 24000) });
        }
        start = k; done = true;
        break;
      }
    }
    if (!done) break;
  }
  throw new Error(errors.length ? `All AI models are busy right now (${errors.slice(0, 3).join("; ")}). Try again in a minute.` : "No AI provider is set up.");
}
