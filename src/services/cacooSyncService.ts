import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { CacooSyncManifest } from '../types/cacoo';

export class CacooSyncService {
  private static readonly MANIFEST_FILENAME = '.cacoo-sync-manifest.json';

  // ---- Manifest I/O ----

  loadManifest(localDir: string): CacooSyncManifest {
    const manifestPath = path.join(localDir, CacooSyncService.MANIFEST_FILENAME);
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as CacooSyncManifest;
    } catch {
      return {};
    }
  }

  saveManifest(localDir: string, manifest: CacooSyncManifest): void {
    const manifestPath = path.join(localDir, CacooSyncService.MANIFEST_FILENAME);
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  // ---- Hashing ----

  computeImageHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  computeFileHash(filePath: string): string {
    const buffer = fs.readFileSync(filePath);
    return this.computeImageHash(buffer);
  }

  // ---- File Naming ----

  sanitizeFileName(name: string): string {
    let sanitized = name
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .trim();

    if (sanitized.length > 200) {
      sanitized = sanitized.substring(0, 200);
    }

    return sanitized || 'untitled';
  }

  resolveSheetPath(baseDir: string, diagramTitle: string, sheetName: string): string {
    const sanitizedDiagram = this.sanitizeFileName(diagramTitle);
    const sanitizedSheet = this.sanitizeFileName(sheetName);
    return path.join(baseDir, sanitizedDiagram, sanitizedSheet + '.png');
  }
}
