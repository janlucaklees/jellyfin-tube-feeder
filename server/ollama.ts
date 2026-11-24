/**
 * One schema-constrained chat call to an Ollama model. Jobs run one at a time, so a hung
 * call must time out rather than block the queue; the default leaves room for a cold model
 * load on a slow CPU.
 */
export type ChatJson = (system: string, user: string, schema: object) => Promise<unknown>;

export function ollamaChat(ollamaUrl: string, model: string, timeoutMs = 180_000): ChatJson {
  return async (system, user, schema) => {
    const response = await fetch(`${ollamaUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        stream: false,
        think: false,
        format: schema,
        options: { temperature: 0 },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`Ollama (${model}) answered ${response.status}: ${await response.text()}`);
    const body = (await response.json()) as { message: { content: string } };
    return JSON.parse(body.message.content);
  };
}
