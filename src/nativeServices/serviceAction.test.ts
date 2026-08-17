import { describe, expect, it } from "vitest";
import type { RunningComponentId } from "../piWebVersionReport.js";
import {
  awaitServicesReady,
  launchdServiceTarget,
  orderServices,
  performServiceAction,
  restartLaunchdService,
  ServiceCommandError,
  serviceRestartOrder,
  serviceStartOrder,
  serviceStopOrder,
  settleLaunchdServiceUnload,
  startLaunchdService,
  type LaunchdServiceContext,
  type LifecycleServiceRef,
  type ServiceActionDeps,
} from "./serviceAction.js";
import { nativeServiceManagerRefs, type NativeServiceBackend, type NativeServiceId } from "./servicePlan.js";

const systemdBackend: NativeServiceBackend = { kind: "systemd", label: "systemd user services" };
const launchdBackend: NativeServiceBackend = { kind: "launchd", label: "LaunchAgents" };

function ref(id: NativeServiceId): LifecycleServiceRef {
  return { id, ...nativeServiceManagerRefs[id] };
}

const launchdContext: LaunchdServiceContext = {
  domain: "gui/501",
  plistPath: (service) => `/LaunchAgents/${service.launchdPlistName}`,
};

interface RecordedCall {
  command: string;
  args: string[];
}

function fakeDeps(options: {
  runStatus?: (args: string[]) => number;
  quietStatus?: (args: string[]) => number;
  running?: (service: LifecycleServiceRef) => boolean;
  ready?: (component: RunningComponentId) => boolean;
} = {}): { calls: RecordedCall[]; sleeps: number[]; probes: RunningComponentId[]; deps: ServiceActionDeps } {
  const calls: RecordedCall[] = [];
  const sleeps: number[] = [];
  const probes: RunningComponentId[] = [];
  const deps: ServiceActionDeps = {
    run: (command, args) => {
      calls.push({ command, args });
      return options.runStatus?.(args) ?? 0;
    },
    runQuiet: (command, args) => {
      calls.push({ command, args });
      return options.quietStatus?.(args) ?? 0;
    },
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    isServiceRunning: (service) => options.running?.(service) ?? true,
    isComponentReady: (component) => {
      probes.push(component);
      return Promise.resolve(options.ready?.(component) ?? true);
    },
  };
  return { calls, sleeps, probes, deps };
}

function printSequence(statuses: readonly number[]): (args: string[]) => number {
  let index = 0;
  return (args) => {
    if (args[0] !== "print") return 0;
    const status = statuses[Math.min(index, statuses.length - 1)] ?? 1;
    index += 1;
    return status;
  };
}

describe("service lifecycle ordering", () => {
  it("keeps deliberate start, stop, and restart orders", () => {
    expect(serviceStartOrder).toEqual(["sessiond", "web", "uiDev"]);
    expect(serviceStopOrder).toEqual(["web", "uiDev", "sessiond"]);
    expect(serviceRestartOrder).toEqual(["web", "uiDev", "sessiond"]);
    expect(orderServices([ref("sessiond"), ref("uiDev")], serviceRestartOrder).map((item) => item.id)).toEqual(["uiDev", "sessiond"]);
  });
});

describe("launchd lifecycle", () => {
  it("waits for an asynchronous bootout to settle", async () => {
    const env = fakeDeps({ quietStatus: printSequence([0, 0, 1]) });

    await expect(settleLaunchdServiceUnload("gui/501/com.pi-web.web", env.deps, {
      launchdUnloadSettleTimeoutMs: 4,
      launchdUnloadSettleIntervalMs: 1,
    })).resolves.toBe(true);

    expect(env.sleeps).toEqual([1, 1]);
  });

  it("bootstraps an unloaded service before kickstart", () => {
    const env = fakeDeps({ quietStatus: printSequence([1]) });

    startLaunchdService(ref("web"), launchdContext, env.deps);

    expect(env.calls).toEqual([
      { command: "launchctl", args: ["print", "gui/501/com.pi-web.web"] },
      { command: "launchctl", args: ["bootstrap", "gui/501", "/LaunchAgents/com.pi-web.web.plist"] },
      { command: "launchctl", args: ["enable", "gui/501/com.pi-web.web"] },
      { command: "launchctl", args: ["kickstart", "gui/501/com.pi-web.web"] },
    ]);
  });

  it("settles restart before deciding to bootstrap", async () => {
    const env = fakeDeps({ quietStatus: printSequence([0, 1, 1]) });

    await restartLaunchdService(ref("web"), launchdContext, env.deps, {
      launchdUnloadSettleTimeoutMs: 3,
      launchdUnloadSettleIntervalMs: 1,
    });

    expect(env.calls.map((call) => call.args[0])).toEqual(["bootout", "print", "print", "print", "bootstrap", "enable", "kickstart"]);
  });

  it("propagates checked launchctl failures", () => {
    const env = fakeDeps({ quietStatus: printSequence([1]), runStatus: (args) => args[0] === "bootstrap" ? 36 : 0 });
    expect(() => {
      startLaunchdService(ref("web"), launchdContext, env.deps);
    }).toThrow(ServiceCommandError);
  });
});

describe("service readiness", () => {
  it("requires manager state before probing a component", async () => {
    let managerPoll = 0;
    const env = fakeDeps({
      running: () => {
        managerPoll += 1;
        return managerPoll > 1;
      },
    });

    await expect(awaitServicesReady([ref("sessiond")], env.deps, {
      readinessTimeoutMs: 3,
      readinessIntervalMs: 1,
    })).resolves.toEqual([]);

    expect(env.probes).toEqual(["sessiond"]);
    expect(env.sleeps).toEqual([1]);
  });

  it("returns services that never become responsive", async () => {
    const env = fakeDeps({ ready: () => false });
    const pending = await awaitServicesReady([ref("web"), ref("sessiond")], env.deps, {
      readinessTimeoutMs: 2,
      readinessIntervalMs: 1,
    });
    expect(pending.map((item) => item.id)).toEqual(["web", "sessiond"]);
  });
});

describe("performServiceAction", () => {
  it("restarts systemd units in the safe order and verifies readiness", async () => {
    const env = fakeDeps();
    const result = await performServiceAction({
      backend: systemdBackend,
      action: "restart",
      refs: [ref("sessiond"), ref("web")],
      launchdContext,
    }, env.deps, { readinessTimeoutMs: 1, readinessIntervalMs: 1 });

    expect(env.calls[0]).toEqual({
      command: "systemctl",
      args: ["--user", "restart", "pi-web.service", "pi-web-sessiond.service"],
    });
    expect(env.probes).toEqual(["web", "sessiond"]);
    expect(result.unreadyServices).toEqual([]);
  });

  it("does not run readiness probes for stop", async () => {
    const env = fakeDeps();
    const result = await performServiceAction({
      backend: launchdBackend,
      action: "stop",
      refs: [ref("sessiond"), ref("web")],
      launchdContext,
    }, env.deps);

    expect(env.calls).toEqual([
      { command: "launchctl", args: ["bootout", launchdServiceTarget("gui/501", ref("web"))] },
      { command: "launchctl", args: ["bootout", launchdServiceTarget("gui/501", ref("sessiond"))] },
    ]);
    expect(env.probes).toEqual([]);
    expect(result.unreadyServices).toEqual([]);
  });
});
