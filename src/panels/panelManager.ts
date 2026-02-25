import * as vscode from 'vscode';

/**
 * Manages WebviewPanel lifecycle with automatic disposal tracking.
 * Replaces raw Map<string, WebviewPanel> instances scattered in extension.ts.
 */
export class PanelManager implements vscode.Disposable {
  private panels = new Map<string, vscode.WebviewPanel>();

  get(key: string): vscode.WebviewPanel | undefined {
    return this.panels.get(key);
  }

  has(key: string): boolean {
    return this.panels.has(key);
  }

  set(key: string, panel: vscode.WebviewPanel): void {
    this.panels.set(key, panel);
    panel.onDidDispose(() => this.panels.delete(key));
  }

  /**
   * Reveal an existing panel or create a new one via the factory.
   * Returns the panel and whether it was newly created.
   */
  revealOrCreate(
    key: string,
    factory: () => vscode.WebviewPanel
  ): { panel: vscode.WebviewPanel; isNew: boolean } {
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal(vscode.ViewColumn.One);
      return { panel: existing, isNew: false };
    }
    const panel = factory();
    this.set(key, panel);
    return { panel, isNew: true };
  }

  dispose(): void {
    for (const panel of this.panels.values()) {
      panel.dispose();
    }
    this.panels.clear();
  }
}
