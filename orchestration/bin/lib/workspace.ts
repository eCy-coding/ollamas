// workspace (pure) — build/parse the request that points the ollamas server's agent workspace at a given
// directory. IO-free → unit-tested; the CLI does the actual fetch.
//
// Why: the agent read tools (read_file / list_tree / grep_search) are confined to the server's
// `db.data.workspacePath` (server.ts:1114 + files.ts resolveSafePath). A fleet worker can only READ the
// repo if that workspace IS the repo. The server exposes `POST /api/workspace/select {path}` to set it,
// so the fleet points the workspace at the repo before dispatching (reversible; read-only worker dispatch
// keeps writes off the repo — see agent-dispatch --no-apply).

export interface WorkspaceRequest { url: string; method: "POST"; body: string; contentType: "application/json" }

/** Build the POST /api/workspace/select request that sets the server workspace to `repo`. */
export function selectWorkspaceRequest(baseUrl: string, repo: string): WorkspaceRequest {
  const base = baseUrl.replace(/\/+$/, "");
  return {
    url: `${base}/api/workspace/select`,
    method: "POST",
    body: JSON.stringify({ path: repo }),
    contentType: "application/json",
  };
}

export interface WorkspaceResult { ok: boolean; workspacePath: string; error: string }

/** Parse the server's /api/workspace/select response body. `ok` = it reported success with a path. */
export function parseWorkspaceResp(text: string): WorkspaceResult {
  try {
    const j = JSON.parse(text);
    if (j && j.success && typeof j.workspacePath === "string") {
      return { ok: true, workspacePath: j.workspacePath, error: "" };
    }
    return { ok: false, workspacePath: "", error: (j && j.error) ? String(j.error) : "no workspacePath in response" };
  } catch {
    return { ok: false, workspacePath: "", error: `unparseable response: ${text.slice(0, 80)}` };
  }
}
