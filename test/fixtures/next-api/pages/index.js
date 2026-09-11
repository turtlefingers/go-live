export async function getServerSideProps() {
  return { props: { renderedAt: new Date().toISOString() } };
}

export default function Home({ renderedAt }) {
  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <div className="card bg-base-100 shadow-sm">
        <div className="card-body space-y-2">
          <h1 className="card-title text-2xl">Next.js SSR</h1>
          <p className="text-base-content/70">이 시각은 브라우저가 아니라 서버에서 렌더링됐습니다.</p>
          <p id="ssr" className="font-mono text-sm">서버에서 렌더링됨: {renderedAt}</p>
          <a className="btn btn-secondary btn-sm w-fit" href="/api/hello">/api/hello 열기</a>
        </div>
      </div>
    </main>
  );
}
