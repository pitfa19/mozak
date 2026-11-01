// Display-only repo link of a scope (0.6.0): `github:owner/repo` or an https URL. It is shown in `mozak scopes` and the
// Obsidian sidebar so the owner can open the code repo. It is never used for git, never fetched, and never decides
// where plans live. Pure helpers, no IO.

/** Owner or repo name: starts with a letter or digit, so "." and ".." can never pass. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HTTPS = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]*(:\d{1,5})?(\/[A-Za-z0-9._~%/-]*)?$/;

/** The link exactly as given when it is `github:owner/repo` or an https URL with a host, else null. */
export function parseRepoLink(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("github:")) {
    const parts = value.slice("github:".length).split("/");
    return parts.length === 2 && parts.every((p) => SLUG.test(p)) ? value : null;
  }
  return HTTPS.test(value) ? value : null;
}

export const REPO_LINK_HELP = `repo must be "github:owner/repo" or an https:// URL`;

/** A browsable URL for the link. */
export function repoLinkUrl(spec: string): string {
  if (spec.startsWith("github:")) return `https://github.com/${spec.slice("github:".length)}`;
  return spec.replace(/\.git$/, "");
}

/** Short label: owner/repo for GitHub, host/path otherwise. */
export function repoLinkLabel(spec: string): string {
  return repoLinkUrl(spec).replace(/^https:\/\/(github\.com\/)?/, "");
}
