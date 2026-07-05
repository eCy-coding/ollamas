// Güven testleri — fleet-aware routing kararı (selectFleetBackend): rutin 8b → Windows CUDA, ağır → Mac.
// SAF/deterministik: pool + probes override edilir (fs/ağ yok). 503 darboğaz fix'inin çekirdek kararı.
import { describe, test, expect } from "vitest";
import { ProviderRouter } from "../server/providers";
import type { Backend, BackendProbe } from "../cli/lib/remote";

const WIN: Backend = { name: "win", url: "http://win:11434", priority: 10 };
const MAC: Backend = { name: "mac", url: "http://localhost:11434", priority: 99 };
const probe = (url: string, models: string[], reachable = true): BackendProbe => ({ url, reachable, models });

describe("fleet routing — selectFleetBackend (boş Windows GPU'yu kullan, Mac'i boşalt)", () => {
  test("8b: Windows erişilebilir + modeli sunuyor → Windows seçilir (priority 10 < 99)", async () => {
    const b = await ProviderRouter.selectFleetBackend("qwen3:8b", [WIN, MAC],
      [probe(WIN.url, ["qwen3:8b"]), probe(MAC.url, ["qwen3:8b"])]);
    expect(b?.name).toBe("win");
  });

  test("ağır model Windows'ta yok → Mac'e düşer", async () => {
    const b = await ProviderRouter.selectFleetBackend("qwen3-coder:480b-cloud", [WIN, MAC],
      [probe(WIN.url, ["qwen3:8b"]), probe(MAC.url, ["qwen3-coder:480b-cloud", "qwen3:8b"])]);
    expect(b?.name).toBe("mac");
  });

  test("Windows down (reachable=false) → Mac'e düşer", async () => {
    const b = await ProviderRouter.selectFleetBackend("qwen3:8b", [WIN, MAC],
      [probe(WIN.url, [], false), probe(MAC.url, ["qwen3:8b"])]);
    expect(b?.name).toBe("mac");
  });

  test("hiçbir backend modeli sunmuyor → null (çağıran ollama-local'e düşer)", async () => {
    const b = await ProviderRouter.selectFleetBackend("nonexistent:1b", [WIN, MAC],
      [probe(WIN.url, ["qwen3:8b"]), probe(MAC.url, ["qwen3:8b"])]);
    expect(b).toBeNull();
  });

  test("boş pool → null", async () => {
    const b = await ProviderRouter.selectFleetBackend("qwen3:8b", []);
    expect(b).toBeNull();
  });

  test("responsive=false (tags OK ama inference ölü) → atlanır, Mac'e düşer", async () => {
    const b = await ProviderRouter.selectFleetBackend("qwen3:8b", [WIN, MAC],
      [{ url: WIN.url, reachable: true, models: ["qwen3:8b"], responsive: false }, probe(MAC.url, ["qwen3:8b"])]);
    expect(b?.name).toBe("mac");
  });
});
