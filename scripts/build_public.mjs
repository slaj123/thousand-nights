// Build step (run by `npm run build`, locally and in Workers Builds):
// copies content/*.json into public/content/ and writes the manifest the app
// reads. Adding a batch = drop content/days_101-200.json in and push.
import { readdir, mkdir, copyFile, writeFile, rm } from 'node:fs/promises';

const files = (await readdir('content')).filter((f) => f.endsWith('.json'));
const days = files.filter((f) => /^days_\d+-\d+\.json$/.test(f)).sort();
if (!days.length) throw new Error('no content/days_*.json files');
if (!files.includes('light_pool.json')) throw new Error('content/light_pool.json missing');

await rm('public/content', { recursive: true, force: true });
await mkdir('public/content', { recursive: true });
const notes = files.filter((f) => /^notes_.*.json$/.test(f)).sort();
for (const f of [...days, 'light_pool.json', ...notes]) await copyFile(`content/${f}`, `public/content/${f}`);
await writeFile('public/content/index.json', JSON.stringify({ days, light: 'light_pool.json', notes }, null, 1));
console.log(`public/content: ${[...days, 'light_pool.json', ...notes].join(', ')}`);
