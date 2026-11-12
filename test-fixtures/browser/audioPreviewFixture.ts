import type { Plugin } from "vite";

/** Use HTTP for media: WebKit's native loader can bypass Playwright routes. */
export function audioPreviewFixture(): Plugin {
  const wave = silentWave();
  return {
    name: "audio-preview-fixture",
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? "/", "http://fixture.invalid");
        if (url.pathname !== "/api/machines/local/paired-plugin-backends/pi-web.audio/projects/p/workspaces/w/resources/audio.read") {
          next();
          return;
        }
        if (url.searchParams.get("revision") !== "audio-fixture-r1") {
          response.writeHead(404).end();
          return;
        }
        const range = /^bytes=(\d+)-(\d*)$/u.exec(request.headers.range ?? "");
        const start = Number(range?.[1] ?? 0);
        const endText = range?.[2];
        const end = endText === undefined || endText === "" ? wave.length - 1 : Math.min(Number(endText), wave.length - 1);
        if (start > end) {
          response.writeHead(416, { "content-range": `bytes */${String(wave.length)}` }).end();
          return;
        }
        const body = wave.subarray(start, end + 1);
        response.writeHead(range === null ? 200 : 206, {
          "content-type": "audio/wav", "content-length": body.length, "accept-ranges": "bytes",
          ...(range === null ? {} : { "content-range": `bytes ${String(start)}-${String(end)}/${String(wave.length)}` }),
        }).end(body);
      });
    },
  };
}

function silentWave(): Buffer {
  const sampleRate = 8_000;
  const sampleBytes = sampleRate * 4 * 2;
  const bytes = Buffer.alloc(44 + sampleBytes);
  bytes.write("RIFF", 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24); bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36); bytes.writeUInt32LE(sampleBytes, 40);
  return bytes;
}
