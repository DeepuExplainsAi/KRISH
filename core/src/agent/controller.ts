/** STOP and Take over / Resume for a running agent. */
export class AgentController {
  private abort = new AbortController();
  private paused = false;
  private waiters: (() => void)[] = [];

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  stop(): void {
    this.abort.abort();
    this.release();
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.release();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Resolves when the agent may continue (not paused, or stopped). */
  async whenRunning(): Promise<void> {
    while (this.paused && !this.abort.signal.aborted) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  private release() {
    for (const w of this.waiters.splice(0)) w();
  }
}

export class StoppedError extends Error {
  constructor() {
    super("stopped by user");
  }
}

/** Makes any pending UI promise give way to STOP. */
export function raceStop<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new StoppedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new StoppedError());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}
