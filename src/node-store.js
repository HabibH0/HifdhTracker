import { readFileSync, writeFileSync, renameSync, openSync, closeSync, unlinkSync, fsyncSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

/** Optional Node adapter. The domain engine itself imports no platform APIs. */
export class JsonFileStore {
  constructor(path) { this.path = path; }
  load() {
    try { return JSON.parse(readFileSync(this.path, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  save(document, expectedVersion) {
    const lockPath = `${this.path}.lock`, temporaryPath = `${this.path}.${randomUUID()}.tmp`;
    let lock, temporary;
    try {
      lock = openSync(lockPath, 'wx');
      if ((this.load()?.version ?? 0) !== expectedVersion) throw new Error('Concurrent update; reopen engine before retrying');
      temporary = openSync(temporaryPath, 'wx');
      writeFileSync(temporary, JSON.stringify(document, null, 2));
      fsyncSync(temporary);
      closeSync(temporary); temporary = undefined;
      renameSync(temporaryPath, this.path);
    } finally {
      if (temporary !== undefined) closeSync(temporary);
      try { unlinkSync(temporaryPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (lock !== undefined) { closeSync(lock); unlinkSync(lockPath); }
    }
  }
}
