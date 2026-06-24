import { describe, it, expect } from "vitest";
import { git, discoverWorktrees, findFile, resolveLane, ANCHOR, type Worktree } from "../bin/shared";

// resolveLane SAF testi için sabit worktree seti (I/O yok).
const WTS: Worktree[] = [
  { path: ANCHOR, branch: "feat/v1.11-roots-abort", head: "aaaaaaa" },
  { path: "/x/ollamas-frontend-wt", branch: "feat/frontend-vf3", head: "bbbbbbb" },
  { path: "/x/ollamas-scripts-wt", branch: "feat/scripts-v1", head: "ccccccc" },
  { path: "/x/ollamas-integrations-wt", branch: "feat/gateway-v2", head: "ddddddd" },
  { path: "/x/ollamas-v17-wt", branch: "feat/v1.8-bench", head: "eeeeeee" },
  { path: "/x/ollamas-orchestration-wt", branch: "feat/orchestration-v3", head: "fffffff" },
  { path: "/x/ollamas-cli-wt", branch: "feat/cli-v2-clean", head: "ggggggg" },
];

describe("resolveLane (SAF) — lane adı → worktree", () => {
  it("backend/main/gateway-core → ana repo (path===ANCHOR)", () => {
    for (const alias of ["backend", "main", "gateway-core", "BACKEND"]) {
      expect(resolveLane(alias, WTS)?.path).toBe(ANCHOR);
    }
  });
  it("alias regex eşleşmesi (branch/path)", () => {
    expect(resolveLane("frontend", WTS)?.branch).toBe("feat/frontend-vf3");
    expect(resolveLane("scripts", WTS)?.branch).toBe("feat/scripts-v1");
    expect(resolveLane("integrations", WTS)?.branch).toBe("feat/gateway-v2"); // /gateway|integration/
    expect(resolveLane("bench", WTS)?.branch).toBe("feat/v1.8-bench");
    expect(resolveLane("orchestration", WTS)?.branch).toBe("feat/orchestration-v3");
    expect(resolveLane("cli", WTS)?.branch).toBe("feat/cli-v2-clean"); // /\bcli\b|cli-/
  });
  it("serbest eşleşme (branch/path substring)", () => {
    expect(resolveLane("v17", WTS)?.branch).toBe("feat/v1.8-bench"); // path'te ollamas-v17-wt
  });
  it("eşleşme yok → null; boş set → null", () => {
    expect(resolveLane("yok-böyle-lane-xyz", WTS)).toBeNull();
    expect(resolveLane("frontend", [])).toBeNull();
  });
});

describe("git (read-only, repo'ya karşı)", () => {
  it("geçerli komut → çıktı döner", () => {
    const branch = git(ANCHOR, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(branch.length).toBeGreaterThan(0);
  });
  it("hatalı komut → '' (asla throw, graceful)", () => {
    expect(git(ANCHOR, ["bogus-subcommand-zzz"])).toBe("");
    expect(git("/nonexistent-dir-zzz", ["status"])).toBe("");
  });
});

describe("discoverWorktrees (read-only)", () => {
  const wts = discoverWorktrees();
  it("≥1 worktree, her biri {path,branch,head} dolu", () => {
    expect(wts.length).toBeGreaterThan(0);
    for (const w of wts) {
      expect(w.path).toBeTruthy();
      expect(w.branch).toBeTruthy();
      expect(w.head).toBeTruthy();
    }
  });
  it("ANCHOR'ı (orchestration'ın yaşadığı entegre tree) içerir", () => {
    // vO16: lane-worktree'leri integration/all-lanes'e ENTEGRE edildi → ayrı orchestration-worktree YOK;
    // orchestration artık ANCHOR (ana entegre tree) içinde yaşar. discoverWorktrees ANCHOR'ı içermeli.
    expect(wts.some((w) => w.path === ANCHOR)).toBe(true);
  });
});

describe("findFile (read-only)", () => {
  it("ANCHOR'da package.json bulur", () => {
    const hit = findFile(ANCHOR, /^package\.json$/, 1);
    expect(hit).toBeTruthy();
    expect(hit!.endsWith("package.json")).toBe(true);
  });
  it("olmayan dosya → null", () => {
    expect(findFile(ANCHOR, /^zzz-yok-böyle-dosya-zzz$/, 2)).toBeNull();
  });
  it("depth<0 veya olmayan root → null", () => {
    expect(findFile(ANCHOR, /./, -1)).toBeNull();
    expect(findFile("/nonexistent-root-zzz", /./, 3)).toBeNull();
  });
});
