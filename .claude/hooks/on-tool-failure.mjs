#!/usr/bin/env node
// PostToolUseFailure hook — capture a failed tool call and feed structured error context
// back to the model so it can self-recover (root-cause first, not blind retry).
// Cannot block (failure already happened). Emits hookSpecificOutput.additionalContext on exit 0.

let raw = "";
process.stdin.on("data", (c) => (raw += c)).on("end", () => {
  let p = {};
  try { p = JSON.parse(raw || "{}"); } catch { process.exit(0); }

  const tool = p.tool_name || "?";
  const err = String(p.tool_error || p.error || "").slice(0, 600);
  const cmd = p.tool_input?.command || p.tool_input?.file_path || "";

  if (!err) process.exit(0);

  const hint =
    /permission|denied|EACCES/i.test(err) ? "İzin/erişim sorunu — yol/yetki doğrula, root-cause." :
    /ENOENT|not found|no such/i.test(err) ? "Eksik dosya/binary — varlığını doğrula, kurulum gerekebilir." :
    /timeout|timed out/i.test(err) ? "Timeout — işi küçült/arka plana al, körü körüne retry etme." :
    /403|subscription/i.test(err) ? "403/abonelik — alternatif sağlayıcı/model seç." :
    "Hatayı root-cause düzeyinde çöz; aynı çağrıyı tekrarlama.";

  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PostToolUseFailure",
      additionalContext: `Tool '${tool}' FAILED${cmd ? ` (${String(cmd).slice(0, 80)})` : ""}: ${err}\nİpucu: ${hint}`,
    },
  }));
  process.exit(0);
});
