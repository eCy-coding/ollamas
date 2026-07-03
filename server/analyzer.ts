import fs from 'fs';
import path from 'path';

// A tool is "missing its implementation" only when it declares a .py entryPoint
// that is absent from bin/scripts. The old `name + '.py'` check flagged every
// tool (all entryPoints are "internal"/"proxy", never <name>.py) → 100% false
// positives. Pure + exported so it can be unit-tested without the filesystem.
export function computeGaps(tools: Record<string, any>, scripts: string[]): string[] {
  return Object.entries(tools)
    .filter(([, t]) => typeof t?.entryPoint === "string" && t.entryPoint.endsWith(".py") && !scripts.includes(path.basename(t.entryPoint)))
    .map(([name]) => name);
}

export class SystemAnalyzer {
    public static analyze() {
        const tools = JSON.parse(fs.readFileSync('tools.json', 'utf8')).tools;
        const scripts = fs.readdirSync(path.join(process.cwd(), 'bin', 'scripts'));

        return {
            defined_tools: Object.keys(tools),
            available_scripts: scripts,
            gaps: computeGaps(tools, scripts)
        };
    }
}
