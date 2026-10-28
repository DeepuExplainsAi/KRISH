/** STOP for a running agent. */
export class AgentController {
  private abort = new AbortController();

  get signal(): AbortSignal {
    return this.abort.signal;
  }

  stop(): void {
    this.abort.abort();
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
