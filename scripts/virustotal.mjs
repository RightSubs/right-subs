#!/usr/bin/env node
// Sends every APK in a folder to VirusTotal, waits for the scans and writes a Markdown section for
// the release notes: one row per APK with the detections and a link to its report. Progress (and,
// on GitHub Actions, a warning per flagged APK) goes to the console; the API key never does.
// Usage: VT_API_KEY=… node scripts/virustotal.mjs <folder> <output.md>
//
// The free API allows 4 requests a minute, so calls are spaced 15 s apart. Files over 32 MB
// (every APK of ours) must go through an upload URL, which costs one more call each.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [dir, output] = process.argv.slice(2);
const key = process.env.VT_API_KEY;
if (!dir || !output || !key) {
  console.error('usage: VT_API_KEY=… node scripts/virustotal.mjs <folder> <output.md>');
  process.exit(2);
}
const API = process.env.VT_API_URL ?? 'https://www.virustotal.com/api/v3';
const GAP_MS = Number(process.env.VT_GAP_MS ?? 15_000);
const WAIT_MS = Number(process.env.VT_WAIT_MS ?? 20 * 60_000);
const RETRY_MS = Number(process.env.VT_RETRY_MS ?? 60_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

let lastCall = 0;
async function vt(url, init = {}) {
  for (let attempt = 1; ; attempt++) {
    await sleep(lastCall + GAP_MS - Date.now());
    lastCall = Date.now();
    const res = await fetch(url, { ...init, headers: { ...init.headers, 'x-apikey': key } });
    if (res.ok) return res.json();
    // Only the quota (429) and server errors are worth another try.
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`VirusTotal answered ${res.status} to ${init.method ?? 'GET'} ${new URL(url).pathname}`);
    }
    await sleep(RETRY_MS);
  }
}

const names = (await readdir(dir)).filter((name) => name.endsWith('.apk')).sort();
if (names.length === 0) {
  console.error(`no .apk in ${dir}`);
  process.exit(1);
}

const scans = [];
for (const name of names) {
  const bytes = await readFile(path.join(dir, name));
  const { data: uploadUrl } = await vt(`${API}/files/upload_url`);
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const { data } = await vt(uploadUrl, { method: 'POST', body: form });
  scans.push({ name, sha256: createHash('sha256').update(bytes).digest('hex'), analysis: data.id, stats: null });
  console.error(`${name}: sent`);
}

const deadline = Date.now() + WAIT_MS;
while (scans.some((scan) => !scan.stats) && Date.now() < deadline) {
  for (const scan of scans.filter((s) => !s.stats)) {
    const { data } = await vt(`${API}/analyses/${scan.analysis}`);
    if (data.attributes.status === 'completed') {
      scan.stats = data.attributes.stats;
      console.error(`${scan.name}: ${scan.stats.malicious} malicious, ${scan.stats.suspicious} suspicious`);
    }
  }
}

const rows = scans.map(({ name, sha256: hash, stats }) => {
  let result = 'still scanning (see the report)';
  if (stats) {
    const flagged = stats.malicious + stats.suspicious;
    const engines = flagged + stats.undetected + stats.harmless;
    result = `${flagged} of ${engines} engines`;
    if (flagged > 0 && process.env.GITHUB_ACTIONS) {
      console.log(`::warning::${name}: ${flagged} VirusTotal engine(s) flagged it`);
    }
  }
  return `| \`${name}\` | ${result} | [report](https://www.virustotal.com/gui/file/${hash}) |`;
});

const date = new Date().toISOString().slice(0, 10);
await writeFile(output, `## VirusTotal

Each APK as scanned by [VirusTotal](https://www.virustotal.com) on ${date}. The report shows the current result.

| APK | Detections | Report |
|---|---|---|
${rows.join('\n')}
`);
