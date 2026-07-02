import type { App, DataAdapter, TFile } from "obsidian";
import type { Query } from "../query/types";
import type { EditOp } from "../edit/operations";

export interface BackupFileEntry {
  path: string;
  backupPath: string;
  hashBefore: string;
  hashAfter: string;
}

export interface RunManifest {
  runId: string;
  timestamp: number;
  querySnapshot: Query | null;
  operations: EditOp[];
  files: BackupFileEntry[];
}

/** Lehký záznam v historii (data.json); plný manifest žije ve složce běhu. */
export interface RunRecord {
  runId: string;
  timestamp: number;
  root: string; // kořen záloh, kde běh leží
  fileCount: number;
  opCount: number;
  undone?: boolean;
}

export interface UndoChoice {
  path: string;
  drifted: boolean; // soubor byl mezitím ručně změněn
}

export interface UndoPlan {
  runId: string;
  entries: UndoChoice[];
}

export interface UndoResult {
  restored: number;
  skipped: number;
  errors: string[];
}

/** Rychlý synchronní hash (FNV-1a, 32-bit) — bez závislostí, stačí na drift. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function isoRunId(ts: number): string {
  const iso = new Date(ts).toISOString().replace(/[:.]/g, "-").replace("Z", "");
  const rand = Math.random().toString(16).slice(2, 8);
  return `${iso}_${rand}`;
}

export class BackupManager {
  private adapter: DataAdapter;

  constructor(
    private app: App,
    private pluginDir: string,
    private getOpts: () => { backupFolder: string; retention: number },
    private history: RunRecord[],
    private persist: () => Promise<void>
  ) {
    this.adapter = app.vault.adapter;
  }

  /** Kořen pro zálohy — buď nastavená složka, nebo složka pluginu. */
  backupRoot(): string {
    const folder = this.getOpts().backupFolder.trim().replace(/\/+$/, "");
    return folder !== "" ? folder : `${this.pluginDir}/backups`;
  }

  getHistory(): RunRecord[] {
    return this.history;
  }

  private async ensureDir(path: string): Promise<void> {
    const parts = path.split("/").filter((p) => p !== "");
    let cur = "";
    for (const part of parts) {
      cur = cur === "" ? part : `${cur}/${part}`;
      if (!(await this.adapter.exists(cur))) {
        await this.adapter.mkdir(cur);
      }
    }
  }

  /**
   * Vytvoří běh: zazálohuje obsah všech souborů, zapíše iniciální manifest.
   * Vrací runId a mapu path→hashBefore (pro pozdější hashAfter).
   */
  async createRun(
    files: TFile[],
    query: Query | null,
    operations: EditOp[]
  ): Promise<{ runId: string; manifest: RunManifest }> {
    const ts = Date.now();
    const runId = isoRunId(ts);
    const root = this.backupRoot();
    const runDir = `${root}/${runId}`;
    const filesDir = `${runDir}/files`;

    const entries: BackupFileEntry[] = [];
    for (const file of files) {
      const content = await this.app.vault.read(file);
      const backupPath = `${filesDir}/${file.path}`;
      await this.ensureDir(backupPath.slice(0, backupPath.lastIndexOf("/")));
      await this.adapter.write(backupPath, content);
      entries.push({
        path: file.path,
        backupPath,
        hashBefore: hashString(content),
        hashAfter: "",
      });
    }

    const manifest: RunManifest = {
      runId,
      timestamp: ts,
      querySnapshot: query,
      operations,
      files: entries,
    };
    await this.writeManifest(runDir, manifest);
    return { runId, manifest };
  }

  private manifestPath(runDir: string): string {
    return `${runDir}/manifest.json`;
  }

  private async writeManifest(runDir: string, m: RunManifest): Promise<void> {
    await this.ensureDir(runDir);
    await this.adapter.write(
      this.manifestPath(runDir),
      JSON.stringify(m, null, 2)
    );
  }

  /** Dopočítá hashAfter, uloží manifest, zapíše do historie + retence. */
  async finalizeRun(
    manifest: RunManifest,
    afterHashes: Map<string, string>
  ): Promise<void> {
    for (const entry of manifest.files) {
      entry.hashAfter = afterHashes.get(entry.path) ?? entry.hashBefore;
    }
    const root = this.backupRoot();
    const runDir = `${root}/${manifest.runId}`;
    await this.writeManifest(runDir, manifest);

    this.history.unshift({
      runId: manifest.runId,
      timestamp: manifest.timestamp,
      root,
      fileCount: manifest.files.length,
      opCount: manifest.operations.length,
    });
    await this.persist();
    await this.pruneRetention();
  }

  async readManifest(record: RunRecord): Promise<RunManifest | null> {
    const path = this.manifestPath(`${record.root}/${record.runId}`);
    try {
      if (!(await this.adapter.exists(path))) return null;
      return JSON.parse(await this.adapter.read(path)) as RunManifest;
    } catch {
      return null;
    }
  }

  /** Zjistí, které soubory driftovaly (od aplikace byly ručně změněny). */
  async planUndo(record: RunRecord): Promise<UndoPlan | null> {
    const manifest = await this.readManifest(record);
    if (!manifest) return null;
    const entries: UndoChoice[] = [];
    for (const entry of manifest.files) {
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      let drifted = false;
      if (file && "stat" in file) {
        try {
          const current = await this.app.vault.read(file as TFile);
          drifted = hashString(current) !== entry.hashAfter;
        } catch {
          drifted = true;
        }
      } else {
        // soubor neexistuje (přesunut/smazán) → považuj za drift
        drifted = true;
      }
      entries.push({ path: entry.path, drifted });
    }
    return { runId: record.runId, entries };
  }

  /**
   * Provede undo. `overwriteDrifted` = přepsat i soubory, které driftovaly.
   * Bez něj se driftované soubory přeskočí.
   */
  async undoRun(
    record: RunRecord,
    overwriteDrifted: boolean
  ): Promise<UndoResult> {
    const manifest = await this.readManifest(record);
    const result: UndoResult = { restored: 0, skipped: 0, errors: [] };
    if (!manifest) {
      result.errors.push("Manifest běhu nenalezen.");
      return result;
    }

    for (const entry of manifest.files) {
      try {
        if (!(await this.adapter.exists(entry.backupPath))) {
          result.errors.push(`Chybí záloha: ${entry.path}`);
          result.skipped++;
          continue;
        }
        const backup = await this.adapter.read(entry.backupPath);
        const file = this.app.vault.getAbstractFileByPath(entry.path);

        if (file && "stat" in file) {
          const current = await this.app.vault.read(file as TFile);
          const drifted = hashString(current) !== entry.hashAfter;
          if (drifted && !overwriteDrifted) {
            result.skipped++;
            continue;
          }
          await this.app.vault.modify(file as TFile, backup);
        } else {
          // soubor zmizel — obnov ho na původní cestu
          await this.ensureVaultDir(entry.path);
          await this.app.vault.create(entry.path, backup);
        }
        result.restored++;
      } catch (e) {
        result.errors.push(
          `${entry.path}: ${e instanceof Error ? e.message : String(e)}`
        );
        result.skipped++;
      }
    }

    const rec = this.history.find((r) => r.runId === record.runId);
    if (rec) rec.undone = true;
    await this.persist();
    return result;
  }

  private async ensureVaultDir(filePath: string): Promise<void> {
    const dir = filePath.slice(0, filePath.lastIndexOf("/"));
    if (dir && !(await this.adapter.exists(dir))) {
      await this.ensureDir(dir);
    }
  }

  /** Smaže běh (složku i záznam v historii). */
  async deleteRun(record: RunRecord): Promise<void> {
    const runDir = `${record.root}/${record.runId}`;
    await this.removeDir(runDir);
    const idx = this.history.findIndex((r) => r.runId === record.runId);
    if (idx >= 0) this.history.splice(idx, 1);
    await this.persist();
  }

  private async removeDir(path: string): Promise<void> {
    try {
      if (!(await this.adapter.exists(path))) return;
      const anyAdapter = this.adapter as unknown as {
        rmdir?: (p: string, r: boolean) => Promise<void>;
      };
      if (typeof anyAdapter.rmdir === "function") {
        await anyAdapter.rmdir(path, true);
        return;
      }
      // fallback: rekurzivní list + remove
      const listing = await this.adapter.list(path);
      for (const f of listing.files) await this.adapter.remove(f);
      for (const d of listing.folders) await this.removeDir(d);
    } catch {
      /* best-effort */
    }
  }

  /** Ořízne nejstarší běhy nad limit retence. */
  async pruneRetention(): Promise<void> {
    const { retention } = this.getOpts();
    if (retention <= 0) return;
    const sorted = [...this.history].sort((a, b) => b.timestamp - a.timestamp);
    const excess = sorted.slice(retention);
    for (const rec of excess) {
      await this.deleteRun(rec);
    }
  }
}
