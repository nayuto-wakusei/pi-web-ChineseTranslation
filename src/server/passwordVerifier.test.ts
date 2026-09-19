import { describe, expect, it, vi } from "vitest";
import { pbkdf2Sync } from "node:crypto";
import { PasswordVerifier, PasswordVerificationBusyError } from "./passwordVerifier.js";

describe("bounded password verification", () => {
  it("accepts existing hashes with non-default salt lengths without accepting wrong passwords", async () => {
    const salt = Buffer.from("legacy-salt");
    const hash = pbkdf2Sync("correct", salt, 120_000, 32, "sha256");
    const stored = `pbkdf2-sha256$120000$${salt.toString("base64url")}$${hash.toString("base64url")}`;
    const verifier = new PasswordVerifier();
    expect(await verifier.check("correct", stored, true)).toBe(true);
    expect(await verifier.check("wrong", stored, true)).toBe(false);
    expect(await verifier.check("anything", "pbkdf2-sha256$120000$c2FsdA$")).toBe(false);
  });

  it("coalesces concurrent credentials, caches success with fixed expiry and never caches failure", async () => {
    let now = 0;
    const verify = vi.fn((password: string) => Promise.resolve(password === "good"));
    const verifier = new PasswordVerifier(() => now, verify);
    expect(await Promise.all(Array.from({ length: 200 }, () => verifier.check("good", "hash", true)))).toEqual(Array(200).fill(true));
    expect(verify).toHaveBeenCalledTimes(1);
    now = 59_999;
    expect(await verifier.check("good", "hash", true)).toBe(true);
    now = 60_000;
    await verifier.check("good", "hash", true);
    expect(verify).toHaveBeenCalledTimes(2);
    await verifier.check("bad", "hash", true);
    await verifier.check("bad", "hash", true);
    expect(verify).toHaveBeenCalledTimes(4);
    await verifier.check("good", "changed-hash", true);
    expect(verify).toHaveBeenCalledTimes(5);
  });

  it("rejects stale in-flight verification and prevents repopulating the cache", async () => {
    let complete: (value: boolean) => void = () => { throw new Error("Not started"); };
    const verify = vi.fn(() => new Promise<boolean>((resolve) => { complete = resolve; }));
    const verifier = new PasswordVerifier(Date.now, verify);
    const pending = verifier.check("old", "hash", true);
    verifier.clear();
    complete(true);
    expect(await pending).toBe(false);
    const next = verifier.check("old", "hash", true);
    expect(verify).toHaveBeenCalledTimes(2);
    complete(true);
    expect(await next).toBe(true);
  });

  it("bounds active work and waiters and drains the queue", async () => {
    const completions: (() => void)[] = [];
    const verify = vi.fn(() => new Promise<boolean>((resolve) => { completions.push(() => { resolve(false); }); }));
    const verifier = new PasswordVerifier(Date.now, verify);
    const requests = Array.from({ length: 36 }, (_, i) => verifier.check(String(i), "hash"));
    expect(verify).toHaveBeenCalledTimes(4);
    await expect(verifier.check("overflow", "hash")).rejects.toBeInstanceOf(PasswordVerificationBusyError);
    for (let batch = 0; batch < 9; batch++) {
      completions.splice(0).forEach((complete) => { complete(); });
      await new Promise<void>((resolve) => { setImmediate(resolve); });
    }
    expect(await Promise.all(requests)).toEqual(Array(36).fill(false));
    expect(verify).toHaveBeenCalledTimes(36);
  });

  it("evicts old successful entries at the capacity limit", async () => {
    const verify = vi.fn(() => Promise.resolve(true));
    const verifier = new PasswordVerifier(Date.now, verify);
    for (let i = 0; i < 129; i++) await verifier.check(String(i), "hash", true);
    await verifier.check("0", "hash", true);
    expect(verify).toHaveBeenCalledTimes(130);
  });

  it("releases capacity after a verifier rejects", async () => {
    const verify = vi.fn().mockRejectedValueOnce(new Error("failure")).mockResolvedValue(true);
    const verifier = new PasswordVerifier(Date.now, verify);
    await expect(verifier.check("p", "h")).rejects.toThrow("failure");
    expect(await verifier.check("p", "h")).toBe(true);
  });

  it("serves warm successes while distinct misses saturate verification", async () => {
    const completions: (() => void)[] = [];
    const verifier = new PasswordVerifier(Date.now, (password) => password === "good"
      ? Promise.resolve(true)
      : new Promise<boolean>((resolve) => { completions.push(() => { resolve(false); }); }));
    await verifier.check("good", "hash", true);
    const pending = Array.from({ length: 36 }, (_, i) => verifier.check(String(i), "hash", true));
    expect(await verifier.check("good", "hash", true)).toBe(true);
    for (let batch = 0; batch < 9; batch++) {
      completions.splice(0).forEach((complete) => { complete(); });
      await new Promise<void>((resolve) => { setImmediate(resolve); });
    }
    await Promise.all(pending);
  });
});
