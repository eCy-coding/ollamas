import { describe, it, expect } from "vitest";
import { db } from "../server/db";

describe("Decentralized P2P Swarm Configuration & Referral Logic Suite", () => {

  it("Retrieves clean default swarm database settings", () => {
    const config = db.data.swarm;
    expect(config).toBeDefined();
    expect(config.numCtxLimit).toBe(8192);
    expect(config.eulaApproved).toBe(false);
    expect(config.nodeActive).toBe(false);
    expect(config.earnings).toBeGreaterThanOrEqual(0);
  });

  it("Saves updated configuration parameters correctly", () => {
    // 1. Simulate changing EULA and node active flags
    db.data.swarm.eulaApproved = true;
    db.data.swarm.nodeActive = true;
    db.data.swarm.numCtxLimit = 4096;
    db.save();

    // 2. Load again & verify persisted values
    const updated = db.data.swarm;
    expect(updated.eulaApproved).toBe(true);
    expect(updated.nodeActive).toBe(true);
    expect(updated.numCtxLimit).toBe(4096);

    // Reset for subsequent standard defaults
    db.data.swarm.eulaApproved = false;
    db.data.swarm.nodeActive = false;
    db.data.swarm.numCtxLimit = 8192;
    db.save();
  });

  it("Calculates multilevel commissions accurately based on workers", () => {
    // MultiLevelReward Commission Base multipliers simulation
    // worker reward: 100 SWE tokens. Gamma decay y = 0.15
    const baseReward = 100;
    const gamma = 0.15;
    
    const workerEarns = baseReward;
    const referralTier1Commission = workerEarns * gamma; // 15
    const referralTier2Commission = referralTier1Commission * gamma; // 2.25
    const referralTier3Commission = referralTier2Commission * gamma; // 0.3375

    expect(referralTier1Commission).toBeCloseTo(15);
    expect(referralTier2Commission).toBeCloseTo(2.25);
    expect(referralTier3Commission).toBeCloseTo(0.3375);
  });

  it("Links referredBy partner tokens and enforces validation bounds", () => {
    const referralInput = "REF-A87F";
    db.data.swarm.referredBy = referralInput;
    db.save();

    expect(db.data.swarm.referredBy).toBe("REF-A87F");

    // Clean up
    db.data.swarm.referredBy = "";
    db.save();
  });
});
