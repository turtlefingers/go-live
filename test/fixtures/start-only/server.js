// dev 스크립트 없이 start 만 있는 경우. 의존성 없이 동작하는 최소 서버.
const http = require('http');
const port = Number(process.env.PORT) || 3456;
http
  .createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<h1>start-only</h1><p>npm start 로 실행됐습니다.</p>');
  })
  .listen(port, () => console.log(`Server running at http://localhost:${port}/`));
