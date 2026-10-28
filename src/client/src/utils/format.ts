import { localization } from "../localization/browser";

export function formatTokenCount(count: number): string {
  return localization.number(Number.isFinite(count) ? count : 0, {
    notation: "compact", maximumFractionDigits: count >= 1000 && count < 10_000 || count >= 1_000_000 && count < 10_000_000 ? 1 : 0,
  });
}

/** Human-readable byte size shared by every workspace file surface. */
export function formatFileSize(size: number): string {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  if (size < 1024) return `${String(size)} B`;
  const kib = size / 1024;
  if (kib < 1024) return `${formatScaledFileSize(kib)} KB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${formatScaledFileSize(mib)} MB`;
  return `${formatScaledFileSize(mib / 1024)} GB`;
}

function formatScaledFileSize(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1);
}

export function formatCost(cost: number): string {
  const value = Number.isFinite(cost) ? cost : 0;
  const digits = value === 0 ? 0 : value < 0.01 ? 4 : 2;
  // Pi SDK costs are denominated in USD; formatting locale never selects currency.
  return localization.number(value, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits });
}
