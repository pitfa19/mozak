// Extract a sharp README still from the existing public demo. No network or uploads.
// Usage: node scripts/build-demo-preview.mjs SOURCE.mp4 OUTPUT.png
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const [source, output] = process.argv.slice(2);
if (!source || !output || !output.endsWith('.png')) throw new Error('usage: node scripts/build-demo-preview.mjs SOURCE.mp4 OUTPUT.png');
if (fs.existsSync(output)) throw new Error('output exists; choose a new file name');
const probe = JSON.parse(execFileSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','json',source], { encoding:'utf8',timeout:30000 }));
if (!(Number(probe.format?.duration) >= 62)) throw new Error('source must be the full demo, at least 62 seconds');
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive:true });
execFileSync('ffmpeg', ['-hide_banner','-loglevel','error','-ss','60','-i',source,'-frames:v','1','-vf','scale=1600:-2:flags=lanczos','-compression_level','9',output], { stdio:'inherit',timeout:60000 });
const bytes=fs.statSync(output).size;
if (bytes >= 400000) throw new Error('preview exceeds 400 KB; inspect it before use');
console.log(JSON.stringify({sourceSecond:60,width:1600,bytes,preview:'still',note:'Visually inspect readability. The full demo remains linked.'},null,2));
