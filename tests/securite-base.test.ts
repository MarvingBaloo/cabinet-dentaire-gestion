import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// Ces tests ne vérifient pas du code applicatif : ils vérifient les garanties
// que PostgreSQL est censé fournir. Tant qu'ils n'existaient pas, « journal
// inviolable » et « moindre privilège » étaient des affirmations, pas des faits.
//
// Ils tournent contre la base de DÉVELOPPEMENT (NAS), avec des données
// synthétiques. Voir ARCHITECTURE.md D4 et D9.
//
// ⚠ Ils insèrent des lignes dans audit_log qu'ils ne peuvent PAS supprimer —
// c'est exactement ce qu'on cherche à démontrer. Ces lignes restent en base.

const OWNER_URL = process.env.DIRECT_DATABASE_URL
const APP_URL = process.env.DATABASE_URL

if (!OWNER_URL || !APP_URL) {
  throw new Error('DIRECT_DATABASE_URL et DATABASE_URL requis (.env.local)')
}

const MARQUEUR = `test-securite-${Date.now()}`

let owner: Client
let app: Client
let ligneTemoinId: string

/** Exécute et renvoie l'erreur attendue, ou échoue si la commande a réussi. */
async function doitEchouer(client: Client, sql: string): Promise<Error> {
  try {
    await client.query(sql)
  } catch (e) {
    return e as Error
  }
  throw new Error(`La commande aurait dû être refusée : ${sql}`)
}

beforeAll(async () => {
  owner = new Client({ connectionString: OWNER_URL })
  app = new Client({ connectionString: APP_URL })
  await owner.connect()
  await app.connect()

  const { rows } = await owner.query(
    `INSERT INTO audit_log (action, entity_type, ip_address, occurred_at)
     VALUES ('READ', $1, '127.0.0.1', now())
     RETURNING id`,
    [MARQUEUR],
  )
  ligneTemoinId = rows[0].id
})

afterAll(async () => {
  await owner.end()
  await app.end()
})

