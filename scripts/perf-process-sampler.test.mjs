import { expect, it } from "vitest";
import { createProcessSampler } from "./perf-process-sampler.mjs";

it("keeps PID roles explicit and unavailable metrics null", async () => {
  const sampler = createProcessSampler({ loadtest: process.pid, missing: 2147483647 });
  await sampler.sample();
  await sampler.sample();
  expect(sampler.rows).toHaveLength(4);
  expect(sampler.rows[0].pid).toBe(process.pid);
  expect(sampler.rows[0].rssBytes).toBeGreaterThan(0);
  for (const row of sampler.rows.filter(r => r.role === "missing")) {
    expect(row.cpuPct).toBeNull();
    expect(row.rssBytes).toBeNull();
    expect(row.fdCount).toBeNull();
  }
  if (process.platform === "linux") {
    expect(sampler.rows[2].cpuPct).toBeGreaterThanOrEqual(0);
    expect(sampler.rows[2].fdCount).toBeGreaterThan(0);
  } else expect(sampler.rows[2].cpuPct).toBeNull();
});
