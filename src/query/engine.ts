import type { App, TFile } from "obsidian";
import { getAllTags } from "obsidian";
import type { Query } from "./types";
import type { EvalContext } from "./operators";
import { evalGroup } from "./evaluate";

export { andTri, orTri, notTri, evalGroup, queryTouchesBody } from "./evaluate";

// ---------- sestavení kontextu z metadat (fáze 1) ----------

function buildMetaContext(app: App, file: TFile): EvalContext {
  const cache = app.metadataCache.getFileCache(file);
  const rawTags = cache ? getAllTags(cache) ?? [] : [];
  const tags = rawTags.map((t) => t.replace(/^#/, "").toLowerCase());
  return {
    name: file.basename,
    path: file.path,
    ctime: file.stat.ctime,
    mtime: file.stat.mtime,
    tags,
    frontmatter: cache?.frontmatter,
    body: null, // fáze 1: tělo nenačteno
  };
}

export interface SearchResult {
  /** Finální množina souborů, které dotazu vyhovují. */
  files: TFile[];
  /** Kolik souborů si vyžádalo čtení těla (fáze 2). */
  bodyReads: number;
}

/**
 * Dvoufázové vyhledávání.
 * Fáze 1: vyhodnoť strom nad metadaty. false → zahoď, true/unknown → kandidát.
 * Fáze 2: pro `unknown` kandidáty načti tělo a přehodnoť.
 */
export async function search(
  app: App,
  query: Query,
  opts: { signal?: AbortSignal } = {}
): Promise<SearchResult> {
  const files = app.vault.getMarkdownFiles();
  const matched: TFile[] = [];
  const needsBody: Array<{ file: TFile; ctx: EvalContext }> = [];

  for (const file of files) {
    const ctx = buildMetaContext(app, file);
    const r = evalGroup(query, ctx);
    if (r === true) matched.push(file);
    else if (r === "unknown") needsBody.push({ file, ctx });
  }

  let bodyReads = 0;
  for (const { file, ctx } of needsBody) {
    if (opts.signal?.aborted) break;
    const body = await app.vault.cachedRead(file);
    bodyReads++;
    ctx.body = stripFrontmatter(app, file, body);
    if (evalGroup(query, ctx) === true) matched.push(file);
  }

  // stabilní řazení dle cesty
  matched.sort((a, b) => a.path.localeCompare(b.path));
  return { files: matched, bodyReads };
}

/**
 * Rychlý odhad pro živé počítadlo — jen fáze 1.
 * Vrací počet jistých shod a počet kandidátů závislých na těle.
 */
export function estimatePhase1(
  app: App,
  query: Query
): { certain: number; maybe: number } {
  const files = app.vault.getMarkdownFiles();
  let certain = 0;
  let maybe = 0;
  for (const file of files) {
    const ctx = buildMetaContext(app, file);
    const r = evalGroup(query, ctx);
    if (r === true) certain++;
    else if (r === "unknown") maybe++;
  }
  return { certain, maybe };
}

/** Vrátí tělo bez frontmatter bloku (pro obsahová pravidla). */
export function stripFrontmatter(app: App, file: TFile, content: string): string {
  const cache = app.metadataCache.getFileCache(file);
  const end = cache?.frontmatterPosition?.end.offset;
  if (typeof end === "number" && end > 0 && end <= content.length) {
    return content.slice(end).replace(/^\n/, "");
  }
  return content;
}
