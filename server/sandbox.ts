// B4: sandboxed untrusted-JS execution on QuickJS-WASM (quickjs-emscripten,
// pure WebAssembly, MIT). Every call gets a brand-new runtime+context — no
// reuse — so one script can never see state left behind by a previous one.
// The sandbox exposes NO host bindings (no fetch/process/require/globalThis
// leakage): QuickJS's global object starts empty of Node/browser APIs, and we
// add nothing beyond the optional JSON-injected `INPUT`. A wall-clock
// interrupt handler enforces the timeout and runtime.setMemoryLimit enforces
// the memory cap; both are checked by the QuickJS interpreter itself, so a
// tight `while(true){}` or an allocation bomb is killed from the outside.
import { getQuickJS, shouldInterruptAfterDeadline, isFail, type QuickJSHandle } from "quickjs-emscripten";

export interface EvalOptions {
  /** Wall-clock timeout in ms. Default 2000. */
  timeoutMs?: number;
  /** Memory cap in MB for the whole runtime. Default 32. */
  memoryLimitMb?: number;
  /** JSON-serializable value injected as the global `INPUT`. */
  input?: unknown;
}

export interface EvalResult {
  ok: boolean;
  value?: unknown;
  error?: string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_MEMORY_LIMIT_MB = 32;

export async function evalUntrusted(code: string, opts: EvalOptions = {}): Promise<EvalResult> {
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
  const memoryLimitMb = opts.memoryLimitMb && opts.memoryLimitMb > 0 ? opts.memoryLimitMb : DEFAULT_MEMORY_LIMIT_MB;
  const started = Date.now();

  const QuickJS = await getQuickJS();
  // Fresh runtime per call (never reused across invocations).
  const runtime = QuickJS.newRuntime();
  let context: ReturnType<typeof runtime.newContext> | undefined;
  try {
    runtime.setMemoryLimit(memoryLimitMb * 1024 * 1024);
    // Interrupt handler is polled by the interpreter during evaluation — this
    // is what actually kills a `while(true){}` from the outside.
    runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + timeoutMs));

    context = runtime.newContext(); // no intrinsics beyond QuickJS defaults — no host bindings

    if (opts.input !== undefined) {
      let inputHandle: QuickJSHandle | undefined;
      try {
        const json = JSON.stringify(opts.input);
        const parsed = context.unwrapResult(context.evalCode(`(${json})`));
        inputHandle = parsed;
        context.setProp(context.global, "INPUT", inputHandle);
      } finally {
        inputHandle?.dispose();
      }
    }

    const evalResult = context.evalCode(code);
    if (!isFail(evalResult)) {
      const handle = evalResult.value;
      try {
        const value = context.dump(handle);
        return { ok: true, value, durationMs: Date.now() - started };
      } finally {
        handle.dispose();
      }
    } else {
      const errHandle = evalResult.error;
      try {
        const dumped = context.dump(errHandle);
        const message =
          dumped && typeof dumped === "object" && "message" in dumped
            ? `${(dumped as any).name ?? "Error"}: ${(dumped as any).message}`
            : String(dumped);
        return { ok: false, error: message, durationMs: Date.now() - started };
      } finally {
        errHandle.dispose();
      }
    }
  } catch (err: any) {
    return { ok: false, error: err?.message ? String(err.message) : String(err), durationMs: Date.now() - started };
  } finally {
    // Dispose everything, even on throw — a leaked WASM context/runtime is a
    // real memory leak (it's not GC'd by V8, it's emscripten heap memory).
    try {
      context?.dispose();
    } catch {
      /* already disposed / never created */
    }
    try {
      runtime.dispose();
    } catch {
      /* already disposed */
    }
  }
}
