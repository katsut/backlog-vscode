import * as vscode from 'vscode';

export class PollingService implements vscode.Disposable {
  private timers = new Map<string, ReturnType<typeof setInterval>>();

  register(name: string, callback: () => void | Promise<void>, intervalMs: number): void {
    this.stop(name);

    const run = async () => {
      try {
        await callback();
      } catch (error) {
        console.error(`[Polling] ${name} failed:`, error);
      }
    };

    // Run shortly after registration (allow SecretStorage to be ready)
    setTimeout(run, 500);

    const timer = setInterval(run, intervalMs);
    this.timers.set(name, timer);
  }

  stop(name: string): void {
    const existing = this.timers.get(name);
    if (existing) {
      clearInterval(existing);
      this.timers.delete(name);
    }
  }

  dispose(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }
    this.timers.clear();
  }
}
