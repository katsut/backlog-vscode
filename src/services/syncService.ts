import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { SyncManifest, SyncManifestEntry, SyncStatus, SyncStatusEntry } from '../types/backlog';

export class SyncService {
  private static readonly MANIFEST_FILENAME = '.sync-manifest.json';
  private static readonly FRONTMATTER_REGEX = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

  // ---- Manifest I/O ----

  loadManifest(localDir: string): SyncManifest {
    const manifestPath = path.join(localDir, SyncService.MANIFEST_FILENAME);
    try {
      const content = fs.readFileSync(manifestPath, 'utf-8');
      return JSON.parse(content) as SyncManifest;
    } catch {
      return {};
    }
  }

  saveManifest(localDir: string, manifest: SyncManifest): void {
    const manifestPath = path.join(localDir, SyncService.MANIFEST_FILENAME);
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
  }

  // ---- Content Hashing ----

  computeHash(content: string): string {
    return createHash('sha256').update(content, 'utf-8').digest('hex');
  }

  readLocalContent(filePath: string): string {
    const text = fs.readFileSync(filePath, 'utf-8');
    return this.stripFrontmatter(text);
  }

  computeLocalFileHash(filePath: string): string {
    const content = this.readLocalContent(filePath);
    return this.computeHash(content);
  }

  // ---- Frontmatter ----

  buildFrontmatter(params: {
    title: string;
    backlog_id: string;
    project: string;
    synced_at: string;
    updated_at: string;
  }): string {
    return [
      '---',
      `title: "${params.title.replace(/"/g, '\\"')}"`,
      `backlog_id: "${params.backlog_id}"`,
      `project: "${params.project}"`,
      `synced_at: "${params.synced_at}"`,
      `updated_at: "${params.updated_at}"`,
      '---',
      '',
    ].join('\n');
  }

  parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
    const match = text.match(SyncService.FRONTMATTER_REGEX);
    if (!match) {
      return { meta: {}, body: text };
    }

    const meta: Record<string, string> = {};
    match[1].split('\n').forEach((line) => {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.substring(0, colonIdx).trim();
        let value = line.substring(colonIdx + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        meta[key] = value;
      }
    });

    return { meta, body: match[2] };
  }

  stripFrontmatter(text: string): string {
    return this.parseFrontmatter(text).body;
  }

  // ---- File Naming ----

  sanitizeFileName(title: string): string {
    let name = title
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/-{2,}/g, '-')
      .replace(/^-+|-+$/g, '')
      .trim();

    if (name.length > 200) {
      name = name.substring(0, 200);
    }

    return name || 'untitled';
  }

  resolveLocalPath(
    baseDir: string,
    treePath: string[],
    title: string,
    hasChildren: boolean
  ): string {
    const sanitizedSegments = treePath.map((s) => this.sanitizeFileName(s));
    const sanitizedTitle = this.sanitizeFileName(title);

    if (hasChildren) {
      return path.join(baseDir, ...sanitizedSegments, sanitizedTitle, 'index.bdoc');
    }
    return path.join(baseDir, ...sanitizedSegments, sanitizedTitle + '.bdoc');
  }

  // ---- Status Comparison ----

  getFileStatus(
    localDir: string,
    relativePath: string,
    manifest: SyncManifest,
    remoteUpdatedAt?: string
  ): SyncStatus {
    const absolutePath = path.join(localDir, relativePath);
    const entry = manifest[relativePath];

    if (!entry) {
      // ファイルが manifest に無い
      if (fs.existsSync(absolutePath)) {
        return 'new_local';
      }
      return 'not_synced';
    }

    const fileExists = fs.existsSync(absolutePath);
    if (!fileExists) {
      // manifest にあるがファイルが削除されている
      return 'not_synced';
    }

    const localHash = this.computeLocalFileHash(absolutePath);
    const localChanged = localHash !== entry.content_hash;
    const remoteChanged = remoteUpdatedAt ? remoteUpdatedAt !== entry.remote_updated_at : false;

    if (!localChanged && !remoteChanged) {
      return 'unchanged';
    }
    if (!localChanged && remoteChanged) {
      return 'remote_modified';
    }
    if (localChanged && !remoteChanged) {
      return 'local_modified';
    }
    return 'conflict';
  }

  getAllStatuses(
    localDir: string,
    manifest: SyncManifest,
    remoteUpdates?: Map<string, string>
  ): SyncStatusEntry[] {
    const entries: SyncStatusEntry[] = [];

    // manifest にあるファイル
    for (const [relativePath, entry] of Object.entries(manifest)) {
      const remoteUpdatedAt = remoteUpdates?.get(entry.backlog_id);
      const status = this.getFileStatus(localDir, relativePath, manifest, remoteUpdatedAt);
      entries.push({
        relativePath,
        status,
        manifestEntry: entry,
        remoteUpdatedAt,
      });
    }

    // manifest にないローカル .md ファイルを検出
    this.findLocalMdFiles(localDir, localDir).forEach((relativePath) => {
      if (!manifest[relativePath]) {
        entries.push({
          relativePath,
          status: 'new_local',
        });
      }
    });

    return entries;
  }

  private findLocalMdFiles(baseDir: string, currentDir: string): string[] {
    const results: string[] = [];
    if (!fs.existsSync(currentDir)) {
      return results;
    }

    const items = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const item of items) {
      if (item.name.startsWith('.')) {
        continue;
      }
      const fullPath = path.join(currentDir, item.name);
      if (item.isDirectory()) {
        results.push(...this.findLocalMdFiles(baseDir, fullPath));
      } else if (item.name.endsWith('.bdoc')) {
        results.push(path.relative(baseDir, fullPath));
      }
    }
    return results;
  }
}
