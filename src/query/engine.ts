import type { App, TFile } from "obsidian";
import { getAllTags } from "obsidian";
import type { Query } from "./types";
import type { EvalContext } from "./operators";
import { evalGroup } from "./evaluate";

export { andTri, orTri, notTri, evalGroup, queryTouchesBody } from "./evaluate";

// ---------- building the metadata context (phase 1) ----------

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
    body: null, // phase 1: body not read yet
  };
}

export interface SearchResult {
  /** Final set of files matching the query. */
  files: TFile[];
  /** How many files required reading the body (phase 2). */
  bodyReads: number;
}

/**
 * Two-phase search.
 * Phase 1: evaluate the tree over metadata. false → drop, true/unknown → candidate.
 * Phase 2: for `unknown` candidates, read the body and re-evaluate.
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

  // stable sort by path
  matched.sort((a, b) => a.path.localeCompare(b.path));
  return { files: matched, bodyReads };
}

/**
 * Fast estimate for the live count — phase 1 only.
 * Returns the number of certain matches and body-dependent candidates.
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

/** Returns the body without the frontmatter block (for content rules). */
export function stripFrontmatter(app: App, file: TFile, content: string): string {
  const cache = app.metadataCache.getFileCache(file);
  const end = cache?.frontmatterPosition?.end.offset;
  if (typeof end === "number" && end > 0 && end <= content.length) {
    return content.slice(end).replace(/^\n/, "");
  }
  return content;
}
