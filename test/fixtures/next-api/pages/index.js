export async function getServerSideProps() {
  return { props: { renderedAt: new Date().toISOString() } };
}
export default function Home({ renderedAt }) {
  return (
    <main>
      <h1>Next.js SSR</h1>
      <p id="ssr">서버에서 렌더링됨: {renderedAt}</p>
    </main>
  );
}
