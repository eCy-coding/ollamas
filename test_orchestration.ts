import { OrchestratorCoordinator } from './server/orchestrator';

async function verify() {
    console.log("[TEST] Starting Master Orchestrator Verification...");
    
    // Test 1: API Tool (Claude)
    const res1 = await OrchestratorCoordinator.executeTool('claude', { prompt: 'hello' });
    console.log("[TEST] API Tool Claude Result:", res1);

    // Test 2: Browser Tool
    const res2 = await OrchestratorCoordinator.executeTool('browser_search', { query: 'TypeScript MCP' });
    console.log("[TEST] Browser Tool Result:", res2);

    console.log("[TEST] Verification Complete.");
}

verify();
