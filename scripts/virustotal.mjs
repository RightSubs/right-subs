#!/usr/bin/env node
// Sends every APK in a folder to VirusTotal, waits for the scans and writes a Markdown section for
// the release notes: one row per APK with its download link, a badge with the result
// (malicious/suspicious/engines, drawn by shields.io from these numbers: no third party queries
// VirusTotal) and a link to the live report. Progress (and, on GitHub Actions, a warning per flagged
// APK) goes to the console; the API key never does.
// Usage: VT_API_KEY=… node scripts/virustotal.mjs <folder> <output.md> [download base URL]
//
// The free API allows 4 requests a minute, so calls are spaced 15 s apart. Files over 32 MB
// (every APK of ours) must go through an upload URL, which costs one more call each.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [dir, output, downloadBase] = process.argv.slice(2);
const key = process.env.VT_API_KEY;
if (!dir || !output || !key) {
  console.error('usage: VT_API_KEY=… node scripts/virustotal.mjs <folder> <output.md> [download base URL]');
  process.exit(2);
}
const API = process.env.VT_API_URL ?? 'https://www.virustotal.com/api/v3';
const GAP_MS = Number(process.env.VT_GAP_MS ?? 15_000);
const WAIT_MS = Number(process.env.VT_WAIT_MS ?? 20 * 60_000);
const RETRY_MS = Number(process.env.VT_RETRY_MS ?? 60_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

let lastCall = 0;
// Returns the parsed body, or null for the statuses the caller expects (`accept`). `what` names
// the call in errors: the upload URL is a one-time address that does not belong in the log.
async function vt(url, { what, accept = [], ...init } = {}) {
  for (let attempt = 1; ; attempt++) {
    await sleep(lastCall + GAP_MS - Date.now());
    lastCall = Date.now();
    const res = await fetch(url, { ...init, headers: { ...init.headers, 'x-apikey': key } });
    if (res.ok) return res.json();
    if (accept.includes(res.status)) return null;
    // Only the quota (429) and server errors are worth another try.
    if (attempt >= 4 || (res.status !== 429 && res.status < 500)) {
      throw new Error(`VirusTotal answered ${res.status} to ${what}`);
    }
    await sleep(RETRY_MS);
  }
}

// The file's last full scan, or null when VirusTotal does not know it yet.
async function lastScan(hash) {
  const body = await vt(`${API}/files/${hash}`, { what: `file ${hash}`, accept: [404] });
  const attributes = body?.data.attributes;
  return attributes?.last_analysis_date ? attributes.last_analysis_stats : null;
}

const names = (await readdir(dir)).filter((name) => name.endsWith('.apk')).sort();
if (names.length === 0) {
  console.error(`no .apk in ${dir}`);
  process.exit(1);
}

// A file VirusTotal already scanned (a run again, or the same APK) is not sent twice: its last
// scan is used. 409 = the same file is being scanned right now: wait for that scan.
const scans = [];
for (const name of names) {
  const bytes = await readFile(path.join(dir, name));
  const scan = { name, sha256: createHash('sha256').update(bytes).digest('hex'), analysis: null, stats: null };
  scans.push(scan);
  scan.stats = await lastScan(scan.sha256);
  if (scan.stats) {
    console.error(`${name}: already scanned`);
    continue;
  }
  const { data: uploadUrl } = await vt(`${API}/files/upload_url`, { what: 'upload_url' });
  const form = new FormData();
  form.append('file', new Blob([bytes]), name);
  const sent = await vt(uploadUrl, { what: `upload of ${name}`, method: 'POST', body: form, accept: [409] });
  scan.analysis = sent?.data.id ?? null;
  console.error(`${name}: ${sent ? 'sent' : 'already being scanned'}`);
}

const deadline = Date.now() + WAIT_MS;
while (scans.some((scan) => !scan.stats) && Date.now() < deadline) {
  for (const scan of scans.filter((s) => !s.stats)) {
    if (scan.analysis) {
      const { data } = await vt(`${API}/analyses/${scan.analysis}`, { what: `analysis of ${scan.name}` });
      if (data.attributes.status === 'completed') scan.stats = data.attributes.stats;
    } else {
      scan.stats = await lastScan(scan.sha256);
    }
    if (scan.stats) console.error(`${scan.name}: ${scan.stats.malicious} malicious, ${scan.stats.suspicious} suspicious`);
  }
}

// shields.io static badge: "-" and "_" are separators in the path, so they are doubled.
const badge = (label, message, color) => {
  const part = (text) => encodeURIComponent(text.replaceAll('-', '--').replaceAll('_', '__'));
  return `https://img.shields.io/badge/${part(label)}-${part(message)}-${color}?logo=virustotal&logoColor=white`;
};

const rows = scans.map(({ name, sha256: hash, stats }) => {
  const report = `https://www.virustotal.com/gui/file/${hash}/detection`;
  let status = badge(hash.slice(0, 6), 'scanning', 'lightgrey');
  if (stats) {
    const engines = stats.malicious + stats.suspicious + stats.undetected + stats.harmless;
    const color = stats.malicious > 0 ? 'red' : stats.suspicious > 0 ? 'orange' : '2ea44f';
    status = badge(hash.slice(0, 6), `${stats.malicious}/${stats.suspicious}/${engines}`, color);
    if (stats.malicious + stats.suspicious > 0 && process.env.GITHUB_ACTIONS) {
      console.log(`::warning::${name}: ${stats.malicious} malicious and ${stats.suspicious} suspicious on VirusTotal`);
    }
  }
  const file = downloadBase ? `[${name}](${downloadBase}/${name})` : `\`${name}\``;
  return `| ${file} | [![VirusTotal: ${name}](${status})](${report}) | [View report](${report}) |`;
});

const date = new Date().toISOString().slice(0, 10);
await writeFile(output, `## 🛡️ VirusTotal analysis

Scanned on ${date}. The badge shows malicious / suspicious / engines at that time; the report shows the current result.

| APK | VirusTotal | Detailed report |
| :--- | :---: | :--- |
${rows.join('\n')}
`);
