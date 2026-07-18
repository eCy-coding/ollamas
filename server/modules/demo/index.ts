// O0 demo module (02-o0-foundation.md §3 FAZ 5) — the first complete ModuleDef,
// proving the whole chain end-to-end: route + tool + SQLite persistence + vector
// search + tab. Toggle: MODULE_DEMO (default OFF). v7 (module_demo_items) lives
// in the CORE migration ledger (§2.5), so this module declares no migrations of
// its own. Later modules copy this directory.
import { defineModule } from "../registry";
import { mountDemoRoutes } from "./router";
import { echo } from "./service";

export const demoModule = defineModule({
  id: "demo",
  envFlag: "MODULE_DEMO",
  tab: { labelKey: "app.tab.demo", icon: "Box" },
  mountRoutes: mountDemoRoutes,
  tools: [
    {
      name: "demo_echo",
      tier: "safe",
      schema: {
        type: "function",
        function: {
          name: "demo_echo",
          description: "Echo the provided text back (O0 demo module template tool).",
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
          },
        },
      },
      // Delegates to the service layer. The ONLY execution path is the
      // ToolRegistry choke-point (ToolRegistry.execute) — modules never bypass it.
      invoke: async (args: { text?: unknown }) => echo(args?.text),
    },
  ],
});
