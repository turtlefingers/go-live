// HTTP 와 WebSocket 을 같은 포트에서.
// 브라우저 탭을 여러 개 열면 서로 채팅이 오가고, 공유 카운터가 모든 탭에서 동시에 바뀐다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const NAMES = ['토끼', '고양이', '펭귄', '수달', '햄스터', '판다', '여우', '코알라', '강아지', '다람쥐'];
const EMOJIS = ['🐰', '🐱', '🐧', '🦦', '🐹', '🐼', '🦊', '🐨', '🐶', '🐿️'];

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});

const wss = new WebSocketServer({ server });
let counter = 0;
let nextId = 1;
const history = [];
const broadcast = (obj) => {
  const data = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(data);
  }
};
const userOf = (ws) => ({ id: ws.id, name: NAMES[(ws.id - 1) % NAMES.length], emoji: EMOJIS[(ws.id - 1) % EMOJIS.length] });

wss.on('connection', (ws) => {
  ws.id = nextId++;
  const me = userOf(ws);
  ws.send(JSON.stringify({ type: 'welcome', id: me.id, name: me.name, emoji: me.emoji, counter, history: history.slice(-30) }));
  broadcast({ type: 'presence', who: me.id, online: wss.clients.size, text: `${me.emoji} ${me.name} 님이 들어왔어요` });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'chat') {
      const text = String(msg.text).slice(0, 500);
      const entry = { type: 'chat', from: me.id, name: me.name, emoji: me.emoji, text, at: Date.now() };
      history.push(entry);
      broadcast(entry);
    }
    if (msg.type === 'count') { counter += 1; broadcast({ type: 'counter', counter, by: me.id, name: me.name }); }
    if (msg.type === 'typing') broadcast({ type: 'typing', from: me.id, name: me.name });
  });
  ws.on('close', () => broadcast({ type: 'presence', who: me.id, online: wss.clients.size, text: `${me.emoji} ${me.name} 님이 나갔어요` }));
});

const port = Number(process.env.PORT) || 3200;
server.listen(port, () => console.log(`ws-chat running at http://localhost:${port}/`));
