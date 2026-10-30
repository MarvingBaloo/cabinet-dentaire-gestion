import 'server-only'

import { StatutRendezVous } from '@prisma/client'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { filtreSite } from '@/server/auth/portee'
import { recordRead } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { bornesMois, decalerMois, moisDe, partDe } from '@/server/domaine/retrocession'

// La rétrocession (D81). Deux lectures, deux gardes :
//   - `statistiques:cabinet` : l'administrateur (le titulaire) voit le relevé de chaque praticien ;
//   - `statistiques:read` : un praticien voit le sien, et rien de ses confrères.
// Les soins comptés : passés en caisse dans le mois, avec leur montant validé.

export type SoinCompte = { id: string; debut: Date; patient: string; acte: string; montantCentimes: number }

export type LigneRetrocession = {
  praticien: { id: string; nom: string; couleur: string }
  part: number
  totalCentimes: number
  aVerserCentimes: number
  /** Les soins du mois, du plus ancien au plus récent. */
  soins: SoinCompte[]
  /** Passés en caisse sans montant (acte sans prix) : à corriger, ils ne comptent pas. */
  sansMontant: number
  versement: { montantCentimes: number; verseLe: Date } | null
}

async function soinsDuMois(ctx: AuthContext, praticienIds: string[], mois: string) {
  const { debut, fin } = bornesMois(mois)
  return prisma.rendezVous.findMany({
    where: {
      ...filtreSite(ctx),
      praticienId: { in: praticienIds },
      statut: StatutRendezVous.EN_CAISSE,
      encaisseLe: { gte: debut, lt: fin },
    },
    select: {
      id: true,
      debut: true,
      praticienId: true,
      montantCentimes: true,
      patient: { select: { prenom: true, nom: true } },
      motif: { select: { libelle: true } },
    },
    orderBy: { debut: 'asc' },
  })
}

function lignes(
  praticiens: { id: string; nom: string; prenom: string; couleur: string; partRetrocession: number | null }[],
  soins: Awaited<ReturnType<typeof soinsDuMois>>,
  versements: { praticienId: string; montantCentimes: number; verseLe: Date }[],
): LigneRetrocession[] {
  return praticiens.map((p) => {
    const siens = soins.filter((s) => s.praticienId === p.id)
    const comptes = siens.filter((s) => s.montantCentimes !== null)
    const totalCentimes = comptes.reduce((t, s) => t + s.montantCentimes!, 0)
    const versement = versements.find((v) => v.praticienId === p.id)
    return {
      praticien: { id: p.id, nom: `Dr ${p.prenom} ${p.nom}`, couleur: p.couleur },
      part: p.partRetrocession ?? 0,
      totalCentimes,
      aVerserCentimes: partDe(totalCentimes, p.partRetrocession ?? 0),
      soins: comptes.map((s) => ({
        id: s.id,
        debut: s.debut,
        patient: `${s.patient.prenom} ${s.patient.nom}`,
        acte: s.motif.libelle,
        montantCentimes: s.montantCentimes!,
      })),
      sansMontant: siens.length - comptes.length,
      versement: versement ? { montantCentimes: versement.montantCentimes, verseLe: versement.verseLe } : null,
    }
  })
}

/** Le relevé du cabinet pour un mois : une ligne par praticien qui a une part (le titulaire n'en a pas). */
export async function lireRetrocessionCabinet(ctx: AuthContext, mois: string): Promise<LigneRetrocession[]> {
  await requirePermission(ctx, 'statistiques', 'cabinet')
  const praticiens = await prisma.praticien.findMany({
    where: { partRetrocession: { not: null } },
    select: { id: true, nom: true, prenom: true, couleur: true, partRetrocession: true },
    orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
  })
  const ids = praticiens.map((p) => p.id)
  const [soins, versements] = await Promise.all([
    soinsDuMois(ctx, ids, mois),
    prisma.versementRetrocession.findMany({
      where: { praticienId: { in: ids }, mois },
      select: { praticienId: true, montantCentimes: true, verseLe: true },
    }),
  ])
  await recordRead(ctx, 'retrocession', praticiens.length)
  return lignes(praticiens, soins, versements)
}

export type MoisRetrocession = {
  mois: string
  totalCentimes: number
  aVerserCentimes: number
  verse: boolean
}

/**
 * La rétrocession du praticien connecté : ses douze derniers mois, et le détail du mois demandé. `null` s'il n'a
 * pas de fiche praticien ; `part: null` tant que l'administrateur ne l'a pas réglée.
 */
export async function lireMaRetrocession(ctx: AuthContext, moisDetail: string, maintenant = new Date()) {
  await requirePermission(ctx, 'statistiques', 'read')
  const moi = await prisma.praticien.findUnique({
    where: { userId: ctx.userId },
    select: { id: true, nom: true, prenom: true, couleur: true, partRetrocession: true },
  })
  if (!moi) return null

  const courant = moisDe(maintenant)
  const tous = Array.from({ length: 12 }, (_, i) => decalerMois(courant, -i))
  const { debut } = bornesMois(tous.at(-1)!)
  const { fin } = bornesMois(courant)
  const [soins, versements, detail] = await Promise.all([
    prisma.rendezVous.findMany({
      where: {
        ...filtreSite(ctx),
        praticienId: moi.id,
        statut: StatutRendezVous.EN_CAISSE,
        encaisseLe: { gte: debut, lt: fin },
        montantCentimes: { not: null },
      },
      select: { encaisseLe: true, montantCentimes: true },
    }),
    prisma.versementRetrocession.findMany({
      where: { praticienId: moi.id },
      select: { praticienId: true, mois: true, montantCentimes: true, verseLe: true },
    }),
    soinsDuMois(ctx, [moi.id], moisDetail),
  ])

  const part = moi.partRetrocession
  const historique: MoisRetrocession[] = tous.map((mois) => {
    const total = soins.filter((s) => moisDe(s.encaisseLe!) === mois).reduce((t, s) => t + s.montantCentimes!, 0)
    const verse = versements.find((v) => v.mois === mois)
    return {
      mois,
      totalCentimes: total,
      aVerserCentimes: verse?.montantCentimes ?? partDe(total, part ?? 0),
      verse: Boolean(verse),
    }
  })
  await recordRead(ctx, 'retrocession', 1, moi.id)
  return {
    part,
    historique,
    detail: lignes(
      [moi],
      detail,
      versements.filter((v) => v.mois === moisDetail),
    )[0]!,
  }
}

/** Les réglages : la part de chaque praticien, et le prix de chaque soin actif. */
export async function lireReglagesRetrocession(ctx: AuthContext) {
  await requirePermission(ctx, 'statistiques', 'cabinet')
  const [praticiens, motifs] = await Promise.all([
    prisma.praticien.findMany({
      where: { actif: true },
      select: { id: true, nom: true, prenom: true, couleur: true, partRetrocession: true, userId: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    }),
    prisma.motifConsultation.findMany({
      where: { actif: true },
      select: { id: true, libelle: true, prixCentimes: true },
      orderBy: [{ ordre: 'asc' }, { libelle: 'asc' }],
    }),
  ])
  await recordRead(ctx, 'retrocession', praticiens.length)
  return { praticiens, motifs }
}
