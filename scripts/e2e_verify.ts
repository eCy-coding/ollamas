import { OrchestratorCoordinator } from '../server/orchestrator';

async function runE2E() {
    console.log("[E2E] Starting Verification...");
    
    // Test 1: Browser Tool
    console.log("[E2E] Testing Browser Search...");
    const browserRes = await OrchestratorCoordinator.executeTool('browser_search', { query: 'TypeScript' });
    if (!browserRes.success) throw new Error("Browser Tool Failed");
    console.log("[E2E] Browser Success");

    // Test 2: Input Bridge
    console.log("[E2E] Testing Input Bridge...");
    const inputRes = await OrchestratorCoordinator.executeTool('input_bridge', { type: 'keyboard', key: 'Escape' });
    if (!inputRes.success) throw new Error("Input Bridge Failed");
    console.log("[E2E] Input Bridge Success");

    console.log("[E2E] All Tests Passed.");
}

runE2E().catch(console.error);
