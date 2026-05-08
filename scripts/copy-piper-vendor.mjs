/**
 * Kopiert Piper-ONNX-Phonemize- und piper-tts-web-Builds nach assets/vendor/.
 * Voraussetzung: npm install (siehe package.json).
 */
import { copyFileSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const copies = [
  {
    from: join(root, 'node_modules/onnxruntime-web/dist/esm/ort.min.js'),
    to: join(root, 'assets/vendor/onnxruntime-web/ort.min.js'),
  },
  {
    from: join(root, 'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm'),
    to: join(root, 'assets/vendor/piper-wasm/piper_phonemize.wasm'),
  },
  {
    from: join(root, 'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data'),
    to: join(root, 'assets/vendor/piper-wasm/piper_phonemize.data'),
  },
  {
    from: join(root, 'node_modules/@mintplex-labs/piper-tts-web/dist/piper-tts-web.js'),
    to: join(root, 'assets/vendor/piper-tts-web/piper-tts-web.js'),
  },
  {
    from: join(root, 'node_modules/@mintplex-labs/piper-tts-web/dist/piper-o91UDS6e.js'),
    to: join(root, 'assets/vendor/piper-tts-web/piper-o91UDS6e.js'),
  },
  {
    from: join(root, 'node_modules/@mintplex-labs/piper-tts-web/dist/voices_static-D_OtJDHM.js'),
    to: join(root, 'assets/vendor/piper-tts-web/voices_static-D_OtJDHM.js'),
  },
];

mkdirSync(join(root, 'assets/vendor/onnxruntime-web'), { recursive: true });
mkdirSync(join(root, 'assets/vendor/piper-wasm'), { recursive: true });
mkdirSync(join(root, 'assets/vendor/piper-tts-web'), { recursive: true });

for (const { from, to } of copies) {
  copyFileSync(from, to);
  console.log('copied', to);
  if (to.includes('onnxruntime-web') && to.endsWith('ort.min.js')) {
    let src = readFileSync(to, 'utf8');
    src = src.replace(/\r?\n\/\/# sourceMappingURL=[^\r\n]+\r?\n?$/, '\n');
    writeFileSync(to, src);
    console.log('stripped sourceMappingURL from ort.min.js');
  }
  if (to.includes('piper-tts-web') && to.endsWith('piper-tts-web.js')) {
    let src = readFileSync(to, 'utf8');
    const needle =
      '__privateGet(this, _ort).env.wasm.numThreads = navigator.hardwareConcurrency;';
    const patch =
      '__privateGet(this, _ort).env.wasm.numThreads = typeof SharedArrayBuffer !== "undefined" && typeof navigator !== "undefined" && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 1;';
    if (!src.includes(needle)) {
      console.warn('copy-piper-vendor: piper-tts-web ORT numThreads pattern not found, skip patch');
    } else {
      src = src.split(needle).join(patch);
      writeFileSync(to, src);
      console.log('patched piper-tts-web ORT wasm numThreads (Safari / no SharedArrayBuffer)');
    }
  }
}

const ortDist = join(root, 'node_modules/onnxruntime-web/dist');
for (const name of readdirSync(ortDist)) {
  if (!name.endsWith('.wasm')) {
    continue;
  }
  const f = join(ortDist, name);
  if (statSync(f).isFile()) {
    const dest = join(root, 'assets/vendor/onnxruntime-web', name);
    copyFileSync(f, dest);
    console.log('copied', dest);
  }
}

console.log('copy-piper-vendor: done.');
