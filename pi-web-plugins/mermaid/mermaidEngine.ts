let enginePromise: Promise<string> | undefined;

export function loadMermaidEngine(): Promise<string> {
  enginePromise ??= fetch(new URL(/* @vite-ignore */ "./mermaidRuntime.js", import.meta.url), {
    signal: AbortSignal.timeout(30_000),
  }).then(async (response) => {
    if (!response.ok) throw new Error(`图表引擎不可用（${String(response.status)}）`);
    return response.text();
  }).catch((error: unknown) => {
    enginePromise = undefined;
    throw error;
  });
  return enginePromise;
}

export function mermaidFrameDocument(engine: string): string {
  const script = engine.replace(/<\/script/giu, "<\\/script");
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{margin:0}svg{max-width:100%;height:auto;display:block;margin:auto}</style></head><body><script>${script}</script></body></html>`;
}
