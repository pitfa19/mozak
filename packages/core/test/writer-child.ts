// Child process for the concurrency test: appends N numbered lines to a shared file through updateFile.
import { updateFile } from "../src/index.ts";

const [file, tag, count] = process.argv.slice(2);
for (let i = 0; i < Number(count); i++) {
  updateFile(file, (t) => t + `${tag}-${i}\n`);
}
