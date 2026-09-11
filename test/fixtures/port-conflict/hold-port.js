// 테스트 준비용: 별도 터미널에서 `node hold-port.js` 로 5173 을 점유한 뒤 Go Live 를 누른다.
import http from 'node:http';
http.createServer((_, res) => res.end('holding 5173')).listen(5173, () => console.log('holding http://localhost:5173 - Ctrl+C to release'));
