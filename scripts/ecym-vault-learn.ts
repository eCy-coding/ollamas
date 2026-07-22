// L23: eCym closed learning loop runner. Bridges vault approvals into the ecy-learn pipeline:
//   ecym/_learning-queue.md  --[x]-->  approved-learning.jsonl  (L16, in-sync)
//        --> misses.log  (this bridge)  --> ecy-learn drafts  --> misses.review.json  (human approves)
// Honest boundary: this NEVER edits terminal-dataset.json. It only queues misses and asks
// ecy-learn to draft; the human still reviews misses.review.json before anything ships.
// Graceful: if ecy-learn / ecy 8B is unavailable, the queue is still populated for later.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { bridgeApprovedToMisses } from "../server/brain-obsidian-ecym";

const { added, queued } = bridgeApprovedToMisses();

let drafted = false;
let draftNote = "skipped (no new approvals)";
if (added > 0) {
  const learn = `${process.env.HOME}/.local/bin/ecy-learn`;
  if (existsSync(learn)) {
    // best-effort: ecy-learn calls ecy 8B (:11434); if that's down it exits cleanly with 0 drafts.
    const r = spawnSync(learn, [], { encoding: "utf8", timeout: 120_000 });
    drafted = r.status === 0;
    draftNote = drafted ? "ecy-learn ran → misses.review.json drafts (manual approve pending)"
                        : `ecy-learn exit=${r.status ?? "signal"} (ecy 8B down? queue still populated)`;
  } else {
    draftNote = "ecy-learn CLI not found (~/.local/bin/ecy-learn) — queue populated for later";
  }
}

console.log(JSON.stringify({
  event: "ecym.vault-learn", approvalsQueued: added, queued, drafted, note: draftNote,
}));
