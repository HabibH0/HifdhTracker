// Time-ordered, collision-resistant record IDs (UUIDv7 layout). Monotonic within one device,
// so events created in the same millisecond keep their creation order when sorted.
let lastMs = 0, counter = 0;

export function uuidv7(now = Date.now()) {
  if (now <= lastMs) { now = lastMs; counter++; } else { lastMs = now; counter = 0; }
  if (counter > 0xfff) { lastMs = now = lastMs + 1; counter = 0; }
  const rand = crypto.getRandomValues(new Uint8Array(8));
  const hex = n => n.toString(16).padStart(2, '0');
  const ms = now.toString(16).padStart(12, '0');
  const seq = (0x7000 | counter).toString(16);
  const variant = hex(0x80 | (rand[0] & 0x3f)) + hex(rand[1]);
  const tail = [...rand.slice(2)].map(hex).join('');
  return `${ms.slice(0, 8)}-${ms.slice(8)}-${seq}-${variant}-${tail}`;
}

export const isRecordId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$|^[0-9a-f-]{36}$/.test(id);
