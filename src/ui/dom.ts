let counter = 0;

/** Short unique id for query / operation nodes. */
export function uid(prefix = "n"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Formats a note count in English. */
export function noteCount(n: number): string {
  return n === 1 ? "1 note" : `${n} notes`;
}
