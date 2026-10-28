/** Snapshot configuration, retaining only display getters bound to their original receiver. */
export function snapshotDisplayMetadata<T extends object>(source: object, snapshot: T): T {
  for (const key of ["title", "name", "description", "group", "label", "disabledReason"] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor?.get === undefined) continue;
    Object.defineProperty(snapshot, key, {
      enumerable: true,
      configurable: true,
      get: descriptor.get.bind(source),
    });
  }
  return snapshot;
}
