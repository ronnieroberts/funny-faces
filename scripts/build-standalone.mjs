// Builds dist/standalone/index.html: the whole app in one file with no modules, so it also runs when
// opened straight from a folder (file://). Microphone only: the audio file picker and ?audio= are off.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const order = ['response.js', 'visemes.js', 'fft.js', 'track.js', 'qr.js', 'facepack.js', 'layout.js', 'settings.js', 'packs.js', 'voice.js', 'relay.js', 'share.js', 'app.js'];
const id = (f) => 'M_' + f.replace('.js', '');
let bundle = '';

for (const f of order) {
  let src = readFileSync(`src/${f}`, 'utf8');
  const names = [];
  src = src.replace(/^import\s*\{([^}]*)\}\s*from\s*'\.\/([\w-]+\.js)';?[ \t]*\n?/gm, (m, list, dep) => {
    const parts = list.split(',').map((s) => s.trim()).filter(Boolean).map((s) => s.replace(/\s+as\s+/, ': '));
    return `const { ${parts.join(', ')} } = ${id(dep)};\n`;
  });
  src = src.replace(/^export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)/gm, (m, n) => { names.push(n); return m.replace(/^export\s+/, ''); });
  bundle += `const ${id(f)} = (() => {\n${src}\nreturn { ${names.join(', ')} };\n})();\n`;
}

let html = readFileSync('index.html', 'utf8');
html = html
  .replace('<script type="module" src="src/app.js"></script>',
    `<script>window.FACE_MIC_ONLY = true;</script>\n<script>\n${bundle}</script>`)
  .replace('</style>', '  #filerow, #audiohint { display:none; }\n</style>');
if (!html.includes('M_app')) throw new Error('bundle was not inlined');
mkdirSync('dist/standalone', { recursive: true });
writeFileSync('dist/standalone/index.html', html);
console.log('dist/standalone/index.html', html.length, 'bytes');
