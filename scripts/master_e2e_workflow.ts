import { OrchestratorCoordinator } from '../server/orchestrator';

/**
 * Genesis Cluster Mesh: Master E2E Workflow
 * This script demonstrates the full operational cycle of the system:
 * 1. Health Initialization (via Python)
 * 2. Automated Task Submission
 * 3. Execution with Self-Healing
 */
class MasterWorkflow {
    public static async run() {
        console.log("[MASTER E2E] Starting Genesis Workflow...");

        // Phase 1: Health Diagnostic
        console.log("[PHASE 1] Diagnostic...");
        const healthJobId = await OrchestratorCoordinator.submitJob('desktop_commander', { 
            command: 'python3', 
            args: ['system_health.py'] 
        });
        
        // Polling loop
        await this.waitForJob(healthJobId);

        // Phase 2: Orchestration (Example Task)
        console.log("[PHASE 2] Initiating Orchestration...");
        const taskJobId = await OrchestratorCoordinator.submitJob('browser_search', { 
            query: 'Genesis Workflow Best Practices' 
        });
        
        await this.waitForJob(taskJobId);

        console.log("[MASTER E2E] Workflow Completed Successfully.");
    }

    private static async waitForJob(jobId: string, retries = 5) {
        for (let i = 0; i < retries; i++) {
            const status = OrchestratorCoordinator.getJobStatus(jobId);
            if (status?.status === 'completed') {
                console.log(`[JOB ${jobId}] Finished:`, status.result);
                return;
            } else if (status?.status === 'failed') {
                throw new Error(`[JOB ${jobId}] Failed: ${status.result}`);
            }
            console.log(`[JOB ${jobId}] Polling...`);
            await new Promise(r => setTimeout(r, 2000));
        }
        throw new Error(`[JOB ${jobId}] Timed out`);
    }
}

MasterWorkflow.run().catch(console.error);
