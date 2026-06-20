import { describe, it, expect } from "vitest";
import { patchSettings } from "../bin/lib/settings-patch";

const ROLE_ONLY = JSON.stringify({
  hooks: { UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: "$HOME/x/role-hook.ts" }] }] },
}, null, 2);

describe("patchSettings — idempotent 0-manuel hook merge (PURE)", () => {
  it("boş → SessionStart(autopilot) + UserPromptSubmit(model-hook) ekler", () => {
    const r = patchSettings("{}");
    expect(r.changed).toBe(true);
    expect(r.added.length).toBe(2);
    expect(r.json).toContain("autopilot.ts");
    expect(r.json).toContain("model-hook.ts");
  });
  it("yalnız role-hook → SessionStart+model-hook ekler, role-hook KORUNUR", () => {
    const r = patchSettings(ROLE_ONLY);
    expect(r.changed).toBe(true);
    expect(r.json).toContain("role-hook.ts");   // korundu
    expect(r.json).toContain("autopilot.ts");   // SessionStart eklendi
    expect(r.json).toContain("model-hook.ts");  // UserPromptSubmit'e eklendi
    // model-hook role-hook ile AYNI UserPromptSubmit grubunda (her ikisi de var)
    const obj = JSON.parse(r.json);
    const upCmds = JSON.stringify(obj.hooks.UserPromptSubmit);
    expect(upCmds).toContain("role-hook.ts");
    expect(upCmds).toContain("model-hook.ts");
  });
  it("ZATEN-patched → changed=false (idempotent, çift-ekleme yok)", () => {
    const once = patchSettings(ROLE_ONLY).json;
    const twice = patchSettings(once);
    expect(twice.changed).toBe(false);
    expect(twice.added.length).toBe(0);
    // model-hook tam 1 kez
    expect((twice.json.match(/model-hook\.ts/g) || []).length).toBe(1);
    expect((twice.json.match(/autopilot\.ts/g) || []).length).toBe(1);
  });
  it("bozuk JSON → iskelet + graceful (her ikisini ekler)", () => {
    const r = patchSettings("{bozuk json");
    expect(r.changed).toBe(true);
    expect(r.json).toContain("autopilot.ts");
    expect(() => JSON.parse(r.json)).not.toThrow();
  });
  it("deterministik — aynı girdi aynı çıktı", () => {
    expect(patchSettings(ROLE_ONLY).json).toBe(patchSettings(ROLE_ONLY).json);
  });
});
