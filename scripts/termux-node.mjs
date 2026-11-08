// Takes Node.js (nodejs-lts) and the libraries it needs from the Termux packages —
// the same build that runs RightSubs on the box — and lays them out for the APK:
//   <out>/jniLibs/<abi>/libnode.so + every library node needs (renamed to lib*.so,
//   the only names Android extracts from an APK), <out>/assets/libmap.txt (real
//   name → name in the APK, the app links them back at runtime) and the CA bundle.
// Every .deb is checked against the SHA-256 in the repository index.
//
// Usage: node termux-node.mjs --cache <dir> --stage <dir> --out <dir> <abi...>
//        node termux-node.mjs --check <out> <abi...>   (every NEEDED of every .so resolves)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parseArgs } from 'node:util';

const REPO = 'https://packages.termux.dev/apt/termux-main';
const ROOT_PACKAGE = 'nodejs-lts';
const ARCH = { 'armeabi-v7a': 'arm', 'arm64-v8a': 'aarch64', x86_64: 'x86_64' };
const PREFIX = 'data/data/com.termux/files/usr';
/** Libraries every Android app process can load from the system (NDK stable APIs). */
const SYSTEM_LIBS = new Set(['libc.so', 'libm.so', 'libdl.so', 'liblog.so', 'libz.so', 'libandroid.so']);
const READELF = join(process.env.ANDROID_NDK_HOME ?? '', 'toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-readelf');

const { values: opts, positionals: abis } = parseArgs({
  allowPositionals: true,
  options: { cache: { type: 'string' }, stage: { type: 'string' }, out: { type: 'string' }, check: { type: 'string' } },
});

for (const abi of abis) if (!ARCH[abi]) throw new Error(`unknown ABI: ${abi} (use ${Object.keys(ARCH).join(', ')})`);
if (abis.length === 0) throw new Error('give at least one ABI');

/** APK-safe name: libssl.so.3 → libssl_so_3.so. */
export const apkName = (soname) => (/^lib[^/]*\.so$/.test(soname) ? soname : `lib${soname.slice(3).replace(/\./g, '_')}.so`);

function needed(file) {
  const out = execFileSync(READELF, ['-d', file], { encoding: 'utf8' });
  return [...out.matchAll(/\(NEEDED\)\s+Shared library: \[([^\]]+)\]/g)].map((m) => m[1]);
}

if (opts.check) {
  // The real names the app links back, plus the libraries already named lib*.so.
  const map = new Map(readFileSync(join(opts.check, 'assets', 'libmap.txt'), 'utf8').trim().split('\n').map((l) => l.split(' ')));
  let problems = 0;
  for (const abi of abis) {
    const dir = join(opts.check, 'jniLibs', abi);
    const present = new Set(readdirSync(dir));
    for (const file of present) {
      for (const lib of needed(join(dir, file))) {
        const ok = SYSTEM_LIBS.has(lib) || present.has(lib) || (map.has(lib) && present.has(map.get(lib)));
        if (!ok) {
          console.error(`[${abi}] ${file} needs ${lib}, which is not in the APK`);
          problems++;
        }
      }
    }
  }
  if (problems > 0) process.exit(1);
  console.log(`Bibliotecas conferidas: ${abis.join(', ')}`);
  process.exit(0);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function parseIndex(text) {
  const packages = new Map();
  for (const block of text.split(/\n\n+/)) {
    const fields = Object.fromEntries(
      block.split('\n').filter((l) => /^[A-Za-z0-9-]+: /.test(l)).map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 2)]),
    );
    if (fields.Package) packages.set(fields.Package, fields);
  }
  return packages;
}

function resolveDeps(index, root) {
  const seen = new Map();
  const visit = (name) => {
    if (seen.has(name)) return;
    const pkg = index.get(name);
    if (!pkg) throw new Error(`package ${name} not found in the Termux repository`);
    if (!/^[0-9a-f]{64}$/.test(pkg.SHA256 ?? '')) throw new Error(`package ${name} has no SHA-256 in the index`);
    seen.set(name, pkg);
    for (const dep of (pkg.Depends ?? '').split(',').map((d) => d.split('|')[0].replace(/\(.*\)/, '').trim()).filter(Boolean)) {
      visit(dep);
    }
  };
  visit(root);
  // The CA bundle (ca-certificates) is pulled in by openssl.
  return [...seen.values()];
}

async function main() {
  const { cache, stage, out } = opts;
  if (!cache || !stage || !out) throw new Error('use --cache, --stage e --out');
  mkdirSync(join(cache, 'debs'), { recursive: true });
  mkdirSync(join(out, 'assets'), { recursive: true });
  const libmap = new Map();
  const versions = [];

  for (const abi of abis) {
    const arch = ARCH[abi];
    const index = parseIndex((await fetchBuffer(`${REPO}/dists/stable/main/binary-${arch}/Packages`)).toString('utf8'));
    const root = join(stage, abi);
    rmSync(root, { recursive: true, force: true });
    mkdirSync(root, { recursive: true });

    for (const pkg of resolveDeps(index, ROOT_PACKAGE)) {
      const deb = join(cache, 'debs', basename(pkg.Filename));
      const valid = () => existsSync(deb) && createHash('sha256').update(readFileSync(deb)).digest('hex') === pkg.SHA256;
      if (!valid()) {
        writeFileSync(deb, await fetchBuffer(`${REPO}/${pkg.Filename}`));
        if (!valid()) throw new Error(`SHA-256 mismatch: ${pkg.Filename}`);
      }
      execFileSync('dpkg-deb', ['-x', deb, root]);
      if (pkg.Package === ROOT_PACKAGE) versions.push(`${abi}: ${pkg.Package} ${pkg.Version}`);
    }

    const usr = join(root, PREFIX);
    const jni = join(out, 'jniLibs', abi);
    mkdirSync(jni, { recursive: true });
    copyFileSync(join(usr, 'bin', 'node'), join(jni, 'libnode.so'));

    // Breadth-first over NEEDED: only what node actually loads goes into the APK.
    const queue = [join(usr, 'bin', 'node')];
    const done = new Set();
    while (queue.length > 0) {
      for (const lib of needed(queue.shift())) {
        if (done.has(lib) || SYSTEM_LIBS.has(lib)) continue;
        const source = join(usr, 'lib', lib);
        if (!existsSync(source)) throw new Error(`[${abi}] ${lib} is neither in the Termux packages nor in the system`);
        done.add(lib);
        const name = apkName(lib);
        copyFileSync(realpathSync(source), join(jni, name));
        if (name !== lib) libmap.set(lib, name);
        queue.push(source);
      }
    }

    if (!existsSync(join(out, 'assets', 'cacert.pem'))) copyFileSync(join(usr, 'etc', 'tls', 'cert.pem'), join(out, 'assets', 'cacert.pem'));
  }

  writeFileSync(join(out, 'assets', 'libmap.txt'), [...libmap].map(([lib, name]) => `${lib} ${name}`).join('\n') + '\n');
  writeFileSync(join(out, 'node-version.txt'), versions.join('\n') + '\n');
  console.log(versions.join('\n'));
}

await main();
