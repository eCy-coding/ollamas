import { describe, it, expect } from "vitest";
import {
  API_KEY_PLACEHOLDER,
  plistEscape,
  plistValue,
  wfAction,
  buildWorkflowPlist,
  recipeChat,
  recipeStatus,
  recipeBench,
  recipeMcpCall,
  recipeCard,
  allRecipes,
  type Recipe,
} from "../cli/lib/shortcuts";

describe("plistEscape", () => {
  it("escapes XML metacharacters", () => {
    expect(plistEscape(`a & b < c > d "e"`)).toBe("a &amp; b &lt; c &gt; d &quot;e&quot;");
  });
  it("leaves plain text untouched", () => {
    expect(plistEscape("qwen3:8b")).toBe("qwen3:8b");
  });
});

describe("plistValue", () => {
  it("renders scalar types with the right plist tags", () => {
    expect(plistValue("hi")).toBe("<string>hi</string>");
    expect(plistValue(42)).toBe("<integer>42</integer>");
    expect(plistValue(1.5)).toBe("<real>1.5</real>");
    expect(plistValue(true)).toBe("<true/>");
    expect(plistValue(false)).toBe("<false/>");
  });
  it("renders arrays and dicts recursively", () => {
    expect(plistValue(["a", 1])).toContain("<array>");
    const d = plistValue({ k: "v" });
    expect(d).toContain("<key>k</key>");
    expect(d).toContain("<string>v</string>");
    expect(d.startsWith("<dict>")).toBe(true);
  });
  it("escapes string content and keys", () => {
    expect(plistValue({ "a&b": "<x>" })).toContain("<key>a&amp;b</key>");
    expect(plistValue({ "a&b": "<x>" })).toContain("<string>&lt;x&gt;</string>");
  });
});

describe("wfAction", () => {
  it("wraps an identifier + parameters in WFWorkflowAction shape", () => {
    expect(wfAction("is.workflow.actions.comment", { WFCommentActionText: "hi" })).toEqual({
      WFWorkflowActionIdentifier: "is.workflow.actions.comment",
      WFWorkflowActionParameters: { WFCommentActionText: "hi" },
    });
  });
});

describe("buildWorkflowPlist", () => {
  const plist = buildWorkflowPlist([wfAction("is.workflow.actions.comment", { WFCommentActionText: "hi" })]);
  it("emits a well-formed XML plist envelope", () => {
    expect(plist.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(plist).toContain("<!DOCTYPE plist");
    expect(plist).toContain('<plist version="1.0">');
    expect(plist.trimEnd().endsWith("</plist>")).toBe(true);
  });
  it("carries the WFWorkflowActions array + client version keys", () => {
    expect(plist).toContain("<key>WFWorkflowActions</key>");
    expect(plist).toContain("<key>WFWorkflowClientVersion</key>");
    expect(plist).toContain("is.workflow.actions.comment");
  });
  it("balances every open tag (no stray markup)", () => {
    // crude well-formedness: equal counts of <dict>/</dict> and <array>/</array>
    const count = (s: string, t: string) => s.split(t).length - 1;
    expect(count(plist, "<dict>")).toBe(count(plist, "</dict>"));
    expect(count(plist, "<array>")).toBe(count(plist, "</array>"));
  });
});

describe("recipes", () => {
  const gw = "https://box.tailnet.ts.net";
  const recipes: Recipe[] = [
    recipeChat(gw, API_KEY_PLACEHOLDER, "qwen3:8b", "ollama-local"),
    recipeStatus(gw, API_KEY_PLACEHOLDER),
    recipeBench(gw, API_KEY_PLACEHOLDER, "qwen3:8b", "ollama-local"),
    recipeMcpCall(gw, API_KEY_PLACEHOLDER),
  ];

  it("each recipe has a slug, name and at least one action", () => {
    for (const r of recipes) {
      expect(r.slug).toMatch(/^[a-z-]+$/);
      expect(r.name.length).toBeGreaterThan(0);
      expect(r.actions.length).toBeGreaterThan(0);
    }
  });

  it("targets the gateway url + chooses stream:false (Shortcuts has no SSE)", () => {
    const plist = buildWorkflowPlist(recipeChat(gw, API_KEY_PLACEHOLDER, "qwen3:8b", "ollama-local").actions);
    expect(plist).toContain(gw);
    expect(plist).toContain("/api/generate");
    expect(plist).toContain("stream");
    expect(plist).not.toContain('<true/></dict>'); // stream must not be true — sanity
    expect(plist).toMatch(/stream[\s\S]*?false/i);
  });

  it("status recipe probes /api/health", () => {
    const plist = buildWorkflowPlist(recipeStatus(gw, API_KEY_PLACEHOLDER).actions);
    expect(plist).toContain("/api/health");
  });

  it("mcp-call recipe targets /mcp with a tools/call body", () => {
    const plist = buildWorkflowPlist(recipeMcpCall(gw, API_KEY_PLACEHOLDER).actions);
    expect(plist).toContain("/mcp");
    expect(plist).toContain("tools/call");
  });

  it("embeds the auth value the caller passes — placeholder by default, never a real key in the core", () => {
    const plist = buildWorkflowPlist(recipeChat(gw, API_KEY_PLACEHOLDER, "qwen3:8b", "ollama-local").actions);
    expect(plist).toContain(`Bearer ${API_KEY_PLACEHOLDER}`);
    // a different auth string flows through verbatim (proves core is key-agnostic)
    const real = buildWorkflowPlist(recipeChat(gw, "olm_secret", "qwen3:8b", "ollama-local").actions);
    expect(real).toContain("Bearer olm_secret");
  });

  it("allRecipes assembles the full pack", () => {
    const pack = allRecipes(gw, API_KEY_PLACEHOLDER, "qwen3:8b", "ollama-local");
    expect(pack.map((r) => r.slug).sort()).toEqual(["bench", "chat", "mcp-call", "status"]);
  });
});

describe("recipeCard", () => {
  it("renders a human, followable manual-install card", () => {
    const card = recipeCard(recipeChat("https://gw", API_KEY_PLACEHOLDER, "qwen3:8b", "ollama-local"));
    expect(card).toContain("chat");
    expect(card).toContain("https://gw");
    expect(card).toContain(API_KEY_PLACEHOLDER);
    // mentions the SSE limitation so iOS users know to keep stream:false
    expect(card.toLowerCase()).toContain("stream");
  });
});
