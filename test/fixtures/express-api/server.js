// 서버가 있어야만 동작하는 기능: API 라우트. file:// 로 열면 fetch('/api/hello') 가 실패한다.
const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
app.get('/api/hello', (req, res) => res.json({ message: '안녕하세요', from: 'express', time: Date.now() }));
app.post('/api/echo', (req, res) => res.json({ echo: req.body }));
app.use(express.static(path.join(__dirname, 'public')));
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`Server listening on http://localhost:${port}`));
