// Builds a download that needs no Node install: a zip holding the app, a copy of Node, a double-click launcher and a
// plain-language README. One zip per operating system.
//   node scripts/make-release.mjs --platform mac-arm64|mac-x64|win-x64|linux-x64 [--out release] [--node-binary <file> --node-license <file>]
// Without --node-binary it downloads the official Node build from nodejs.org (--node-version or FACES_NODE_VERSION, else
// the version running this script) and checks it against nodejs.org's published SHA-256 list before using it.
// The project LICENSE (MIT) goes into the zip root. Node's own LICENSE (from that archive) goes into the zip as runtime/LICENSE-node.txt, with THIRD-PARTY-NOTICES.txt.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

const argv = process.argv.slice(2);
const arg = (name, dflt) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : dflt; };
const PLATFORMS = {
  'mac-arm64': { node: 'darwin-arm64', ext: 'tar.gz', bin: 'bin/node', launcher: 'Start Funny Faces.command' },
  'mac-x64': { node: 'darwin-x64', ext: 'tar.gz', bin: 'bin/node', launcher: 'Start Funny Faces.command' },
  'win-x64': { node: 'win-x64', ext: 'zip', bin: 'node.exe', launcher: 'Start Funny Faces.bat' },
  'linux-x64': { node: 'linux-x64', ext: 'tar.xz', bin: 'bin/node', launcher: 'start-funny-faces.sh' },
};
const platform = arg('platform');
const spec = PLATFORMS[platform];
if (!spec) { console.error('Use --platform with one of: ' + Object.keys(PLATFORMS).join(', ')); process.exit(1); }
const out = resolve(arg('out', 'release'));
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
const nodeVersion = arg('node-version', process.env.FACES_NODE_VERSION || process.version);   // the Node bundled in the zip

const LAUNCHERS = {
  mac: `#!/bin/bash
# Double-click to start Funny Faces. Keep this window open while you use it.
cd "$(dirname "$0")/app" || exit 1
export FACES_NO_BUILD=1 FACES_OPEN=1 FACES_DATA="$HOME/Library/Application Support/Funny Faces"
../runtime/node server/main.js
echo
echo "Funny Faces stopped. You can close this window."
`,
  win: `@echo off\r
rem Double-click to start Funny Faces. Keep this window open while you use it.\r
cd /d "%~dp0app"\r
set FACES_NO_BUILD=1\r
set FACES_OPEN=1\r
set "FACES_DATA=%APPDATA%\\Funny Faces"\r
..\\runtime\\node.exe server\\main.js\r
echo.\r
echo Funny Faces stopped. You can close this window.\r
pause\r
`,
  linux: `#!/bin/bash
cd "$(dirname "$0")/app" || exit 1
export FACES_NO_BUILD=1 FACES_OPEN=1 FACES_DATA="\${XDG_DATA_HOME:-$HOME/.local/share}/funny-faces"
../runtime/node server/main.js
`,
};

const NOTICES = `THIRD-PARTY NOTICES
===================

Funny Faces itself has no third-party code: it is plain JavaScript with no dependencies. It is released under the
MIT license; the full text is in the file LICENSE next to this one.

This download bundles Node.js (the program in the "runtime" folder), which runs Funny Faces. Node.js is not part of
Funny Faces. It is distributed under its own license, the full text of which is in runtime/LICENSE-node.txt
(Node.js is copyright Node.js contributors and others; see that file for the terms and for the licenses of the
components Node.js itself includes). Node.js is unmodified, as published by the Node.js project at https://nodejs.org.
`;

const READ_ME = (launcher, os) => `FUNNY FACES ${version}
================

Talking faces for pumpkins, snowmen and more, on your computer and any TV on your Wi-Fi.

TO START
1. Double-click "${launcher}".
${os === 'mac' ? `   The first time, your Mac blocks it ("Not Opened"). See "THE FIRST TIME" below.
` : os === 'win' ? `   The first time, Windows may show "Windows protected your PC". See "THE FIRST TIME" below.
` : `   If nothing happens, see "THE FIRST TIME" below.
`}2. A black window opens with two web addresses, and Chrome opens the control page.
   Leave the black window open. Closing it stops Funny Faces.
3. If the computer asks to allow network access, choose Allow. A TV cannot connect without it.
4. In Chrome press "Use microphone", choose Allow, and talk. The mouth should move.

THE FIRST TIME
Funny Faces is a hobby project, so this app is not signed with a paid developer certificate. Your computer will warn
about that. It is safe to continue: Funny Faces runs only on your local network and sends nothing to the internet.
${os === 'mac' ? `
Option A (no Terminal):
  1. Double-click "${launcher}". When the "Not Opened" dialog appears, click Done (or OK).
  2. Open System Settings, then Privacy & Security.
  3. Scroll down to the message about "${launcher}" and click "Open Anyway".
  4. Confirm (your Mac may ask for your password or Touch ID). Funny Faces now starts.
  You only need to do this once.

