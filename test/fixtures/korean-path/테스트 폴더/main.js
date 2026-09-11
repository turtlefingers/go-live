// 저장하면 Vite HMR 로 반영됩니다. 아래 문구를 바꿔 보세요.
const message = '안녕하세요, Vite 프로젝트예요 👋';

document.querySelector('#app').innerHTML = `
  <div class="card bg-base-100 shadow-sm">
    <div class="card-body space-y-3">
      <h1 class="card-title text-2xl">${message}</h1>
      <p class="text-base-content/70">Go Live 가 <code>npm install</code> 과 <code>npm run dev</code> 를 대신 실행했고, 브라우저를 열어줬습니다.</p>
      <div class="stats bg-base-200 rounded-box">
        <div class="stat"><div class="stat-title">페이지 로드</div><div class="stat-value text-lg" id="time">${new Date().toLocaleTimeString()}</div><div class="stat-desc">main.js 를 저장하면 갱신</div></div>
        <div class="stat"><div class="stat-title">클릭</div><div class="stat-value text-lg" id="count">0</div><div class="stat-desc">HMR 뒤에도 유지되나 확인</div></div>
      </div>
      <button class="btn btn-secondary" id="btn">+1</button>
    </div>
  </div>
`;
let n = 0;
document.querySelector('#btn').onclick = () => { document.querySelector('#count').textContent = String(++n); };
