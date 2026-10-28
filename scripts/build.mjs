// Builds dist/: every script gets a content-hashed name so it can be cached for a year.
// index.html is the only file with a short cache time; it points at the hashed scripts.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const order = ['quality.js', 'response.js', 'visemes.js', 'fft.js', 'track.js', 'qr.js', 'facepack.js', 'layout.js', 'quad.js', 'settings.js', 'output.js', 'packs.js', 'conductor.js', 'voice.js', 'glstage.js', 'stage.js', 'bench.js', 'editor.js', 'ui.js', 'relay.js', 'share.js', 'screenfollow.js', 'tabaudio.js', 'app.js'];   // dependencies first
const names = {};
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/assets', { recursive: true });

for (const f of order) {
  let src = readFileSync(`src/${f}`, 'utf8');
  src = src.replace(/from '\.\/([\w-]+\.js)'/g, (m, dep) => {
    if (!names[dep]) throw new Error(`${f} imports ${dep} before it is built`);
    return `from './${names[dep]}'`;
  });
  const hash = createHash('sha256').update(src).digest('hex').slice(0, 10);
  names[f] = f.replace(/\.js$/, `.${hash}.js`);
  writeFileSync(`dist/assets/${names[f]}`, src);
}

let html = readFileSync('index.html', 'utf8');
html = html.replace('src/app.js', `assets/${names['app.js']}`);
writeFileSync('dist/index.html', html);
console.log(JSON.stringify(names, null, 2));