Option B (Terminal): type the following, then press Return. To fill in the folder, drag the unzipped "Funny Faces"
folder onto the Terminal window after typing "xattr -dr com.apple.quarantine ".
  xattr -dr com.apple.quarantine <the unzipped Funny Faces folder>
Then double-click "${launcher}" as usual.
` : os === 'win' ? `
If Windows shows "Windows protected your PC" (SmartScreen): click "More info", then "Run anyway".
` : `
Make the launcher runnable once, then run it. In a terminal, in this folder:
  chmod +x "${launcher}"
  ./"${launcher}"
`}
TO USE A TV OR PROJECTOR
1. On the control page open the Screens tab. It shows an address and a QR code.
2. On the TV open its web browser (on a Fire TV: Silk) and type that address.
3. The TV shows a 6-character code. Type it into the Screens tab and press Add screen.

IF SOMETHING GOES WRONG
- The TV cannot connect: make sure the computer is awake, on the same Wi-Fi as the TV, and that you chose Allow above.
- It says Funny Faces is already running: it is. Open http://localhost:8765/ in Chrome.
- The code is not accepted: codes last 10 minutes. Reload the TV page for a new one.

Everything stays on your own network. Nothing is sent to the internet.

Funny Faces is free software under the MIT license (see the file LICENSE). The bundled Node.js has its own license;
see THIRD-PARTY-NOTICES.txt.
`;

function download(url, to) {
  execFileSync('curl', ['-fsSL', '--http1.1', '--retry', '5', '--retry-all-errors', '-o', to, url], { stdio: 'inherit' });
}

function fetchNode(tmp) {
  const file = `node-${nodeVersion}-${spec.node}.${spec.ext}`, base = `https://nodejs.org/dist/${nodeVersion}`;
  const archive = join(tmp, file), sums = join(tmp, 'SHASUMS256.txt');
  download(`${base}/${file}`, archive); download(`${base}/SHASUMS256.txt`, sums);
  const want = readFileSync(sums, 'utf8').split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p[1] === file);
  const got = createHash('sha256').update(readFileSync(archive)).digest('hex');
  if (!want || want[0] !== got) throw new Error(`Checksum mismatch for ${file}: refusing to use it`);
  const dir = join(tmp, 'node-extract');
  mkdirSync(dir);
  if (spec.ext === 'zip') execFileSync('unzip', ['-q', archive, '-d', dir]);
  else execFileSync('tar', ['-xf', archive, '-C', dir]);
  const base2 = join(dir, `node-${nodeVersion}-${spec.node}`);
  return { binary: join(base2, spec.bin), license: join(base2, 'LICENSE') };
}

const tmp = mkdtempSync(join(tmpdir(), 'ff-release-'));
try {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'ignore' });
  const fetched = arg('node-binary') ? null : fetchNode(tmp);
  const nodeFile = fetched ? fetched.binary : resolve(arg('node-binary'));
  const licenseFile = fetched ? fetched.license : arg('node-license') && resolve(arg('node-license'));
  if (!licenseFile || !existsSync(licenseFile)) throw new Error('Node\'s LICENSE file is required in every download: pass --node-license <file> along with --node-binary');
  const name = `Funny Faces`, root = join(tmp, name), os = platform.split('-')[0];
  mkdirSync(join(root, 'app'), { recursive: true });
  mkdirSync(join(root, 'runtime'));
  cpSync('server', join(root, 'app/server'), { recursive: true });
  cpSync('dist', join(root, 'app/dist'), { recursive: true });
  rmSync(join(root, 'app/dist/standalone'), { recursive: true, force: true });
  cpSync('package.json', join(root, 'app/package.json'));
  cpSync(nodeFile, join(root, 'runtime', basename(spec.bin)));
  chmodSync(join(root, 'runtime', basename(spec.bin)), 0o755);
  cpSync(licenseFile, join(root, 'runtime', 'LICENSE-node.txt'));
  mkdirSync(join(root, 'packs')); cpSync('packs/README.txt', join(root, 'packs/README.txt'));   // where people drop face packs
  cpSync('LICENSE', join(root, 'LICENSE'));
  writeFileSync(join(root, 'THIRD-PARTY-NOTICES.txt'), NOTICES.replace(/\n/g, os === 'win' ? '\r\n' : '\n'));
  const launcher = join(root, spec.launcher);
  writeFileSync(launcher, LAUNCHERS[os === 'win' ? 'win' : os === 'mac' ? 'mac' : 'linux']);
  chmodSync(launcher, 0o755);
  writeFileSync(join(root, 'READ ME FIRST.txt'), READ_ME(spec.launcher, os).replace(/\n/g, os === 'win' ? '\r\n' : '\n'));
  mkdirSync(out, { recursive: true });
  const zip = join(out, `FunnyFaces-${version}-${platform}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-q', '-r', '-y', zip, name], { cwd: tmp });
  console.log(zip);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
