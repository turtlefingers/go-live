// 백엔드는 Vite 보다 먼저 뜨고 먼저 URL 을 찍는다. Go Live 는 이 주소가 아니라 Vite 의 Local 주소를 열어야 한다.
import express from 'express';
const app = express();
app.get('/api/hello', (_, res) => res.json({ from: 'backend', port: 3100 }));
app.listen(3100, () => console.log('API listening on http://localhost:3100'));
