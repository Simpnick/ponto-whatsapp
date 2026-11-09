import { build } from 'esbuild';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const sdkVersion = '2.7.0';
const worklets = [
  ['Iu', 'voice-resampler.js'],
  ['Yu', 'voice-audio-input.js'],
  ['Qu', 'voice-audio-output.js']
];
const resamplerNotice = `libsamplerate (2-clause BSD)
Copyright (c) 2012-2016, Erik de Castro Lopo erikd@mega-nerd.com All rights reserved.

Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:

Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.

Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`;

function uniqueIndex(source, match) {
  const index = source.indexOf(match);
  if (index < 0 || source.indexOf(match, index + match.length) >= 0) {
    throw new Error('Reavalie a adaptação do SDK WaVoIP antes de gerar a extensão.');
  }
  return index;
}

function replaceUnique(source, search, replacement) {
  uniqueIndex(source, search);
  return source.replace(search, replacement);
}

function readLiteral(source, start) {
  const quote = source[start];
  if (quote !== "'" && quote !== '`') throw new Error('Formato inesperado de worklet WaVoIP.');
  let end = start + 1;
  for (; end < source.length && source[end] !== quote; end++) {
    if (source[end] === '\\') end++;
    else if (quote === '`' && source.startsWith('${', end)) throw new Error('Worklet dinâmico no SDK WaVoIP.');
  }
  if (end >= source.length) throw new Error('Literal de worklet WaVoIP incompleto.');
  // The scan permits one static JavaScript string literal. Only its escapes are decoded.
  const value = runInNewContext(source.slice(start, end + 1), Object.create(null), {
    timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false }
  });
  return { value, end: end + 1 };
}

export async function buildVoice(root, output) {
  const sdk = new URL('node_modules/@wavoip/wavoip-api/', root);
  const upstream = new URL('dist/index.es.js', sdk);
  const version = JSON.parse(await readFile(new URL('package.json', sdk), 'utf8')).version;
  if (version !== sdkVersion) throw new Error(`A adaptação WaVoIP exige a versão ${sdkVersion}.`);

  let source = await readFile(upstream, 'utf8');
  const vendor = new URL('vendor/', output);
  await mkdir(vendor, { recursive: true });
  for (const [symbol, filename] of worklets) {
    const prefix = `${symbol} = URL.createObjectURL(new Blob([`;
    const start = uniqueIndex(source, prefix);
    const { value, end } = readLiteral(source, start + prefix.length);
    const suffix = '], { type: "application/javascript" }))';
    if (!source.startsWith(suffix, end)) throw new Error('Declaração inesperada de worklet WaVoIP.');
    await writeFile(new URL(filename, vendor), value, 'utf8');
    source = source.slice(0, start) + `${symbol} = new URL("./vendor/${filename}", import.meta.url).href` +
      source.slice(end + suffix.length);
  }

  // Provide a per-instance MediaStream callback instead of acquiring a real microphone.
  source = replaceUnique(source, 'this.mediaManager = new Su(),',
    'this.mediaManager = new Su(), this.mediaManager.inputStreamFactory = u.inputStreamFactory, ' +
    'this.preparePontoMedia = () => this.mediaManager.waitReady(),');
  source = replaceUnique(source, 'navigator.mediaDevices.getUserMedia(K(O))', 'this.inputStreamFactory()');
  source = replaceUnique(source, 'navigator.mediaDevices.getUserMedia(K(u))', 'this.inputStreamFactory()');
  if (/getUserMedia\s*\(/.test(source)) throw new Error('Acesso ao microfone inesperado no SDK WaVoIP.');

  const { metafile } = await build({
    entryPoints: [fileURLToPath(new URL('extension/voice.js', root))],
    outfile: fileURLToPath(new URL('voice.js', output)),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome140',
    legalComments: 'eof',
    metafile: true,
    plugins: [{
      name: 'ponto-wavoip-local-media',
      setup(builder) {
        builder.onLoad({ filter: /[\\/]@wavoip[\\/]wavoip-api[\\/]dist[\\/]index\.es\.js$/ }, () => ({
          contents: source,
          resolveDir: dirname(fileURLToPath(upstream))
        }));
      }
    }]
  });

  const mit = await readFile(new URL('LICENSE', root), 'utf8');
  const notices = [
    mit.replace('Copyright (c) 2026 Ponto contributors', 'Copyright (c) 2009 Kazuhiko Arase (qrcode-generator)'),
    mit.replace('Copyright (c) 2026 Ponto contributors', 'Copyright (c) 2021 Alexander Olsen (libsamplerate-js)'),
    resamplerNotice
  ];
  const directories = new Set(Object.keys(metafile.inputs).map((input) =>
    input.match(/^(.*node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)/)?.[1]).filter(Boolean));
  for (const directory of directories) {
    const files = await readdir(directory);
    const filename = files.find((file) => /^licen[cs]e(?:\.md|\.txt)?$/i.test(file));
    if (filename) notices.push(`${directory.split('node_modules/').at(-1)}\n${await readFile(resolve(directory, filename), 'utf8')}`);
  }
  await writeFile(new URL('LICENSE-voice-dependencies.txt', vendor), notices.join('\n\n'), 'utf8');
}
