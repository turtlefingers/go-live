// HTTP 와 WebSocket 을 같은 포트에서.
// 브라우저 탭을 여러 개 열면 서로 채팅이 오가고, 공유 카운터가 모든 탭에서 동시에 바뀐다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(path.join(__dirname, 'index.html')));
});

const wss = new WebSocketServer({ server });
let counter = 0;
let nextId = 1;
const broadcast = (obj) => {
  const data = JSON.stringify(obj);
  for (const c of wss.clients) {
    if (c.readyState === 1) c.send(data);
  }
};

wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.send(JSON.stringify({ type: 'welcome', id: ws.id, counter }));
  broadcast({ type: 'presence', online: wss.clients.size, text: `#${ws.id} 님이 들어왔어요` });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'chat') broadcast({ type: 'chat', from: ws.id, text: String(msg.text).slice(0, 500) });
    if (msg.type === 'count') { counter += 1; broadcast({ type: 'counter', counter, by: ws.id }); }
    if (msg.type === 'typing') broadcast({ type: 'typing', from: ws.id });
  });
  ws.on('close', () => broadcast({ type: 'presence', online: wss.clients.size, text: `#${ws.id} 님이 나갔어요` }));
});

const port = Number(process.env.PORT) || 3200;
server.listen(port, () => console.log(`ws-chat running at http://localhost:${port}/`));
