// fleet-order (pure) — order the fleet's parallel slots by the sequenced ethical MISSION (T1→Tn).
// IO-free → unit-tested.
//
// Why: buildFleetPlan produces an UNORDERED set of Terminal.app/iTerm2 slots. The sequenced mission
// (lib/mission.ts) topo-sorts the streams into a dependency-ordered, tool-tier-bounded T1→Tn plan. This
// module joins the two: it sorts the live slots by their stream's mission step order and annotates each
// with the mission order + ethical tier + dependsOn, so `fleet-launch --sequenced` opens the tabs in the
// ethical dependency order (foundation first) instead of an arbitrary one. Slots whose stream is absent
// from the mission sort last (stable), never dropped.

import type { Mission } from "./mission";

// Structural subset of fleet-plan's Assignment we need to order (kept loose so the CLI's richer Assignment
// satisfies it without a cross-import).
export interface SlotLike {
  stream: string;
  app: string;
  slot: string;
}

export interface OrderedSlot<S extends SlotLike = SlotLike> {
  slot: S;
  missionOrder: number;   // T# (mission step order); Infinity-substitute for streams absent from the mission
  tier: string;           // ethical tool-tier for the stream (safe|host); "" when unknown
  dependsOn: string[];    // streams that must complete first
}

const ABSENT = Number.MAX_SAFE_INTEGER; // streams not in the mission sort last (but stay in the plan)

/** Order slots by their stream's mission step. Stable within a stream (preserves the input app/slot order),
 *  and stable across equal orders (streams absent from the mission keep their relative input order, last). */
export function orderSlotsByMission<S extends SlotLike>(slots: S[], mission: Mission): OrderedSlot<S>[] {
  const byStream = new Map(mission.steps.map((st) => [st.stream, st]));
  const annotated: OrderedSlot<S>[] = slots.map((slot) => {
    const step = byStream.get(slot.stream);
    return {
      slot,
      missionOrder: step ? step.order : ABSENT,
      tier: step ? step.tier : "",
      dependsOn: step ? step.dependsOn : [],
    };
  });
  // Stable sort by missionOrder only — Array.prototype.sort is stable in Node, so equal orders keep input order.
  return annotated
    .map((o, i) => ({ o, i }))
    .sort((a, b) => a.o.missionOrder - b.o.missionOrder || a.i - b.i)
    .map(({ o }) => o);
}

/** How many DISTINCT models the ordered slots use ≤2 times — mirrors assertMaxTwo but on the ordered view,
 *  so the sequenced order can be asserted to still honor the ≤2-tasks/model cap. `modelOf` reads the model. */
export function maxTwoOkOrdered<S extends SlotLike>(ordered: OrderedSlot<S>[], modelOf: (s: S) => string | null): boolean {
  const counts = new Map<string, Set<string>>();
  for (const o of ordered) {
    const m = modelOf(o.slot);
    if (!m) continue;
    if (!counts.has(m)) counts.set(m, new Set());
    counts.get(m)!.add(o.slot.stream);
  }
  return [...counts.values()].every((streams) => streams.size <= 2);
}
