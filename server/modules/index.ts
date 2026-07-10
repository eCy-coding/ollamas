// O0 module barrel — server.ts imports mountEnabledModules from HERE so that
// importing it also side-effect-registers every shipped module definition
// (defineModule calls in each module's index.ts) before the boot-time mount.
// Adding a module = one import line here + its server/modules/<id>/ directory.
import "./demo"; // side-effect: defineModule({ id: "demo", ... })

export {
  defineModule,
  moduleEnabled,
  mountEnabledModules,
  enabledModules,
  allModuleMigrations,
  type ModuleDef,
} from "./registry";
