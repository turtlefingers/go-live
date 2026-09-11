import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="ko" data-theme="cupcake">
      <Head>
        <link href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css" rel="stylesheet" />
        <link href="https://cdn.jsdelivr.net/npm/daisyui@5/daisyui.css" rel="stylesheet" type="text/css" />
        <script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>
        <style>{`
          [data-theme="cupcake"] { --color-base-100:#F5F5F5; --color-base-200:#EBEBEB; --color-base-300:#D0D0D0; --color-base-content:#1E1E1E;
            --color-primary:#1E1E1E; --color-primary-content:#F5F5F5; --color-secondary:#3DDC84; --color-secondary-content:#0B2E1B;
            --color-accent:#FFB86B; --color-accent-content:#3A2200; --radius-box:1.25rem; --radius-field:1rem; --radius-selector:1rem; }
          body { font-family: "Pretendard", system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif; }
        `}</style>
      </Head>
      <body className="min-h-screen bg-base-200">
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
