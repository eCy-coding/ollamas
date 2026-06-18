// MCP prompts (Faz 11A). Exposes the ollamas 3-stage pipeline (Architect →
// Coder → Reviewer) as reusable MCP prompts, plus argument autocomplete
// (completion/complete) for enum args. Pure data + templating; no deps.

export interface PromptArg { name: string; description: string; required?: boolean; }
export interface PromptDef {
  name: string;
  title: string;
  description: string;
  arguments: PromptArg[];
  /** Build the user message text from supplied arguments. */
  render: (args: Record<string, string>) => string;
  /** Enum suggestions per argument, for completion/complete. */
  enums?: Record<string, string[]>;
}

export const PROMPTS: PromptDef[] = [
  {
    name: "architect",
    title: "Architect",
    description: "Design the directory layout, file structure and architecture for a task.",
    arguments: [
      { name: "task", description: "What to design.", required: true },
      { name: "context", description: "Existing constraints / stack.", required: false },
    ],
    render: (a) =>
      `You are a Systems Architect. Design the project directory layout, file structures and architecture mapping for:\n\nTASK: ${a.task || ""}\n${a.context ? `CONTEXT: ${a.context}\n` : ""}\nReturn a clear file tree + responsibilities + key interfaces. No code yet.`,
  },
  {
    name: "coder",
    title: "Coder",
    description: "Write full, executable file contents from a spec.",
    arguments: [
      { name: "spec", description: "The design/spec to implement.", required: true },
      { name: "language", description: "Target language.", required: false },
      { name: "style", description: "Coding style.", required: false },
    ],
    enums: { language: ["python", "typescript", "rust", "go", "java"], style: ["strict", "minimal", "documented"] },
    render: (a) =>
      `You are a Software Developer. Write the FULL completed executable content for each file the spec requires.${a.language ? ` Language: ${a.language}.` : ""}${a.style ? ` Style: ${a.style}.` : ""}\n\nSPEC:\n${a.spec || ""}\n\nAnnotate each file with FILE: <path>. No placeholders.`,
  },
  {
    name: "reviewer",
    title: "Reviewer",
    description: "Audit emitted code for correctness, security and Big-O.",
    arguments: [
      { name: "code", description: "The code to review.", required: true },
      { name: "spec", description: "What it should do.", required: false },
      { name: "focus", description: "Review lens.", required: false },
    ],
    enums: { focus: ["security", "performance", "maintainability", "tests"] },
    render: (a) =>
      `You are a Code Reviewer. Audit the code for correctness vs the spec, security, and Big-O performance.${a.focus ? ` Focus: ${a.focus}.` : ""}\n\n${a.spec ? `SPEC:\n${a.spec}\n\n` : ""}CODE:\n${a.code || ""}\n\nList concrete issues (severity-tagged) + fixes. No praise.`,
  },
];

export function getPrompt(name: string): PromptDef | undefined {
  return PROMPTS.find((p) => p.name === name);
}

/** completion/complete suggestions for a prompt argument (prefix-filtered). */
export function completeArg(promptName: string, argName: string, value: string): string[] {
  const values = getPrompt(promptName)?.enums?.[argName] || [];
  const v = (value || "").toLowerCase();
  return values.filter((x) => x.toLowerCase().startsWith(v));
}
