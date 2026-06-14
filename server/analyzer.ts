import fs from 'fs';
import path from 'path';

export class SystemAnalyzer {
    public static analyze() {
        const tools = JSON.parse(fs.readFileSync('tools.json', 'utf8')).tools;
        const scripts = fs.readdirSync(path.join(process.cwd(), 'bin', 'scripts'));
        
        return {
            defined_tools: Object.keys(tools),
            available_scripts: scripts,
            gaps: Object.keys(tools).filter(t => !scripts.includes(t + '.py'))
        };
    }
}
