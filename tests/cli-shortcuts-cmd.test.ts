import { describe, it, expect } from "vitest";
import { planArtifacts } from "../cli/commands/shortcuts";
import { allRecipes, API_KEY_PLACEHOLDER } from "../cli/lib/shortcuts";

const gw = "https://box.tailnet.ts.net";

describe("planArtifacts (pure — no disk)", () => {
  const recipes = allRecipes(gw, API_KEY_PLACEHOLDER, "qwen3:8b", "ollama-local");
  const arts = planArtifacts(recipes, "/tmp/sc");

  it("emits a .plist + .card.md per recipe plus a README index", () => {
    const names = arts.map((a) => a.relPath).sort();
    expect(names).toContain("chat.plist");
    expect(names).toContain("chat.card.md");
    expect(names).toContain("status.plist");
    expect(names).toContain("mcp-call.plist");
    expect(names).toContain("README.md");
    // 4 recipes × 2 files + 1 README = 9
    expect(arts.length).toBe(9);
  });

  it("every artifact is mode 0600 and rooted under the out dir", () => {
    for (const a of arts) {
      expect(a.mode).toBe(0o600);
      expect(a.absPath.startsWith("/tmp/sc/")).toBe(true);
    }
  });

  it("plist artifacts carry valid plist content with the gateway url", () => {
    const chat = arts.find((a) => a.relPath === "chat.plist")!;
    expect(chat.content).toContain('<plist version="1.0">');
    expect(chat.content).toContain(gw);
  });

  it("the README lists every recipe and the import command", () => {
    const readme = arts.find((a) => a.relPath === "README.md")!;
    expect(readme.content).toContain("shortcuts import");
    expect(readme.content.toLowerCase()).toContain("chat");
    expect(readme.content.toLowerCase()).toContain("mcp-call");
  });

  it("placeholder auth never leaks a real key into any artifact", () => {
    const all = arts.map((a) => a.content).join("\n");
    expect(all).toContain(API_KEY_PLACEHOLDER);
    expect(all).not.toContain("olm_");
  });
});
