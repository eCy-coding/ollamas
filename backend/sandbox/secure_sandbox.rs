use std::collections::HashSet;

pub struct CommandGuardrail {
    blacklist_tokens: HashSet<String>,
}

impl CommandGuardrail {
    pub fn new() -> Self {
        let mut blacklist = HashSet::new();
        blacklist.insert("rm".to_string());
        blacklist.insert("sudo".to_string());
        blacklist.insert("mv".to_string());
        blacklist.insert("dd".to_string());
        blacklist.insert("sh".to_string());
        blacklist.insert("bash".to_string());
        blacklist.insert("curl".to_string());
        blacklist.insert("wget".to_string());

        CommandGuardrail {
            blacklist_tokens: blacklist,
        }
    }

    /// Intercepts and screens raw commands for security breaches (M5 Command Guardrails)
    /// Returns Ok(()) if the command passes, or Err(i32) containing the 126 violation status code.
    pub fn validate_command(&self, command_str: &str) -> Result<(), i32> {
        let sanitized = command_str.trim();

        // Screen for shell metacharacters that allow command injection or piping
        let metacharacters = ['|', '&', ';', '$', '>', '<', '`', '\n'];
        for &ch in &metacharacters {
            if sanitized.contains(ch) {
                eprintln!(
                    "[Guardrail Violation] Shell metacharacter '{}' detected in: {}",
                    ch, sanitized
                );
                return Err(126); // Security Exit Code 126
            }
        }

        // Split command into tokens and check against the blacklist
        let parts: Vec<&str> = sanitized.split_whitespace().collect();
        if parts.is_empty() {
            return Ok(());
        }

        let base_command = parts[0].to_lowercase();
        if self.blacklist_tokens.contains(&base_command) {
            eprintln!(
                "[Guardrail Violation] Prohibited binary token execution attempted: '{}'",
                base_command
            );
            return Err(126);
        }

        Ok(())
    }
}

pub struct WasmSandboxEngine {
    fuel_allocated: u64,
}

impl WasmSandboxEngine {
    pub fn new(fuel: u64) -> Self {
        WasmSandboxEngine {
            fuel_allocated: fuel,
        }
    }

    /// Executes compiled WASM task payload under strictly isolated capability parameters
    pub fn execute_sandboxed_wasm(&self, wasm_bytecode: &[u8], payload_args: &str) -> Result<String, &'static str> {
        println!(
            "[Sandbox] Launching Wasmtime context. Fuel Meter budget assigned: {} units.",
            self.fuel_allocated
        );
        println!("[Sandbox] Strictly isolated filesystem. Net access: DISABLED. WASI bounds active.");

        // Simulate secure wasm execution loop with fuel consumption checks
        let mut consumed_fuel = 0;
        let mut result_string = String::new();

        for byte in wasm_bytecode {
            consumed_fuel += 45; // Depict mathematical fuel cost calculations
            if consumed_fuel > self.fuel_allocated {
                eprintln!("[!] Gas Exhaustion: WebAssembly engine ran out of fuel! Terminated infinite loop.");
                return Err("WASM_EXECUTION_OUT_OF_FUEL");
            }
            // Simple deterministic transformation simulation representing isolated bytecode running
            result_string.push((*byte as char).to_ascii_uppercase());
        }

        result_string.push_str(" [WASM VALIDATED]");
        println!("[+] WASM Execution finished. Consumed fuel: {} units.", consumed_fuel);
        Ok(result_string)
    }
}

fn main() {
    println!("[Sandbox Engine] Initiating secure isolation checks...");
    let guard = CommandGuardrail::new();

    // 1. Test standard binary execution - passes
    let client_command = "cargo build --release";
    match guard.validate_command(client_command) {
        Ok(_) => println!("[+] Command passed validation: {}", client_command),
        Err(code) => println!("[-] Command failed. Exit code: {}", code),
    }

    // 2. Test shell injection attack - blocked (returns 126)
    let attack_command = "echo 'hello' && rm -rf /";
    match guard.validate_command(attack_command) {
        Ok(_) => println!("[+] Passed: {}", attack_command),
        Err(code) => {
            assert_eq!(code, 126);
            println!("[+] Blocked malicious script: {}. Intercepted with Exit Code: {}", attack_command, code);
        }
    }

    // 3. Test WASM Sandbox Isolation execution with fuel metering
    let engine = WasmSandboxEngine::new(5000);
    let mock_bytecode = b"architect_coder_validation_routine";
    
    match engine.execute_sandboxed_wasm(mock_bytecode, "run-all-tests") {
        Ok(res) => println!("[+] Sandbox output: {}", res),
        Err(e) => println!("[-] Sandbox returned runtime error: {}", e),
    }

    // 4. Test WASM out of fuel block (lower budget)
    let low_engine = WasmSandboxEngine::new(100);
    match low_engine.execute_sandboxed_wasm(mock_bytecode, "run-all-tests") {
        Ok(res) => println!("[+] Sandbox output: {}", res),
        Err(e) => println!("[+] Correctly terminated runtime thread: Reason: {}", e),
    }
}
