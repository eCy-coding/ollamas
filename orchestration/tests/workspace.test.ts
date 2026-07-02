import { describe, it, expect } from "vitest";
import { selectWorkspaceRequest, parseWorkspaceResp } from "../bin/lib/workspace";

describe("selectWorkspaceRequest — POST /api/workspace/select", () => {
  it("builds the correct url + JSON body for a repo path", () => {
    const r = selectWorkspaceRequest("http://127.0.0.1:3000", "/Users/x/Desktop/ollamas");
    expect(r.url).toBe("http://127.0.0.1:3000/api/workspace/select");
    expect(r.method).toBe("POST");
    expect(JSON.parse(r.body)).toEqual({ path: "/Users/x/Desktop/ollamas" });
    expect(r.contentType).toBe("application/json");
  });
  it("strips a trailing slash from the base url", () => {
    expect(selectWorkspaceRequest("http://127.0.0.1:3000/", "/repo").url).toBe("http://127.0.0.1:3000/api/workspace/select");
  });
});

describe("parseWorkspaceResp", () => {
  it("ok when the server reports success + workspacePath", () => {
    const r = parseWorkspaceResp(JSON.stringify({ success: true, workspacePath: "/repo" }));
    expect(r.ok).toBe(true);
    expect(r.workspacePath).toBe("/repo");
  });
  it("not ok + surfaces the server error", () => {
    const r = parseWorkspaceResp(JSON.stringify({ error: "Cannot initialize path: EACCES" }));
    expect(r.ok).toBe(false);
    expect(r.error).toContain("EACCES");
  });
  it("not ok on unparseable body", () => {
    expect(parseWorkspaceResp("<html>500</html>").ok).toBe(false);
  });
});
