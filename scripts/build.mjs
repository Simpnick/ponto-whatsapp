import { copyFile, cp, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
const vendor = new URL('vendor/', output);
const upstream = new URL('node_modules/@wppconnect/wa-js/', root);

await mkdir(vendor, { recursive: true });
await cp(new URL('extension/', root), output, { recursive: true });
await copyFile(new URL('LICENSE', root), new URL('LICENSE', output));
await copyFile(new URL('dist/wppconnect-wa.js', upstream), new URL('wppconnect-wa.js', vendor));
await copyFile(new URL('dist/wppconnect-wa.js.LICENSE.txt', upstream), new URL('wppconnect-wa.js.LICENSE.txt', vendor));
await copyFile(new URL('LICENSE', upstream), new URL('LICENSE', vendor));
console.log('Extensão pronta em dist/.');
