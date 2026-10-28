import { KNOWN_AUTO_INSTALLABLE_PI_PACKAGES, type KnownAutoInstallablePiPackage } from "./knownAutoInstallPiPackages.js";

/** Catalog metadata is shared with auto-install entries, but catalog membership grants no auto-install permission. */
export type KnownPiPackage = KnownAutoInstallablePiPackage;

/** Shipped packages offered by Settings. Optional entries must stay out of the auto-install allowlist. */
export const KNOWN_PI_PACKAGES: readonly KnownPiPackage[] = [
  ...KNOWN_AUTO_INSTALLABLE_PI_PACKAGES,
];
