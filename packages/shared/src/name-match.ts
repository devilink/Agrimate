/**
 * Bank-holder ↔ PAN name matching. Normalises case, spacing, punctuation and honorifics, then compares token multisets
 * in any order, allowing initials ("R K Sharma" ↔ "Ramesh Kumar Sharma"). At least one full word must match, so
 * initials alone never pass. Anything else is a mismatch and goes to manual review — it never auto-passes.
 */
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'shri', 'sri', 'shree', 'smt', 'srimati', 'kumari', 'kum', 'dr', 'late', 'prof']);

export function normaliseName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[.,'`-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !HONORIFICS.has(t));
}

const tokenMatch = (a: string, b: string) => {
  if (a === b) return true;
  if (a.length === 1) return b.startsWith(a);
  if (b.length === 1) return a.startsWith(b);
  return false;
};

export function namesMatch(a: string, b: string): boolean {
  const left = normaliseName(a);
  const right = normaliseName(b);
  if (!left.length || left.length !== right.length) return false;
  // Exact words consume first so an initial can't steal the token that a full word needs.
  const remL: string[] = [];
  const remR = [...right];
  let exact = 0;
  for (const t of left) {
    const i = remR.indexOf(t);
    if (i >= 0 && t.length > 1) { remR.splice(i, 1); exact++; } else remL.push(t);
  }
  if (exact === 0) return false;
  for (const t of remL) {
    const i = remR.findIndex((r) => tokenMatch(t, r));
    if (i < 0) return false;
    remR.splice(i, 1);
  }
  return remR.length === 0;
}
