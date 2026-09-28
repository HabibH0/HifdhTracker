/** Store contract: load() -> document|null; save(document, expectedVersion) must be atomic. */
export class MemoryStore {
  #document = null;
  load() { return structuredClone(this.#document); }
  save(document, expectedVersion) {
    if ((this.#document?.version ?? 0) !== expectedVersion) throw new Error('Concurrent update; reopen engine before retrying');
    this.#document = structuredClone(document);
  }
}
