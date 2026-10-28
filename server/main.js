// Start Funny Faces:  node server/main.js     (settings come from environment variables, all optional)
//   PORT=8765   HOST=0.0.0.0   FACES_DATA=./data   FACES_LAN_CONTROL=1 (let other devices open the control page, with a password)
import { createApp, lanUrls } from './index.js';

const port = Number(process.env.PORT) || 8765;
const app = createApp({
  port, host: process.env.HOST || '0.0.0.0', dataDir: process.env.FACES_DATA || './data', distDir: process.env.FACES_DIST || './dist',
  lanControl: /^(1|true|yes)$/i.test(process.env.FACES_LAN_CONTROL || ''),
});
await app.listen();
const urls = lanUrls(port);
console.log(`\nFunny Faces is running.\n\n  Control (this computer):  http://localhost:${port}/`);
for (const u of urls) console.log(`  TV or other screen:       ${u}/screen`);
if (!urls.length) console.log('  (no network address found: connect to Wi-Fi or Ethernet so a TV can reach this computer)');
console.log('\nOn the TV, open that address, then type the code it shows into the Screens tab here.\n');
