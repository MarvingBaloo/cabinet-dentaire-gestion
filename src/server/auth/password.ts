import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

// Pas de `server-only` ici, contrairement aux autres modules d'authentification :
// ce fichier ne lit aucune variable d'environnement et ne détient aucun secret,
// ce sont des fonctions pures. Le marquer server-only le rendrait inutilisable
// depuis les scripts d'amorçage (scripts/creer-admin.ts), sans rien protéger de
// plus — `node:crypto` n'existe de toute façon pas dans un navigateur.
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

// scrypt du cœur de Node plutôt qu'argon2 : argon2id serait préférable, mais
// impose une dépendance native à compiler dans l'image Docker. scrypt est une
// fonction de dérivation à coût mémoire, adaptée aux mots de passe, et déjà
// présente — contrairement à un simple SHA, qui serait une faute.
//
// Le remplacement par argon2id reste ouvert : tout le hachage est isolé dans ce
// module, et le préfixe de format ci-dessous permet de faire cohabiter les deux
// le jour où on migre.

const N = 16_384 // 2^14 — coût CPU/mémoire
const KEYLEN = 64
const SALT_BYTES = 16
const PREFIX = 'scrypt'

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const derived = await scrypt(password, salt, KEYLEN)
  return `${PREFIX}$${N}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== PREFIX) return false

  const salt = Buffer.from(parts[2] ?? '', 'base64')
  const expected = Buffer.from(parts[3] ?? '', 'base64')
  if (salt.length === 0 || expected.length === 0) return false

  const derived = await scrypt(password, salt, expected.length)

  // Comparaison à temps constant : une comparaison ordinaire s'arrête au premier
  // octet différent et laisse mesurer, essai après essai, à quel point on
  // approche du bon condensat.
  return timingSafeEqual(derived, expected)
}
