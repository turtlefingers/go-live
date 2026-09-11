// esbuild 번들링 스크립트
// - 확장 코드는 dist/extension.js 하나로 번들한다
// - 런타임 의존성(tree-kill)까지 전부 번들하므로 vsix 에 node_modules 가 들어가지 않는다
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const test = process.argv.includes('--test');
const smoke = process.argv.includes('--smoke');

const common = {
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function main() {
  if (test) {
    // 단위 테스트: vscode 모듈에 의존하지 않는 순수 모듈만 대상
    await esbuild.build({
      ...common,
      entryPoints: ['test/unit/*.test.ts'],
      outdir: 'dist-test',
      external: ['vscode'],
      sourcemap: true,
      minify: false,
    });
    return;
  }

  if (smoke) {
    // 스모크 테스트: vscode 를 스텁으로 바꿔 실제 프로세스/서버를 띄운다
    await esbuild.build({
      ...common,
      entryPoints: [
        { in: 'test/smoke/npm-flow.ts', out: 'npm-flow' },
        { in: 'test/smoke/server-features.ts', out: 'server-features' },
        { in: 'test/smoke/kill-check.ts', out: 'kill-check' },
        { in: 'test/smoke/host-crash.ts', out: 'host-crash' },
        { in: 'test/smoke/host-crash-child.ts', out: 'host-crash-child' },
        { in: 'src/runner/watchdog.ts', out: 'watchdog' },
      ],
      outdir: 'dist-test',
      alias: { vscode: './test/smoke/vscode-stub.ts' },
      external: ['ws'],
      sourcemap: true,
      minify: false,
    });
    return;
  }

  const ctx = await esbuild.context({
    ...common,
    // watchdog.js 는 확장 호스트 밖에서 node 로 실행되는 독립 스크립트
    entryPoints: [
      { in: 'src/extension.ts', out: 'extension' },
      { in: 'src/runner/watchdog.ts', out: 'watchdog' },
    ],
    outdir: 'dist',
    external: ['vscode'],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
