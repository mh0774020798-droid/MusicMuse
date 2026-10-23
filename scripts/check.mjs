import { readdir, readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function walk(dir) { const out = []; for (const entry of await readdir(dir, { withFileTypes: true })) { if (entry.name.startsWith('.') || entry.name === 'node_modules') continue; const p = `${dir}/${entry.name}`; if (entry.isDirectory()) out.push(...await walk(p)); else if (/\.(mjs|js)$/.test(p)) out.push(p); } return out; }
for (const file of await walk('.')) { const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' }); if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(1); } }
for (const file of ['public/index.html', 'public/app.js', 'public/style.css', 'public/shorts.css', 'public/shorts.js', 'public/tiktok.js', 'public/discovery.js', 'lib/discovery.js', 'public/creator-promo.js', 'public/creator-promo.css', 'public/manifest.webmanifest', 'public/sw.js']) await access(file);
JSON.parse(await readFile('vercel.json', 'utf8')); JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
console.log('JavaScript syntax, deployment configuration and required assets: OK');