describe('journal d’audit — append-only', () => {
  it('le rôle applicatif peut écrire dans audit_log', async () => {
    const { rowCount } = await app.query(
      `INSERT INTO audit_log (action, entity_type, ip_address)
       VALUES ('LOGIN_SUCCESS', $1, '127.0.0.1')`,
      [MARQUEUR],
    )
    expect(rowCount).toBe(1)
  })

  it('le rôle applicatif ne peut PAS modifier une entrée', async () => {
    const e = await doitEchouer(
      app,
      `UPDATE audit_log SET action = 'DELETE' WHERE id = ${ligneTemoinId}`,
    )
    expect(e.message).toMatch(/permission denied|append-only/i)
  })

  it('le rôle applicatif ne peut PAS supprimer une entrée', async () => {
    const e = await doitEchouer(app, `DELETE FROM audit_log WHERE id = ${ligneTemoinId}`)
    expect(e.message).toMatch(/permission denied|append-only/i)
  })

  it('le rôle applicatif ne peut PAS vider la table', async () => {
    const e = await doitEchouer(app, 'TRUNCATE audit_log')
    expect(e.message).toMatch(/permission denied/i)
  })

  // Le REVOKE ne protège que du rôle applicatif. C'est le déclencheur qui
  // protège du propriétaire — donc d'une migration mal écrite ou d'un psql
  // ouvert à la hâte. Sans ces deux tests, on ne saurait pas qu'il fonctionne.
  it('même le PROPRIÉTAIRE ne peut pas modifier une entrée', async () => {
    const e = await doitEchouer(
      owner,
      `UPDATE audit_log SET action = 'DELETE' WHERE id = ${ligneTemoinId}`,
    )
    expect(e.message).toMatch(/append-only/i)
  })

  it('même le PROPRIÉTAIRE ne peut pas supprimer hors purge', async () => {
    const e = await doitEchouer(owner, `DELETE FROM audit_log WHERE id = ${ligneTemoinId}`)
    expect(e.message).toMatch(/append-only/i)
  })

  it('la ligne témoin est toujours là après toutes ces tentatives', async () => {
    const { rows } = await owner.query('SELECT action FROM audit_log WHERE id = $1', [
      ligneTemoinId,
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('READ') // inchangée
  })
})

describe('purge de rétention', () => {
  it('refuse une rétention sous 12 mois — un 0 viderait le journal', async () => {
    const e = await doitEchouer(owner, 'SELECT purge_audit_log(0)')
    expect(e.message).toMatch(/refus/i)
  })

  it('le rôle applicatif ne peut pas déclencher la purge', async () => {
    const e = await doitEchouer(app, 'SELECT purge_audit_log(36)')
    expect(e.message).toMatch(/permission denied/i)
  })
})

describe('moindre privilège du rôle applicatif', () => {
  it('ne possède aucune table — sinon les REVOKE seraient sans effet', async () => {
    const { rows } = await owner.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_roles r ON r.oid = c.relowner
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND r.rolname = 'cabinet_app'
    `)
    expect(rows).toEqual([])
  })

  it('ne peut pas créer de table (aucun droit DDL)', async () => {
    const e = await doitEchouer(app, 'CREATE TABLE tentative_ddl (id int)')
    expect(e.message).toMatch(/permission denied/i)
  })

  it('ne peut pas supprimer de table', async () => {
    const e = await doitEchouer(app, 'DROP TABLE session')
    expect(e.message).toMatch(/must be owner|permission denied/i)
  })

  // Le référentiel de droits en écriture, ce serait pouvoir se donner une
  // permission qu'on n'a pas. C'est le scénario d'escalade de privilèges le
  // plus direct qu'offre ce schéma.
  it('ne peut pas s’attribuer une permission', async () => {
    const e = await doitEchouer(
      app,
      `INSERT INTO permission (id, resource, action)
       VALUES (gen_random_uuid(), 'audit', 'destroy')`,
    )
    expect(e.message).toMatch(/permission denied/i)
  })

  it('ne peut pas modifier la matrice rôle → permission', async () => {
    const e = await doitEchouer(app, 'DELETE FROM role_permission')
    expect(e.message).toMatch(/permission denied/i)
  })

  it('peut en revanche LIRE le référentiel', async () => {
    const { rows } = await app.query('SELECT count(*)::int AS n FROM role_permission')
    expect(rows[0].n).toBeGreaterThan(0)
  })
})

describe('référentiel semé', () => {
  // ORDER BY name trierait par ordre de déclaration de l'enum, pas
  // alphabétiquement : d'où le cast en text.
  it('les 4 rôles internes existent, sans rôle PATIENT (D8)', async () => {
    const { rows } = await app.query('SELECT name FROM role ORDER BY name::text')
    expect(rows.map((r) => r.name)).toEqual(['ADMIN', 'ASSISTANTE', 'PRATICIEN', 'SECRETAIRE'])
  })

  it('les deux sites sont présents', async () => {
    const { rows } = await app.query('SELECT code FROM site ORDER BY code')
    expect(rows.map((r) => r.code)).toEqual(['GUADELOUPE', 'MARIE_GALANTE'])
  })

  // Depuis le 2026-10-19, le praticien simple n'administre plus (Q4) : le journal
  // revient au seul administrateur, que le titulaire cumule avec PRATICIEN.
  it('le journal d’audit n’est lisible que par ADMIN', async () => {
    const { rows } = await app.query(`
      SELECT r.name::text AS name
      FROM role r
      JOIN role_permission rp ON rp.role_id = r.id
      JOIN permission p ON p.id = rp.permission_id
      WHERE p.resource = 'audit' AND p.action = 'read'
      ORDER BY r.name::text
    `)
    expect(rows.map((r) => r.name)).toEqual(['ADMIN'])
  })

  it('seul l’administrateur écrit sur les comptes — ni le praticien simple, ni le secrétariat, ni l’assistanat', async () => {
    const { rows } = await app.query(`
      SELECT DISTINCT r.name::text AS name
      FROM role r
      JOIN role_permission rp ON rp.role_id = r.id
      JOIN permission p ON p.id = rp.permission_id
      WHERE p.resource = 'utilisateur' AND p.action <> 'read'
      ORDER BY r.name::text
    `)
    expect(rows.map((r) => r.name)).toEqual(['ADMIN'])
  })
})
