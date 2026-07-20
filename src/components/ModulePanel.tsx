// O0 Faz 4 (02-o0-foundation.md §3 FAZ 4) — the SINGLE generic panel slot for
// module tabs. O0 ships the registration seam, not per-module UIs: each module
// (O2/O3/O5/O6…) later renders its own surface here keyed by id. Keeping this a
// minimal placeholder is deliberate — App.tsx gets ONE mount point, not a
// per-module `activeTab === "..."` block (avoids the scattered-registration
// anti-pattern O0 exists to kill).
import CookbookPanel from "./CookbookPanel";
import ResearchPanel from "./ResearchPanel";
import NotesTasksPanel from "./NotesTasksPanel";
import DocumentsPanel from "./DocumentsPanel";
import CalendarPanel from "./CalendarPanel";
import EmailPanel from "./EmailPanel";
import SettingsPanel from "./SettingsPanel";
import AgentPolicyPanel from "./AgentPolicyPanel";

interface ModulePanelProps {
  id: string;
  labelKey?: string;
}

export default function ModulePanel({ id, labelKey }: ModulePanelProps) {
  // O7: modules with a real surface render it here, keyed by id (still ONE mount
  // point in App.tsx — no scattered `activeTab === "..."` blocks). Cookbook is the
  // pilot; later modules add a case or their own lazy-loaded panel.
  if (id === "cookbook") return <CookbookPanel />;
  if (id === "research") return <ResearchPanel />;
  if (id === "notes-tasks") return <NotesTasksPanel />;
  if (id === "documents") return <DocumentsPanel />;
  if (id === "calendar") return <CalendarPanel />;
  if (id === "email") return <EmailPanel />;
  if (id === "settings") return <SettingsPanel />;
  if (id === "agent-policy") return <AgentPolicyPanel />;

  return (
    <section
      aria-label={`module-panel-${id}`}
      className="bg-immersive-sidebar border border-immersive-border rounded p-4 text-xs font-mono text-immersive-text-muted"
    >
      <span className="text-status-accent font-bold block mb-1">{labelKey ?? id}</span>
      <span className="text-immersive-text-dim">Module surface mounts here.</span>
    </section>
  );
}
