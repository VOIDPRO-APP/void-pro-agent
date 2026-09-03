import { execute } from "./runner-core.mjs";

try {
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("VOID_PRO_ACTIONS_REQUIRED");
  const status = await execute(process.env["INPUT_TASK-ID"] ?? "");
  if (status === "failed" || status === "cancelled") process.exitCode = 1;
} catch {
  // Never log an exception, token, request/response body, prompt, or provider identity.
  console.error("::error title=VOID PRO::A execução não pôde ser concluída. Consulte a tarefa na extensão.");
  process.exitCode = 1;
}
