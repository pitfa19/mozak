// Loaded with `node --import` before every test run (npm test, npm run test:install).
// Gives git in tests a private global config, so the developer's own ~/.gitconfig (global hooks such as
// a pre-push identity guard, signing, aliases) never changes test results. Test child processes inherit
// the environment. A test that needs its own settings still passes `-c` or sets repo config.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "mozak-test-gitconfig-"));
const file = join(dir, "gitconfig");
writeFileSync(file, "[user]\n\tname = mozak-test\n\temail = mozak-test@example.invalid\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n");
process.env.GIT_CONFIG_GLOBAL = file;
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_TERMINAL_PROMPT = "0";
