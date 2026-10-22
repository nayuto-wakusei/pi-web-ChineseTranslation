import { describe, expect, it } from "vitest";
import { dockerEnvironmentFacts, parseContainerMounts, type ContainerMount } from "./dockerEnvironmentFacts.js";

const env = { PI_WEB_DOCKER_RUNTIME: "1", PI_WEB_DOCKER_DEV_REPO_ROOT: "/home/user/projects/pi-web" };
const base = "1 0 8:9 /repo /workspace rw - ext4 /dev/sda9 rw";
const dependencies = "2 1 8:9 /var/lib/docker/volumes/dependencies/_data /workspace/node_modules rw - ext4 /dev/sda9 rw";
const alias = "/home/user/projects/pi-web/node_modules";
const facts = (mounts: readonly ContainerMount[]) => dockerEnvironmentFacts({ env, mounts });

describe("shared container dependency mapping", () => {
  it("explains that the host-looking checkout path shares container dependencies only when its exact mapping matches", () => {
    const mounts = parseContainerMounts([base, dependencies,
      `3 1 8:9 /var/lib/docker/volumes/dependencies/_data ${alias} rw - ext4 /dev/sda9 rw`,
    ].join("\n"));
    expect(facts(mounts)).toContain(`Inside this container, \`${alias}\` resolves to the same dependency mount as \`/workspace/node_modules\``);
    expect(facts(mounts)).toContain("Changes under either container path are visible at the other");
    expect(mounts[1]).toMatchObject({ device: "8:9", root: "/var/lib/docker/volumes/dependencies/_data", source: "/dev/sda9", fsType: "ext4" });
  });

  it.each([
    `3 1 8:9 /var/lib/docker/volumes/another/_data ${alias} rw - ext4 /dev/sda9 rw`,
    `3 1 8:10 /var/lib/docker/volumes/dependencies/_data ${alias} rw - ext4 /dev/sda9 rw`,
    `3 1 8:9 /var/lib/docker/volumes/dependencies/_data ${alias} rw - ext4 /dev/sdb1 rw`,
    `3 1 8:9 /var/lib/docker/volumes/dependencies/_data ${alias} rw - xfs /dev/sda9 rw`,
  ])("does not infer a shared volume from two node_modules targets: %s", (other) => {
    expect(facts(parseContainerMounts([base, dependencies, other].join("\n")))).not.toContain("same dependency mount");
  });

  it("does not infer a mapping from mount targets without identity metadata", () => {
    expect(facts([{ target: "/workspace", fsType: "ext4", readOnly: false },
      { target: "/workspace/node_modules", fsType: "ext4", readOnly: false },
      { target: alias, fsType: "ext4", readOnly: false },
    ])).not.toContain("same dependency mount");
  });

  it("does not claim that a shared host bind is isolated from the host", () => {
    const root = "/home/user/projects/pi-web/node_modules";
    const result = facts(parseContainerMounts([base,
      `2 1 8:9 ${root} /workspace/node_modules rw - ext4 /dev/sda9 rw`,
      `3 1 8:9 ${root} ${alias} rw - ext4 /dev/sda9 rw`,
    ].join("\n")));
    expect(result).toContain("same dependency mount");
    expect(result).not.toContain("Neither checkout path uses or modifies");
    expect(result).not.toContain("same container-managed dependency volume");
  });
});
