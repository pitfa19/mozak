// Minimal types for the one Electron API the desktop-only plugin uses. Obsidian provides Electron at runtime and
// the plugin build marks "electron" as external, so no electron package is installed.
declare module "electron" {
  export const shell: { openPath(path: string): Promise<string> };
}
