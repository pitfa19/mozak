// Retrieval metrics: recall@k (any gold and all gold), MRR, abstain accuracy, per-item correctness.

export function scoreItem(item, result, k = 5) {
  const top = result.ranked.slice(0, k).map((r) => r.path);
  const isAbstainItem = item.gold.length === 0;
  if (isAbstainItem) {
    return { id: item.id, type: item.type, lang: item.lang, abstainItem: true, abstained: result.abstain, correct: result.abstain, rr: null, hitAny: null, hitAll: null };
  }
  const allRanked = result.ranked.map((r) => r.path);
  const firstGold = allRanked.findIndex((p) => item.gold.includes(p));
  const rr = firstGold >= 0 && firstGold < k ? 1 / (firstGold + 1) : 0;
  const hitAny = top.some((p) => item.gold.includes(p));
  const hitAll = item.gold.every((g) => top.includes(g));
  const correct = item.goldMode === 'all' ? hitAll : hitAny;
  return { id: item.id, type: item.type, lang: item.lang, abstainItem: false, abstained: result.abstain, correct, rr, hitAny, hitAll };
}

const round = (x) => (x === null ? null : Math.round(x * 10000) / 10000);

export function aggregate(scored) {
  const ans = scored.filter((s) => !s.abstainItem);
  const abs = scored.filter((s) => s.abstainItem);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const abstainCorrect = scored.filter((s) => s.abstained === s.abstainItem).length;
  return {
    items: scored.length,
    answerable: ans.length,
    abstainItems: abs.length,
    recallAt5Any: round(mean(ans.map((s) => (s.hitAny ? 1 : 0)))),
    recallAt5All: round(mean(ans.map((s) => (s.hitAll ? 1 : 0)))),
    mrrAt5: round(mean(ans.map((s) => s.rr))),
    abstainAccuracy: round(abstainCorrect / scored.length),
    abstainRecall: round(mean(abs.map((s) => (s.abstained ? 1 : 0)))),
    falseAbstain: ans.filter((s) => s.abstained).length,
    itemAccuracy: round(mean(scored.map((s) => (s.correct ? 1 : 0)))),
  };
}

export function aggregateBy(scored, key) {
  const groups = {};
  for (const s of scored) (groups[s[key]] ??= []).push(s);
  return Object.fromEntries(Object.keys(groups).sort().map((g) => [g, aggregate(groups[g])]));
}
