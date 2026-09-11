// file:// 로 열면 전부 실패하는 것들: module import, fetch, 한글 경로 에셋
import { greet } from './lib.js';

const out = document.getElementById('out');
const rows = [];
const add = (label, value, ok = true) => {
  rows.push(`<li class="list-row items-center">
    <span class="badge ${ok ? 'badge-success' : 'badge-error'} badge-soft">${ok ? '성공' : '실패'}</span>
    <div><div class="font-semibold">${label}</div><div class="text-xs text-base-content/60 font-mono">${value}</div></div>
  </li>`);
  out.innerHTML = rows.join('');
};

try {
  const data = await (await fetch('./data.json')).json();
  add('ES module import + fetch JSON', greet(data.name));
} catch (e) { add('ES module import + fetch JSON', String(e), false); }

try {
  const note = await (await fetch('./한글 폴더/노트.json')).json();
  add('한글 폴더 / 한글 파일명', note.text);
} catch (e) { add('한글 폴더 / 한글 파일명', String(e), false); }

const glb = await fetch('./assets/모델.glb');
add('three.js 모델 (.glb) MIME', 'glb: ' + glb.headers.get('content-type'), glb.ok);

const wasm = await fetch('./assets/demo.wasm');
add('WebAssembly (.wasm) MIME', 'wasm: ' + wasm.headers.get('content-type'), wasm.ok);
