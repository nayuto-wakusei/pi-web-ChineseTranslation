import { KNOWN_AUTO_INSTALLABLE_PI_PACKAGES, type KnownAutoInstallablePiPackage } from "./knownAutoInstallPiPackages.js";

/** Catalog metadata is shared with auto-install entries, but catalog membership grants no auto-install permission. */
export type KnownPiPackage = KnownAutoInstallablePiPackage;

/** Shipped packages offered by Settings. Optional entries must stay out of the auto-install allowlist. */
export const KNOWN_PI_PACKAGES: readonly KnownPiPackage[] = [
  ...KNOWN_AUTO_INSTALLABLE_PI_PACKAGES,
  {
    id: "@chainingintention/pi-captains-log",
    label: "船长日志",
    description: "将选中会话的最后回复转述为海盗风格，保留可见 Pi 消息记录。须手动安装并显式启用插件，模型调用可能产生费用。",
    shippedPathSegments: ["dist", "pi-packages", "captains-log"],
  },
];
