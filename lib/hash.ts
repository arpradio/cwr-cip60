import { createHash } from 'crypto'

// Content fingerprint for a parsed work's source material — lets downstream
// consumers detect whether the underlying input changed. Not a security hash,
// just a stable short digest.
export function hashInput(input: unknown): string {
  const data = typeof input === 'string' ? input : JSON.stringify(input)
  return createHash('sha256').update(data).digest('hex').slice(0, 16)
}
