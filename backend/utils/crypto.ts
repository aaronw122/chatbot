import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// AES-256-GCM encryption for at-rest API keys.
// Key source: process.env.ENCRYPTION_KEY — base64 that decodes to exactly 32 bytes.
// Generate one with: openssl rand -base64 32
//
// Wire format of the returned blob: base64(iv).base64(authTag).base64(ciphertext)
// joined with '.' separators. IV is a random 12 bytes (GCM standard).

const ALGORITHM = 'aes-256-gcm'
const IV_LENGTH = 12
const KEY_LENGTH = 32

// Resolve and validate the key eagerly on first use. Throws a clear error if the
// env var is missing or not exactly 32 bytes after base64-decoding.
function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Generate one with `openssl rand -base64 32` and set ENCRYPTION_KEY.'
    )
  }
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_LENGTH} bytes (got ${key.length}). Generate one with \`openssl rand -base64 32\`.`
    )
  }
  return key
}

export function encrypt(plaintext: string): string {
  const key = getKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join('.')
}

export function decrypt(blob: string): string {
  const key = getKey()
  const parts = blob.split('.')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted blob format')
  }
  const [ivB64, authTagB64, ciphertextB64] = parts as [string, string, string]
  const iv = Buffer.from(ivB64, 'base64')
  const authTag = Buffer.from(authTagB64, 'base64')
  const ciphertext = Buffer.from(ciphertextB64, 'base64')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  // .final() throws if the authTag does not verify (tamper detection).
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  return plaintext.toString('utf8')
}
