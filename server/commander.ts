import { exec } from 'child_process';
import util from 'util';
import path from 'path';
import fs from 'fs';

const execPromise = util.promisify(exec);

export class DesktopCommander {
    private static ALLOWED_COMMANDS = [
        'ls', 'whoami', 'pwd', 'date', 'uptime', 'df', 'git', 'python3', 
        'top', 'netstat', 'find', 'openssl', 'ps'
    ]; // Strict Allowlist
    private static SCRIPTS_DIR = path.join(process.cwd(), 'bin', 'scripts');

    public static async execute(command: string, args: string[]): Promise<string> {
        if (!this.ALLOWED_COMMANDS.includes(command)) {
            throw new Error(`Command ${command} not permitted in desktop scope.`);
        }
        
        let finalCommand = command;
        let finalArgs = args;

        if (command === 'python3') {
            const scriptName = args[0];
            if (!scriptName?.endsWith('.py')) {
                throw new Error("Invalid Python script.");
            }
            const scriptPath = path.join(this.SCRIPTS_DIR, scriptName);
            // Path-traversal guard: resolved path must stay under SCRIPTS_DIR.
            const root = path.resolve(this.SCRIPTS_DIR);
            if (!path.resolve(scriptPath).startsWith(root + path.sep)) {
                throw new Error("Path traversal blocked.");
            }
            if (!fs.existsSync(scriptPath)) {
                throw new Error("Script not found.");
            }
            finalArgs = [scriptPath, ...args.slice(1)];
        }
        
        try {
            const { stdout } = await execPromise(`${finalCommand} ${finalArgs.join(' ')}`);
            return stdout;
        } catch (e: any) {
            throw new Error(`Execution failed: ${e.message}`);
        }
    }
}
