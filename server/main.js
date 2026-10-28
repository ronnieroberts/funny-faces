// Start Funny Faces:  node server/main.js     (settings come from environment variables, all optional)
//   PORT=8765   HOST=0.0.0.0   FACES_DATA=./data   FACES_LAN_CONTROL=1 (let other devices open the control page, with a password)
//   FACES_NO_BUILD=1 skips rebuilding the page (the Docker image builds it once)
import { execFileSync } from 'node:child_process';
import { createApp, lanUrls } from './index.js';

const port = Number(process.env.PORT) || 8765;
if (!process.env.FACES_NO_BUILD) execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'ignore' });
const app = createApp({
  port, host: process.env.HOST || '0.0.0.0', dataDir: process.env.FACES_DATA || './data', distDir: process.env.FACES_DIST || './dist',
  lanControl: /^(1|true|yes)$/i.test(process.env.FACES_LAN_CONTROL || ''),
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
