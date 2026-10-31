// Croatian diacritic folding (D3 goal 3). Explicit, not Unicode decomposition: đ has no decomposition, so NFD
// folding alone leaves it. č ć -> c, š -> s, ž -> z, đ -> d, both cases. Other letters stay as they are.

const FOLD: Record<string, string> = {
  "č": "c", "ć": "c", "š": "s", "ž": "z", "đ": "d",
  "Č": "C", "Ć": "C", "Š": "S", "Ž": "Z", "Đ": "D",
};

export function foldText(text: string): string {
  return text.replace(/[čćšžđČĆŠŽĐ]/g, (c) => FOLD[c] ?? c);
}

/** Folded and lowercased, for matching. */
export const foldKey = (text: string) => foldText(text).toLowerCase();
