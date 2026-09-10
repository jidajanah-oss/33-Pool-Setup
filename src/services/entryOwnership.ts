/** Legacy uid remains the immutable ledger identity; ownerUid controls access. */
export function entryOwner(data: { uid?: unknown; ownerUid?: unknown }): string {
  return typeof data.ownerUid === "string"
    ? data.ownerUid
    : typeof data.uid === "string" ? data.uid : "";
}
