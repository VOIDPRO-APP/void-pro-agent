export const ENDPOINT = "https://vwygiqqdovefniykijlc.supabase.co/functions/v1/actions-runner";
export const AUDIENCE = "void-pro-github-actions.v1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const PHASES = new Set(["queued", "reading", "planning", "applying", "validating", "completed", "no_changes", "cancelled", "failed"]);
export const LABELS = Object.freeze({
  queued: "Aguardando execução", reading: "Lendo o projeto", planning: "Planejando alterações",
  applying: "Editando arquivos", validating: "Validando", completed: "Concluído",
  no_changes: "Concluído sem alterações", cancelled: "Cancelado", failed: "Não foi possível concluir",
});
export function validTask(value) { return typeof value === "string" && UUID.test(value); }

async function readJson(response, maximum = 16384) {
  const chunks = [];
  let length = 0;
  for await (const chunk of response.body ?? []) {
    length += chunk.byteLength;
    if (length > maximum) throw new Error("VOID_PRO_RESPONSE_INVALID");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("VOID_PRO_RESPONSE_INVALID"); }
}

export async function identityToken(env, fetcher = fetch) {
  const url = new URL(env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if (url.protocol !== "https:" || !url.hostname.endsWith(".actions.githubusercontent.com") ||
    url.username || url.password || url.port || !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
    throw new Error("VOID_PRO_IDENTITY_UNAVAILABLE");
  }
  url.searchParams.set("audience", AUDIENCE);
  const response = await fetcher(url, {
    headers: { Authorization: `Bearer ${env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}` },
    redirect: "error", signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("VOID_PRO_IDENTITY_UNAVAILABLE");
  const body = await readJson(response);
  if (typeof body.value !== "string" || body.value.length > 12000 || body.value.split(".").length !== 3) {
    throw new Error("VOID_PRO_IDENTITY_UNAVAILABLE");
  }
  return body.value;
}

export async function advance(taskId, requestId, dependencies = {}) {
  if (!validTask(taskId) || !validTask(requestId)) throw new Error("VOID_PRO_TASK_INVALID");
  const fetcher = dependencies.fetcher ?? fetch;
  const token = await (dependencies.token ?? (() => identityToken(process.env)))();
  const response = await fetcher(ENDPOINT, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(135000),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "advance", taskId, requestId }),
  });
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(response.status)) {
    await response.body?.cancel();
    return { retry: true };
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("VOID_PRO_EXECUTION_REFUSED");
  }
  const result = await readJson(response);
  if (!result || result.taskId !== taskId || !PHASES.has(result.status) ||
    typeof result.done !== "boolean" || !Number.isSafeInteger(result.sequence) || result.sequence < 0 ||
    result.done !== ["completed", "no_changes", "cancelled", "failed"].includes(result.status)) {
    throw new Error("VOID_PRO_RESPONSE_INVALID");
  }
  // Do not forward arbitrary server text, provider metadata, or workflow commands.
  return { taskId, status: result.status, done: result.done, sequence: result.sequence };
}

export async function execute(taskId, dependencies = {}) {
  if (!validTask(taskId)) throw new Error("VOID_PRO_TASK_INVALID");
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const next = dependencies.advance ?? advance;
  const log = dependencies.log ?? console.log;
  const uuid = dependencies.uuid ?? (() => crypto.randomUUID());
  const deadline = now() + 55 * 60 * 1000;
  let sequence = -1;
  let previousStatus = "";
  for (let steps = 0; steps < 600 && now() < deadline; steps++) {
    const requestId = uuid();
    let response;
    for (let retry = 0; retry < 4; retry++) {
      try { response = await next(taskId, requestId); }
      catch (error) {
        if (error?.message?.startsWith("VOID_PRO_")) throw error;
        response = { retry: true }; // uncertain transport: same request ID, never a new operation
      }
      if (!response.retry) break;
      if (retry === 3 || now() >= deadline) throw new Error("VOID_PRO_RETRY_EXHAUSTED");
      await sleep(5000 * (retry + 1));
    }
    if (response.sequence < sequence) throw new Error("VOID_PRO_SEQUENCE_INVALID");
    sequence = response.sequence;
    if (response.status !== previousStatus) {
      log(`VOID PRO — ${LABELS[response.status]}`);
      previousStatus = response.status;
    }
    if (response.done) return response.status;
    await sleep(1000);
  }
  throw new Error("VOID_PRO_TIME_LIMIT");
}
