import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";

export function createProcessSampler(pids) {
  const hz = process.platform === "linux" ? Number(execFileSync("getconf", ["CLK_TCK"], { encoding: "utf8" }).trim()) : null;
  const previous = new Map();
  const rows = [];
  return { rows, async sample() {
    for (const [role, pid] of Object.entries(pids)) {
      const row = { timestamp: new Date().toISOString(), role, pid, cpuPct: null, rssBytes: null, fdCount: null };
      if (process.platform === "linux") {
        try {
          const [stat, status, fds] = await Promise.all([readFile(`/proc/${pid}/stat`, "utf8"), readFile(`/proc/${pid}/status`, "utf8"), readdir(`/proc/${pid}/fd`)]);
          const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
          const ticks = Number(fields[11]) + Number(fields[12]);
          const time = performance.now();
          const before = previous.get(role);
          if (before && before.start === fields[19]) row.cpuPct = (ticks - before.ticks) / hz / ((time - before.time) / 1000) * 100;
          previous.set(role, { ticks, time, start: fields[19] });
          row.rssBytes = Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1]) * 1024 || null;
          row.fdCount = fds.length;
        } catch { row.unavailable = true; }
      } else {
        if (pid === process.pid) row.rssBytes = process.memoryUsage().rss;
        row.note = "External PID metrics require Linux /proc";
      }
      rows.push(row);
    }
  } };
}
