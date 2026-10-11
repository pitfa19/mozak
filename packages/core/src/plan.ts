/** Replace only the body of the "## Plan" section. Links and Translations are never touched. */
export function setPlan(text: string, newPlan: string): string {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Plan\s*$/.test(l));
  if (start < 0) throw new Error('MOZAK.md has no "## Plan" section');
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  if (/^##\s/m.test(newPlan)) throw new Error("plan text must not contain ## headings, they would change the file structure");
  const body = newPlan.replace(/\s+$/, "");
  return [...lines.slice(0, start + 1), "", ...(body ? [body, ""] : []), ...lines.slice(end)].join("\n");
}
