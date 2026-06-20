/**
 * settings-patch.ts (lib) — vO-FND.2 idempotent 0-manuel hook merge (PURE).
 *
 * .claude/settings.json'a SessionStart→autopilot + UserPromptSubmit→model-hook hook'larını
 * EKLER (yoksa); mevcut role-hook + her şeyi KORUR. I/O yok → test edilebilir. activate.sh çağırır.
 * Idempotent: zaten varsa eklemez (çift-ekleme yok). Adopt-pattern: npm-pkg-set/dotfile-merge.
 */

const TSX = "$HOME/Desktop/ollamas/node_modules/.bin/tsx";
const BIN = "$HOME/Desktop/ollamas-orchestration-wt/orchestration/bin";
const AUTOPILOT_CMD = `${TSX} ${BIN}/autopilot.ts --quiet`;
const MODELHOOK_CMD = `${TSX} ${BIN}/model-hook.ts`;

export interface PatchResult { json: string; changed: boolean; added: string[] }

type HookEntry = { type: string; command: string };
type HookGroup = { matcher: string; hooks: HookEntry[] };

/** Bir hook-event dizisi verilen alt-string'i içeren komut barındırıyor mu (nested arama). */
function hasCommand(groups: unknown, needle: string): boolean {
  return JSON.stringify(groups ?? []).includes(needle);
}

/**
 * settings.json'a 0-manuel hook'larını idempotent ekle. Mevcut yapı KORUNUR.
 * Boş/bozuk JSON → iskelet. Dönüş: {json (2-space pretty + newline), changed, added[]}.
 */
export function patchSettings(currentJson: string): PatchResult {
  let obj: any;
  try {
    obj = JSON.parse(currentJson);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) obj = {};
  } catch {
    obj = {};
  }
  if (!obj.hooks || typeof obj.hooks !== "object") obj.hooks = {};
  const added: string[] = [];

  // SessionStart → autopilot.ts (sekme açılışı 0-manuel-işlem).
  if (!hasCommand(obj.hooks.SessionStart, "autopilot.ts")) {
    const grp: HookGroup = { matcher: "", hooks: [{ type: "command", command: AUTOPILOT_CMD }] };
    obj.hooks.SessionStart = [...(Array.isArray(obj.hooks.SessionStart) ? obj.hooks.SessionStart : []), grp];
    added.push("SessionStart→autopilot");
  }

  // UserPromptSubmit → model-hook.ts (model-sorusu 0-manuel-seçim); role-hook KORUNUR.
  if (!hasCommand(obj.hooks.UserPromptSubmit, "model-hook.ts")) {
    const ups = obj.hooks.UserPromptSubmit;
    const entry: HookEntry = { type: "command", command: MODELHOOK_CMD };
    if (Array.isArray(ups) && ups.length > 0 && Array.isArray(ups[0].hooks)) {
      ups[0].hooks.push(entry); // mevcut gruba ekle (role-hook ile yan yana)
    } else {
      obj.hooks.UserPromptSubmit = [...(Array.isArray(ups) ? ups : []), { matcher: "", hooks: [entry] }];
    }
    added.push("UserPromptSubmit→model-hook");
  }

  return { json: JSON.stringify(obj, null, 2) + "\n", changed: added.length > 0, added };
}
