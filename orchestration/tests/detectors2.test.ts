import { describe, it, expect } from "vitest";
import {
  lineCount, stripComments,
  chokepointBypass, oversizedComponent, anyDensity,
  hardcodedSecret, insecureHttp,
  shellStrictMode, lanExposure, unquotedRmVar,
  toolMissingOutputSchema, chokepointBypassExec,
} from "../bin/lib/detectors";

// Test fixture'ı: literal AWS-anahtar şeklini dosyada tutma (secret-scan hook + kendi
// detector'ımız tetikler) → çalışma anında parçadan kur. Regex AKIA[0-9A-Z]{16} eşleşir.
const FAKE_AWS = "AK" + "IA" + "ABCDEFGH12345678"; // AKIA + 16 char

describe("util: lineCount / stripComments", () => {
  it("lineCount satır sayar", () => {
    expect(lineCount("a\nb\nc")).toBe(3);
    expect(lineCount("")).toBe(0);
  });
  it("stripComments // ve /* */ ve # satırlarını kaldırır", () => {
    const s = stripComments("kod1\n// yorum\nkod2 // satıriçi\n/* blok */\n# kabuk");
    expect(s).not.toMatch(/yorum|blok|kabuk/);
    expect(s).toMatch(/kod1/);
    expect(s).toMatch(/kod2/);
  });
});

describe("frontend: chokepointBypass", () => {
  it("apiClient dışı raw fetch → bulgu", () => {
    const out = chokepointBypass("src/Foo.tsx", "const r = await fetch('/api/x')");
    expect(out.length).toBe(1);
    expect(out[0].severity).toBe("med");
  });
  it("apiClient dosyası muaf", () => {
    expect(chokepointBypass("src/lib/apiClient.ts", "fetch('/api/x')")).toEqual([]);
  });
  it("test dosyası muaf", () => {
    expect(chokepointBypass("src/Foo.test.tsx", "fetch('/x')")).toEqual([]);
  });
  it("fetch yok → bulgu yok", () => {
    expect(chokepointBypass("src/Foo.tsx", "const x = 1")).toEqual([]);
  });
});

describe("frontend: oversizedComponent", () => {
  it("eşik üstü → bulgu", () => {
    expect(oversizedComponent("src/components/Big.tsx", 401, 400).length).toBe(1);
  });
  it("eşik sınırı (400) → bulgu yok", () => {
    expect(oversizedComponent("src/components/Big.tsx", 400, 400)).toEqual([]);
  });
});

describe("fullstack: anyDensity", () => {
  it("yüksek oran + min üstü → bulgu", () => {
    expect(anyDensity("server.ts", 6, 50).length).toBe(1);
  });
  it("düşük oran → bulgu yok", () => {
    expect(anyDensity("server.ts", 6, 400)).toEqual([]);
  });
  it("min altı → bulgu yok", () => {
    expect(anyDensity("server.ts", 4, 10)).toEqual([]);
  });
});

describe("integrations: hardcodedSecret", () => {
  it("AWS key → blocker", () => {
    const out = hardcodedSecret("server/x.ts", `const k = "${FAKE_AWS}"`);
    expect(out.length).toBeGreaterThanOrEqual(1);
    expect(out[0].severity).toBe("blocker");
  });
  it("private key header → blocker", () => {
    expect(hardcodedSecret("k.ts", "-----BEGIN RSA PRIVATE KEY-----").length).toBe(1);
  });
  it("generic apiKey 20+ → high", () => {
    const out = hardcodedSecret("s.ts", 'apiKey="aB3xK9pQ2rL7mN4tV8wZ"');
    expect(out.some((f) => f.severity === "high")).toBe(true);
  });
  it("placeholder muaf", () => {
    expect(hardcodedSecret("s.ts", 'apiKey="<your-key-here>"')).toEqual([]);
    expect(hardcodedSecret("s.ts", "apiKey=process.env.KEY")).toEqual([]);
  });
  it(".env.example muaf", () => {
    expect(hardcodedSecret(".env.example", 'API_KEY="aB3xK9pQ2rL7mN4tV8wZ"')).toEqual([]);
  });
});

describe("integrations: insecureHttp", () => {
  it("dış http:// → bulgu", () => {
    expect(insecureHttp("src/api.ts", 'fetch("http://api.foo.com")').length).toBe(1);
  });
  it("localhost muaf", () => {
    expect(insecureHttp("src/api.ts", 'fetch("http://localhost:3000")')).toEqual([]);
  });
  it("xmlns/w3.org muaf", () => {
    expect(insecureHttp("s.ts", 'xmlns="http://www.w3.org/2000/svg"')).toEqual([]);
  });
});

describe("macos: shellStrictMode", () => {
  it("shebang + flag yok → bulgu", () => {
    expect(shellStrictMode("run.sh", "#!/bin/bash\necho hi").length).toBe(1);
  });
  it("set -euo pipefail var → bulgu yok", () => {
    expect(shellStrictMode("run.sh", "#!/bin/bash\nset -euo pipefail\necho hi")).toEqual([]);
  });
  it("ayrı flag'ler (set -e/-u/-o pipefail) → bulgu yok", () => {
    expect(shellStrictMode("run.sh", "#!/bin/bash\nset -e\nset -u\nset -o pipefail")).toEqual([]);
  });
  it("shebang yok → bulgu yok (kabuk değil)", () => {
    expect(shellStrictMode("notes.sh", "echo hi")).toEqual([]);
  });
});

describe("macos: lanExposure", () => {
  it("0.0.0.0 bind bağlamı → high", () => {
    expect(lanExposure("start.sh", "--host 0.0.0.0").length).toBe(1);
  });
  it("yorumdaki 0.0.0.0 muaf", () => {
    expect(lanExposure("start.sh", "# bind 0.0.0.0 example")).toEqual([]);
  });
});

describe("macos: unquotedRmVar", () => {
  it("tırnaksız rm -rf $VAR → blocker", () => {
    expect(unquotedRmVar("c.sh", "rm -rf $DIR").length).toBe(1);
  });
  it("tırnaklı muaf", () => {
    expect(unquotedRmVar("c.sh", 'rm -rf "$DIR"')).toEqual([]);
  });
});

describe("mcp: toolMissingOutputSchema", () => {
  it("input var output yok → bulgu", () => {
    expect(toolMissingOutputSchema("mytool", true, false).length).toBe(1);
  });
  it("output var → bulgu yok", () => {
    expect(toolMissingOutputSchema("mytool", true, true)).toEqual([]);
  });
  it("input yok → bulgu yok (tool def değil)", () => {
    expect(toolMissingOutputSchema("x", false, false)).toEqual([]);
  });
});

describe("mcp: chokepointBypassExec", () => {
  it("registry dışı .execute( → bulgu", () => {
    expect(chokepointBypassExec("server/foo.ts", "tool.execute(args)").length).toBe(1);
  });
  it("tool-registry.ts muaf", () => {
    expect(chokepointBypassExec("server/tool-registry.ts", "this.execute(args)")).toEqual([]);
  });
  it("test muaf", () => {
    expect(chokepointBypassExec("server/foo.test.ts", "tool.execute(args)")).toEqual([]);
  });
  it("kanonik ToolRegistry.execute muaf — choke-point'in kendisi bypass değil (ERR-ORCH-007)", () => {
    expect(chokepointBypassExec("server/mcp/server.ts", "const r = await ToolRegistry.execute(name, args)")).toEqual([]);
  });
});
