let counter = 0;

/** Krátké unikátní id pro uzly dotazu / operace. */
export function uid(prefix = "n"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

/** Formátuje počet poznámek s českým skloňováním. */
export function noteCount(n: number): string {
  if (n === 1) return "1 poznámka";
  if (n >= 2 && n <= 4) return `${n} poznámky`;
  return `${n} poznámek`;
}
