// Start Funny Faces:  node server/main.js     (settings come from environment variables, all optional)
//   PORT=8765   HOST=0.0.0.0   FACES_DATA=./data   FACES_LAN_CONTROL=1 (let other devices open the control page, with a password)
//   FACES_NO_BUILD=1 skips rebuilding the page (the Docker image and the downloads build it once)
//   FACES_MAX_CONNECTIONS=256   FACES_MAX_WS_PER_IP=20   limits on open connections (all Docker clients share one address)
//   FACES_PACKS_DIR=./packs   the folder where you drop face pack files (*.json); the page offers them on every load
//   FACES_OPEN=1 opens the control page in the default browser (the double-click launchers set it)
import { execFile, execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp, lanUrls } from './index.js';

// Work from any directory: the app's own folder is found from this file, not from where it was started.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The packs folder sits next to the app: in a download it is beside app/ and runtime/, in a checkout it is in the project.
const packsDefault = existsSync(join(root, 'packs')) || !existsSync(join(root, '..', 'packs')) ? join(root, 'packs') : join(root, '..', 'packs');
const port = Number(process.env.PORT) || 8765;
if (!process.env.FACES_NO_BUILD) execFileSync(process.execPath, [join(root, 'scripts/build.mjs')], { cwd: root, stdio: 'ignore' });
const limit = (name, dflt) => (Number(process.env[name]) > 0 ? Number(process.env[name]) : dflt);
const app = createApp({
  port, host: process.env.HOST || '0.0.0.0', dataDir: process.env.FACES_DATA || join(root, 'data'), distDir: process.env.FACES_DIST || join(root, 'dist'), packsDir: process.env.FACES_PACKS_DIR || packsDefault,
  lanControl: /^(1|true|yes)$/i.test(process.env.FACES_LAN_CONTROL || ''),
  maxConnections: limit('FACES_MAX_CONNECTIONS', 256), maxPerIp: limit('FACES_MAX_WS_PER_IP', 20),
});

// A stray error from one bad request or socket is logged, and the server keeps running for everyone else.
process.on('uncaughtException', (e) => console.error(`[${new Date().toISOString()}] uncaught error (continuing):`, e && e.stack || e));
process.on('unhandledRejection', (e) => console.error(`[${new Date().toISOString()}] unhandled rejection (continuing):`, e && e.stack || e));

// docker stop and Ctrl+C: save the sessions (the save is normally delayed half a second) and close cleanly.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  if (stopping) return;
  stopping = true;
  const t = setTimeout(() => process.exit(0), 3000); t.unref();
  app.close().then(() => process.exit(0));
});
try {
  await app.listen();
} catch (e) {
  if (e.code === 'EADDRINUSE') console.log(`\nFunny Faces is probably already running (port ${port} is taken).\nOpen http://localhost:${port}/ in Chrome, or close the other Funny Faces window first.\nTo use another port: PORT=8800 npm start\n`);
  else console.log(`\nFunny Faces could not start: ${e.message}\n`);
  process.exit(1);
}
const urls = lanUrls(port);
console.log(`\nFunny Faces is running. Keep this window open; closing it stops Funny Faces (Ctrl+C also stops it).\n\n  Control (this computer):  http://localhost:${port}/`);
for (const u of urls) console.log(`  TV or other screen:       ${u}/screen`);
if (!urls.length) console.log('  (no network address found: connect to Wi-Fi or Ethernet so a TV can reach this computer)');
if (app.auth.setupCode) console.log(`\n  First-time setup code for the control page on other devices: ${app.auth.setupCode}`);
console.log('\nOn the TV, open the second address, then type the code it shows into the Screens tab here.');
console.log('If the TV cannot connect, allow Funny Faces (or "node") through the computer\'s firewall when it asks.\n');

if (process.env.FACES_OPEN === '1') {
  const url = `http://localhost:${port}/`;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  execFile(cmd, args, () => {}).on('error', () => {});             // if it cannot open, the printed address still works
}
