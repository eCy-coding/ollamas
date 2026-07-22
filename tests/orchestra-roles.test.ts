// L36 — roles, not clones.
//
// Every seat used to get the same context and the same prompt and be asked for the same thing:
// prose. Four models writing four essays about one question is a panel. These tests pin the
// distinct contracts: eCym answers with a COMMAND, obsidian answers with what the LIVE vault
// knows, and neither is allowed to fake it when it cannot.
import { describe, test, expect } from "vitest";
import {
  matchCommand, ecymPropose, freeFormProposal, fold, ROLE_CARDS, obsidianContribute,
} from "../server/orchestra-roles";
import { readEcymCommands } from "../server/brain-obsidian-ecym";
import type { EcymCommand } from "../server/brain-obsidian-ecym";

const cmd = (o: Partial<EcymCommand>): EcymCommand => ({
  id: "x", level: "baslangic", triggers: [], cmd: "true", arg: "yok", desc: "", safe: true, ...o,
});

describe("Turkish folding (the catalog's triggers are written without diacritics)", () => {
  test("diacritics and punctuation fold to the catalog's spelling", () => {
    expect(fold("Çalışma Dizini")).toBe("calisma dizini");
    expect(fold("İşlem ağacı, göster!")).toBe("islem agaci goster");
    expect(fold("")).toBe("");
  });
});

describe("command matching", () => {
  const catalog = [
    cmd({ id: "df", cmd: "df -h", triggers: ["disk doluluk", "disk durumu"], desc: "disk" }),
    cmd({ id: "pwd", cmd: "pwd", triggers: ["hangi dizin", "neredeyim"], desc: "dizin" }),
    cmd({ id: "ps", cmd: "ps aux", triggers: ["ps"], desc: "süreçler" }),
  ];

  test("a phrase trigger matches inside a longer question", () => {
    expect(matchCommand("disk doluluk durumu nedir", catalog)!.command.id).toBe("df");
  });

  test("a single-word trigger must match a WORD, not a substring", () => {
    // Without this, "ps" fires on "pratikte" and every question looks like a process listing.
    expect(matchCommand("pratikte nasil yapilir", catalog)).toBeNull();
    expect(matchCommand("ps ciktisini goster", catalog)!.command.id).toBe("ps");
  });

  test("a weak partial overlap does not match — a wrong command is worse than none", () => {
    expect(matchCommand("disk hakkinda genel bilgi ver", [cmd({ id: "a", triggers: ["disk doluluk yuzdesi"] })])).toBeNull();
  });

  test("the more specific trigger wins a tie", () => {
    const c = [
      cmd({ id: "short", triggers: ["disk"] }),
      cmd({ id: "long", triggers: ["disk doluluk"] }),
    ];
    expect(matchCommand("disk doluluk", c)!.command.id).toBe("long");
  });

  test("an empty question matches nothing", () => {
    expect(matchCommand("", catalog)).toBeNull();
    expect(matchCommand("   ", catalog)).toBeNull();
  });
});

describe("eCym's role output is a command, not an essay", () => {
  test("the catalog's own safe flag is carried through", () => {
    const safe = ecymPropose("disk doluluk", [cmd({ id: "df", cmd: "df -h", triggers: ["disk doluluk"], safe: true })]);
    expect(safe).toMatchObject({ cmd: "df -h", id: "df", safe: true });
    const gated = ecymPropose("oldur", [cmd({ id: "kill", cmd: "kill", arg: "-9", triggers: ["oldur"], safe: false })]);
    expect(gated).toMatchObject({ cmd: "kill -9", safe: false });
  });

  test("`arg: yok` means no argument, not a literal 'yok'", () => {
    expect(ecymPropose("neredeyim", [cmd({ id: "pwd", cmd: "pwd", arg: "yok", triggers: ["neredeyim"] })])!.cmd).toBe("pwd");
  });

  test("an unfilled {{placeholder}} drops to gated even when the catalog says safe", () => {
    // `pgrep -il {{name}}` is genuinely safe once filled — but nothing here can fill it, and
    // running the literal placeholder is not the command anyone meant.
    const p = ecymPropose("process bul", [cmd({ id: "pgrep", cmd: "pgrep -il {{name}}", triggers: ["process bul"], safe: true })])!;
    expect(p.safe).toBe(false);
    expect(p.needsArgument).toBe(true);
  });

  test("a free-form command is never safe — nobody reviewed it", () => {
    expect(freeFormProposal("rm -rf /tmp/x")).toMatchObject({ safe: false, id: null });
  });

  test("no match returns null so the caller must decide, rather than a guessed command", () => {
    expect(ecymPropose("bugün hava nasıl", [cmd({ id: "df", triggers: ["disk doluluk"] })])).toBeNull();
  });
});

describe("against the REAL catalog", () => {
  const catalog = readEcymCommands();
  const has = catalog.length > 0;

  test.skipIf(!has)("the catalog is the documented 220 commands with a mixed safe flag", () => {
    expect(catalog.length).toBeGreaterThanOrEqual(200);
    const safe = catalog.filter((c) => c.safe === true || String(c.safe).toLowerCase() === "true").length;
    expect(safe).toBeGreaterThan(50);
    expect(safe).toBeLessThan(catalog.length); // gated ones genuinely exist
  });

  test.skipIf(!has)("real questions resolve to the right real commands", () => {
    expect(ecymPropose("disk doluluk durumu nedir", catalog)).toMatchObject({ cmd: "df -h", safe: true });
    expect(ecymPropose("hangi dizindeyim", catalog)).toMatchObject({ cmd: "pwd", safe: true });
  });

  test.skipIf(!has)("destructive catalog entries never come back as safe", () => {
    for (const c of catalog) {
      const p = ecymPropose((c.triggers ?? [])[0] ?? "", catalog);
      if (p && /^(rm|kill|killall|shutdown|reboot|dd)\b/.test(p.cmd)) {
        expect(p.safe, `${p.cmd} must not be auto-runnable`).toBe(false);
      }
    }
  });
});

describe("obsidian's role degrades honestly", () => {
  test("a closed vault reports why — never an empty list dressed as 'nothing found'", async () => {
    const prev = process.env.OBSIDIAN_VAULT;
    process.env.OBSIDIAN_VAULT = "/nonexistent/vault";
    try {
      const c = await obsidianContribute("herhangi bir şey", 1);
      expect(c.ok).toBe(false);
      expect(c.findings).toEqual([]);
      expect(c.reason).toBeTruthy();
    } finally {
      if (prev === undefined) delete process.env.OBSIDIAN_VAULT; else process.env.OBSIDIAN_VAULT = prev;
    }
  });
});

describe("role contract", () => {
  test("all three members are declared, each with something the others cannot do", () => {
    expect(ROLE_CARDS.map((c) => c.name).sort()).toEqual(["ecym", "obsidian", "ollamas"]);
    for (const c of ROLE_CARDS) {
      expect(c.unique.length).toBeGreaterThan(20);
      expect(c.capability.length).toBeGreaterThan(20);
    }
    // The uniqueness claims must actually differ — otherwise they are clones with labels.
    expect(new Set(ROLE_CARDS.map((c) => c.unique)).size).toBe(3);
  });
});
