import fs from "fs";
import path from "path";
import { db } from "./db";

export interface FileItem {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size?: number;
  gitStatus?: "untracked" | "modified" | "staged" | "none";
  children?: FileItem[];
}

// Emulated virtual in-memory files for DEMO mode
const VIRTUAL_FILES: Record<string, string> = {
  "index.py": `def hello_world():\n    print("Hello from LLM Mission Control demo workspace!")\n\nif __name__ == "__main__":\n    hello_world()`,
  "tests/test_basic.py": `def test_math():\n    assert 1 + 1 == 2`,
  "README.md": `# Demo Workspace\nWelcome to your mock sandboxed workspace inside Cloud Run!\nFeel free to explore or use the multi-agent builder to simulate layout design.`,
  "requirements.txt": `pytest>=7.0.0\nruff>=0.1.0`,
};

export class FilesystemManager {
  /**
   * Universal path sanitation and escape guard
   */
  public static resolveSafePath(workspaceRoot: string, relativeTarget: string): string {
    if (!workspaceRoot) {
      throw new Error("Workspace root directory is not configured.");
    }
    const resolvedRoot = path.resolve(workspaceRoot);
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal — confined by the root-escape guard 4 lines below (resolvedTarget must equal resolvedRoot or start with resolvedRoot + path.sep, else it throws).
    const resolvedTarget = path.resolve(path.join(resolvedRoot, relativeTarget));

    // Safety check: Does the target resolve under the workspace root?
    const rootWithSep = resolvedRoot.endsWith(path.sep) ? resolvedRoot : resolvedRoot + path.sep;
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(rootWithSep)) {
      throw new Error("Path traversal security block: target path escapes workspace root.");
    }
    return resolvedTarget;
  }

  /**
   * Get virtual or actual filesystem tree
   */
  public static async getTree(isLive: boolean, workspaceRoot: string): Promise<{ tree: FileItem[]; workspaceRoot: string }> {
    if (!isLive) {
      // Build dummy list
      const tree: FileItem[] = [
        { name: "index.py", relativePath: "index.py", isDirectory: false, gitStatus: "none" },
        {
          name: "tests",
          relativePath: "tests",
          isDirectory: true,
          children: [
            { name: "test_basic.py", relativePath: "tests/test_basic.py", isDirectory: false, gitStatus: "modified" }
          ],
        },
        { name: "README.md", relativePath: "README.md", isDirectory: false, gitStatus: "none" },
        { name: "requirements.txt", relativePath: "requirements.txt", isDirectory: false, gitStatus: "untracked" },
      ];
      return { tree, workspaceRoot: "/demo/workspace" };
    }

    if (!workspaceRoot || !fs.existsSync(workspaceRoot)) {
      return { tree: [], workspaceRoot: workspaceRoot || "" };
    }

    // Read real tree recursively with exclusion filters
    const scanDir = (dirPath: string, relativeDir: string = ""): FileItem[] => {
      const items: FileItem[] = [];
      const files = fs.readdirSync(dirPath);

      for (const file of files) {
        if (["node_modules", ".git", "dist", "__pycache__", ".ephemeral-data"].includes(file)) {
          continue;
        }
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal — `file` is a real on-disk entry from fs.readdirSync(dirPath), not user input; recursion only descends into actual directories under the workspace root, so no attacker-controlled traversal.
        const fullPath = path.join(dirPath, file);
        const relativePath = relativeDir ? `${relativeDir}/${file}` : file;
        const stat = fs.statSync(fullPath);
        const isDirectory = stat.isDirectory();

        const item: FileItem = {
          name: file,
          relativePath,
          isDirectory,
          size: stat.size,
          gitStatus: "none",
        };

        if (isDirectory) {
          item.children = scanDir(fullPath, relativePath);
        }
        items.push(item);
      }
      
      // Sort: folders first, then alphabetical
      return items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
    };

    // Parse git status if enabled & local repo exists
    const tree = scanDir(workspaceRoot);
    if (db.data.permissions.git) {
      try {
        const { execSync } = require("child_process");
        const statusOutput = execSync("git status --porcelain", { cwd: workspaceRoot, encoding: "utf8" });
        const gitMap: Record<string, FileItem["gitStatus"]> = {};
        
        statusOutput.split("\n").forEach((line: string) => {
          if (line.length < 3) return;
          const flag = line.substring(0, 2).trim();
          const filePath = line.substring(3).replace(/\"/g, "").trim();
          
          let status: FileItem["gitStatus"] = "none";
          if (flag === "??" || flag === "A") status = "untracked";
          else if (flag === "M" || flag === "MM") status = "modified";
          else if (flag === "Staged") status = "staged";
          
          if (status !== "none") {
            gitMap[filePath] = status;
          }
        });

        // Overlay status mapping on the tree
        const overlayStatus = (list: FileItem[]) => {
          for (const item of list) {
            if (gitMap[item.relativePath]) {
              item.gitStatus = gitMap[item.relativePath];
            }
            if (item.children) {
              overlayStatus(item.children);
            }
          }
        };
        overlayStatus(tree);
      } catch (err) {
        // Soft fail if outside git or git not installed
      }
    }

    return { tree, workspaceRoot };
  }

  /**
   * Read file content
   */
  public static readFile(isLive: boolean, workspaceRoot: string, relativePath: string): string {
    if (!isLive) {
      if (VIRTUAL_FILES[relativePath] !== undefined) {
        return VIRTUAL_FILES[relativePath];
      }
      throw new Error("File not found in demo sandbox.");
    }

    if (!db.data.permissions.fileRead) {
      throw new Error("Local filesystem read permission is disabled.");
    }

    const safePath = this.resolveSafePath(workspaceRoot, relativePath);
    if (!fs.existsSync(safePath)) {
      throw new Error("Target file does not exist.");
    }
    return fs.readFileSync(safePath, "utf-8");
  }

  /**
   * Write file content
   */
  public static writeFile(isLive: boolean, workspaceRoot: string, relativePath: string, content: string): void {
    if (!isLive) {
      VIRTUAL_FILES[relativePath] = content;
      return;
    }

    if (!db.data.permissions.fileWrite) {
      throw new Error("Local filesystem write permission is disabled.");
    }

    const safePath = this.resolveSafePath(workspaceRoot, relativePath);
    const parentDir = path.dirname(safePath);
    
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    
    fs.writeFileSync(safePath, content, "utf-8");
  }

  /**
   * Read raw bytes (binary-safe). readFile() decodes utf-8 which corrupts binary
   * payloads (images, archives, executables) — download paths MUST use this.
   */
  public static readFileBuffer(isLive: boolean, workspaceRoot: string, relativePath: string): Buffer {
    if (!isLive) {
      const v = VIRTUAL_FILES[relativePath];
      if (v === undefined) throw new Error("File not found in demo sandbox.");
      return Buffer.from(v, "utf-8");
    }
    if (!db.data.permissions.fileRead) {
      throw new Error("Local filesystem read permission is disabled.");
    }
    const safePath = this.resolveSafePath(workspaceRoot, relativePath);
    if (!fs.existsSync(safePath)) {
      throw new Error("Target file does not exist.");
    }
    return fs.readFileSync(safePath);
  }

  /**
   * Write raw bytes (binary-safe). Creates parent dirs. Returns the resolved safe
   * path. Upload paths MUST use this so any file type round-trips uncorrupted.
   */
  public static writeFileBuffer(isLive: boolean, workspaceRoot: string, relativePath: string, data: Buffer): string {
    if (!isLive) {
      VIRTUAL_FILES[relativePath] = data.toString("utf-8");
      return relativePath;
    }
    if (!db.data.permissions.fileWrite) {
      throw new Error("Local filesystem write permission is disabled.");
    }
    const safePath = this.resolveSafePath(workspaceRoot, relativePath);
    const parentDir = path.dirname(safePath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(safePath, data);
    return safePath;
  }

  /**
   * Delete file/folder
   */
  public static deleteFile(isLive: boolean, workspaceRoot: string, relativePath: string): void {
    if (!isLive) {
      delete VIRTUAL_FILES[relativePath];
      return;
    }

    if (!db.data.permissions.fileWrite) {
      throw new Error("Local filesystem delete permission is disabled.");
    }

    const safePath = this.resolveSafePath(workspaceRoot, relativePath);
    if (!fs.existsSync(safePath)) {
      throw new Error("Target file does not exist.");
    }
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
      fs.rmSync(safePath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(safePath);
    }
  }

  /**
   * Generates a unified diff format representing changes between oldContent and newContent
   */
  public static generateUnifiedDiff(filePath: string, oldContent: string, newContent: string): string {
    const oldLines = oldContent.split(/\r?\n/);
    const newLines = newContent.split(/\r?\n/);
    const diff: string[] = [];
    diff.push(`--- a/${filePath}`);
    diff.push(`+++ b/${filePath}`);

    let i = 0;
    let j = 0;
    while (i < oldLines.length || j < newLines.length) {
      if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
        diff.push(`  ${oldLines[i]}`);
        i++;
        j++;
      } else if (i < oldLines.length && (j >= newLines.length || !newLines.slice(j).includes(oldLines[i]))) {
        diff.push(`- ${oldLines[i]}`);
        i++;
      } else if (j < newLines.length) {
        diff.push(`+ ${newLines[j]}`);
        j++;
      }
    }
    return diff.join("\n");
  }
}
