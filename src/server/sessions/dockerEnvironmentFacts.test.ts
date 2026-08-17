import { describe, expect, it } from "vitest";
import { dockerEnvironmentFacts, dockerEnvironmentPromptSections, parseContainerMounts, type ContainerMount } from "./dockerEnvironmentFacts.js";

const MOUNT_INFO = [
  "1 0 0:1 / / rw,relatime - overlay overlay rw,lowerdir=/x,upperdir=/y",
  "2 1 0:2 / /proc rw,nosuid,nodev,noexec,relatime - proc proc rw",
  "3 1 0:3 / /sys ro,nosuid,nodev,noexec,relatime - sysfs sysfs ro,seclabel",
  "4 1 0:4 / /dev/shm rw,nosuid,nodev,noexec,relatime - tmpfs shm rw,size=65536k",
  "5 1 8:9 /opt /opt rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "6 1 8:9 /home /home rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "7 1 8:9 /srv /srv rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "8 1 8:9 /data /data rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "9 1 8:9 /repo /workspace rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "10 9 8:9 /volumes/node_modules /workspace/node_modules rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "11 1 8:9 /etc/resolv.conf /etc/resolv.conf rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "12 1 8:9 /docker.sock /run/docker.sock rw,nosuid,nodev - tmpfs tmpfs rw,mode=755",
  "13 1 8:9 /home/dev/checkout /home/dev/checkout rw,relatime - ext4 /dev/sda9 rw,seclabel",
  "14 1 0:5 / /host ro,relatime - btrfs /dev/sda9 rw,seclabel",
  "",
].join("\n");

const RUNTIME_ENV: NodeJS.ProcessEnv = {
  PI_WEB_DOCKER_RUNTIME: "1",
  PI_WEB_DOCKER_MODE: "runtime",
  PI_WEB_DOCKER_INSTALL_DIR: "/home/user/.local/share/pi-web-docker",
  HOSTEXEC_MODE: "nsenter",
  HOME: "/data/home",
  XDG_CONFIG_HOME: "/data/config",
  PI_CODING_AGENT_DIR: "/data/pi-agent",
};

const DEV_ENV: NodeJS.ProcessEnv = { ...RUNTIME_ENV, PI_WEB_DOCKER_MODE: "dev", PI_WEB_DOCKER_DEV_REPO_ROOT: "/home/user/projects/pi-web" };

function mounts(): ContainerMount[] {
  return parseContainerMounts(MOUNT_INFO);
}

function factsFor(env: NodeJS.ProcessEnv): string {
  const facts = dockerEnvironmentFacts({ env, mounts: mounts() });
  if (facts === undefined) throw new Error("expected environment facts for a Docker deployment");
  return facts;
}

describe("parseContainerMounts", () => {
  it("reads target, filesystem type, read-only state, and escaped targets", () => {
    expect(mounts()).toContainEqual({ target: "/host", fsType: "btrfs", readOnly: true });
    expect(parseContainerMounts("1 0 8:9 / /host\\040paths rw,relatime - ext4 /dev/sda9 rw\ninvalid")).toEqual([
      { target: "/host paths", fsType: "ext4", readOnly: false },
    ]);
  });
});

describe("dockerEnvironmentFacts", () => {
  it("adds nothing outside Docker", () => {
    expect(dockerEnvironmentFacts({ env: {}, mounts: mounts() })).toBeUndefined();
    expect(dockerEnvironmentFacts({ env: { PI_WEB_DOCKER_RUNTIME: "0" }, mounts: mounts() })).toBeUndefined();
  });

  it("describes persistence, host paths, host control, and ephemeral tooling", () => {
    const facts = factsFor(RUNTIME_ENV);
    expect(facts).toContain("act inside the PI WEB container, not on the Docker host");
    expect(facts).toContain("`/data` is a persistent mount that survives image rebuilds");
    expect(facts).toContain("mounted read/write at the same absolute path inside and outside the container: `/home`, `/opt`, `/srv`");
    expect(facts).not.toContain("/home/dev/checkout");
    expect(facts).not.toContain("/etc/resolv.conf");
    expect(facts).toContain("The Docker host root filesystem is mounted at `/host` read-only");
    expect(facts).toContain("The Docker socket is mounted");
    expect(facts).toContain("`hostexec [--root] <command...>` runs a command on the Docker host");
    expect(facts).toContain("custom-image.d/*.sh");
  });

  it("describes development checkout mounts and disabled hostexec", () => {
    const facts = factsFor({ ...DEV_ENV, HOSTEXEC_MODE: "disabled" });
    expect(facts).toContain("bind-mounted at `/workspace`. Its Docker host path is `/home/user/projects/pi-web`");
    expect(facts).toContain("`/workspace/node_modules` is a separate container-managed mount");
    expect(facts).toContain("`hostexec` is disabled in this deployment");
    expect(facts).toContain("`pi-web-docker --dev update`");
  });

  it("wraps facts in one tagged statement block", () => {
    const lines = factsFor(RUNTIME_ENV).split("\n");
    expect(lines[0]).toBe("<pi_web_docker_environment>");
    expect(lines.at(-1)).toBe("</pi_web_docker_environment>");
    expect(lines.slice(2, -1).every((line) => line.startsWith("- "))).toBe(true);
  });
});

describe("dockerEnvironmentPromptSections", () => {
  it("returns one section only for enabled Docker deployments", () => {
    expect(dockerEnvironmentPromptSections({ env: RUNTIME_ENV, enabled: true, readMountInfo: () => MOUNT_INFO })).toEqual([factsFor(RUNTIME_ENV)]);
    expect(dockerEnvironmentPromptSections({ env: RUNTIME_ENV, enabled: false, readMountInfo: () => MOUNT_INFO })).toEqual([]);
    expect(dockerEnvironmentPromptSections({ env: {}, enabled: true, readMountInfo: () => { throw new Error("must not read"); } })).toEqual([]);
  });

  it("warns and omits facts when mount inspection fails", () => {
    const warnings: string[] = [];
    expect(dockerEnvironmentPromptSections({
      env: RUNTIME_ENV,
      enabled: true,
      logger: { warn: (_details, message) => { warnings.push(message); } },
      readMountInfo: () => { throw new Error("EACCES"); },
    })).toEqual([]);
    expect(warnings).toEqual(["could not read the container mount table; Docker environment facts are omitted from session system prompts"]);
  });
});
