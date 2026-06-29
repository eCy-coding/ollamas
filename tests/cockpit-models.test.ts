import { describe, it, expect } from "vitest";
import { rankMacModels } from "../server/cockpit-models";

const RAM = 48e9; // 48GB Mac

describe("rankMacModels", () => {
  it("marks champion recommended and sorts it first", () => {
    const tags = [
      { name: "qwen3:8b", size: 5e9 },
      { name: "llama3:70b", size: 40e9 },
      { name: "phi3:mini", size: 2.3e9 },
    ];
    const v = rankMacModels(tags, RAM, [], "qwen3:8b");
    expect(v.recommended).toBe("qwen3:8b");
    expect(v.list[0].name).toBe("qwen3:8b");
    expect(v.list[0].recommended).toBe(true);
    expect(v.list.filter((m) => m.recommended)).toHaveLength(1);
  });

  it("excludes cloud (size 0 / :cloud suffix) and embed models", () => {
    const tags = [
      { name: "qwen3:8b", size: 5e9 },
      { name: "gpt-oss:cloud", size: 0 },
      { name: "phantom", size: 0 },
      { name: "nomic-embed-text", size: 3e8 },
      { name: "mxbai-embed-large", size: 7e8 },
    ];
    const v = rankMacModels(tags, RAM, [], "qwen3:8b");
    const names = v.list.map((m) => m.name);
    expect(names).toEqual(["qwen3:8b"]);
    expect(names).not.toContain("gpt-oss:cloud");
    expect(names).not.toContain("phantom");
    expect(names).not.toContain("nomic-embed-text");
    expect(names).not.toContain("mxbai-embed-large");
  });

  it("sets fitsRam true when size <= 70% of RAM, false when above", () => {
    const fitLimit = RAM * 0.7; // 33.6e9
    const tags = [
      { name: "fits", size: fitLimit },        // exactly at limit -> true
      { name: "overflow", size: fitLimit + 1 }, // above -> false
    ];
    const v = rankMacModels(tags, RAM, [], "none");
    const fits = v.list.find((m) => m.name === "fits")!;
    const over = v.list.find((m) => m.name === "overflow")!;
    expect(fits.fitsRam).toBe(true);
    expect(over.fitsRam).toBe(false);
  });

  it("sets loaded flag from loadedNames", () => {
    const tags = [
      { name: "qwen3:8b", size: 5e9 },
      { name: "phi3:mini", size: 2.3e9 },
    ];
    const v = rankMacModels(tags, RAM, ["qwen3:8b"], "phi3:mini");
    expect(v.list.find((m) => m.name === "qwen3:8b")!.loaded).toBe(true);
    expect(v.list.find((m) => m.name === "phi3:mini")!.loaded).toBe(false);
  });

  it("falls back to smallest-fitting >=2GB when champion absent", () => {
    const tags = [
      { name: "tiny", size: 1e9 },        // <2GB -> skipped
      { name: "small", size: 2.5e9 },     // smallest >=2GB that fits -> chosen
      { name: "big", size: 10e9 },
      { name: "huge", size: 40e9 },       // > 70% RAM -> does not fit
    ];
    const v = rankMacModels(tags, RAM, [], "missing-champion");
    expect(v.recommended).toBe("small");
    expect(v.list[0].name).toBe("small");
    expect(v.list[0].recommended).toBe(true);
  });

  it("reports totalRamGb", () => {
    const v = rankMacModels([], RAM, [], "x");
    expect(v.totalRamGb).toBe(48);
    expect(v.recommended).toBe(null);
    expect(v.list).toEqual([]);
  });
});
