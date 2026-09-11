// file:// 로 열면 전부 실패하는 것들: module import, fetch, 한글 경로 에셋
import { greet } from './lib.js';
const out = document.getElementById('out');
const data = await (await fetch('./data.json')).json();
const note = await (await fetch('./한글 폴더/노트.json')).json();
const glb = await fetch('./assets/모델.glb');
const wasm = await fetch('./assets/demo.wasm');
out.textContent = [greet(data.name), note.text, 'glb: ' + glb.headers.get('content-type'), 'wasm: ' + wasm.headers.get('content-type')].join('\n');
