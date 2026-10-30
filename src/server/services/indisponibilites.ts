import 'server-only'

import { bornesDuJour, instantCabinet } from '@/lib/dates'

import type { AuthContext } from '@/server/auth/context'
import { requirePermission } from '@/server/auth/permissions'
import { exigerAccesSite, peutVoirSite } from '@/server/auth/portee'
import { recordAudit } from '@/server/db/audit'
import { prisma } from '@/server/db/client'
import { STATUTS_ACTIFS_POUR_PRESENCE } from '@/server/domaine/presences'
import { rendezVousBloquesParIndisponibilite } from '@/server/domaine/indisponibilites'
import type { RendezVousConcerne } from '@/server/services/presences'
import type { CreerIndisponibiliteInput, SupprimerIndisponibiliteInput } from '@/server/validation/indisponibilites'

// Écriture des congés, fermetures et maintenances (compléments d'agenda,
// lot 2). Même enchaînement que le reste de l'agenda (D4, D5, D9, D11) :
// permission, portée, garde du domaine (Q5 — jamais de rendez-vous orphelin),
// puis écriture et trace dans la MÊME transaction.
//
// Permission réutilisée : `prisma/seed.ts` ne porte aucune ressource dédiée
// aux indisponibilités. `presence:*` couvre exactement le même geste et les
// mêmes personnes (Q4 — praticien et secrétaire, l'assistante suit la
// secrétaire) : poser un congé ou fermer un cabinet est de la même famille
// que saisir une semaine type.

export class IndisponibiliteBloqueeError extends Error {
  /**
   * D5/D49 : le blocage considère TOUJOURS tous les rendez-vous, quel que soit
   * leur site — sinon un congé praticien laisserait orpheliner un rendez-vous
   * sur le site qu'on ne détaille pas (Q5). Mais `rendezVous` ne LISTE que
   * ceux des sites dans la portée de l'appelant (`peutVoirSite`) : nom,
   * prénom et motif d'un patient d'un site hors portée sont une donnée que
   * l'appelant n'a pas le droit de lire (D5), même en sortie d'une erreur.
   * `horsPortee` compte les autres sans rien en dire de plus — pas même le
   * nom du site, qui n'est pas une donnée patient mais n'apporte rien ici.
   */
  constructor(
    readonly rendezVous: RendezVousConcerne[],
    readonly horsPortee = 0,
  ) {
    super(
      `Cette période concerne ${rendezVous.length + horsPortee} rendez-vous déjà posé(s). ` +
        'Déplacez-les ou annulez-les avant d’enregistrer.' +
        (horsPortee > 0
          ? ` Dont ${horsPortee} sur un cabinet auquel vous n’avez pas accès.`
          : ''),
    )
    this.name = 'IndisponibiliteBloqueeError'
  }
}

export class PeriodeInvalideError extends Error {
  constructor() {
    super('Période invalide.')
    this.name = 'PeriodeInvalideError'
  }
}

/**
 * L'instant de début et de fin voulus par la saisie : jours entiers (minuit à
 * minuit, bornes incluses) ou heures (une seule date civile). `null` sur une
 * saisie malformée — Zod l'a déjà écartée en amont, mais `instantCabinet`
 * garde cette possibilité et il ne faut pas la faire disparaître ici.
 */
function calculerPeriode(input: CreerIndisponibiliteInput): { debut: Date | null; fin: Date | null } {
  if (input.joursEntiers) {
    if (!input.dateFin) return { debut: null, fin: null }
    return { debut: bornesDuJour(input.dateDebut).debut, fin: bornesDuJour(input.dateFin).fin }
  }
  if (!input.heureDebut || !input.heureFin) return { debut: null, fin: null }
  return {
    debut: instantCabinet(input.dateDebut, input.heureDebut),
    fin: instantCabinet(input.dateDebut, input.heureFin),
  }
}

/**
 * Le ou les sites où un praticien a une présence ou un rendez-vous sur une
 * période — sert à poser `exigerAccesSite` pour un congé, qui ne porte pas de
 * site propre. Même principe que `siteApplicable` (`services/presences.ts`,
 * lot 1) : un praticien sans rien sur la période n'a rien à protéger, la
 * portée ne bloque alors personne.
 */
async function sitesDuPraticienSurPeriode(praticienId: string, debut: Date, fin: Date): Promise<string[]> {
  const [presences, rendezVous] = await Promise.all([
    prisma.plageDePresence.findMany({
      where: { praticienId, debut: { lt: fin }, fin: { gt: debut } },
      select: { siteId: true },
      distinct: ['siteId'],
    }),
    prisma.rendezVous.findMany({
      where: { praticienId, debut: { lt: fin }, fin: { gt: debut } },
      select: { siteId: true },
      distinct: ['siteId'],
    }),
  ])
  return [...new Set([...presences.map((p) => p.siteId), ...rendezVous.map((r) => r.siteId)])]
}

/**
 * Une fermeture de site exige l'accès à CE site (D5). Un congé praticien sans
 * site propre exige l'accès à AU MOINS UN des sites où il a une présence ou un
 * rendez-vous dans la période — « au moins un », comme demandé, pas tous :
 * c'est la même personne qui déclare le congé, pas un partage de portée par
 * site. Rien à protéger (aucun site trouvé) laisse passer, cohérent avec
 * `siteApplicable` du lot 1.
 */
async function verifierPortee(
  ctx: AuthContext,
  cible: { praticienId?: string | null; siteId?: string | null },
  debut: Date,
  fin: Date,
): Promise<void> {
  if (cible.siteId) {
    await exigerAccesSite(ctx, cible.siteId)
    return
  }
  if (cible.praticienId) {
    const sites = await sitesDuPraticienSurPeriode(cible.praticienId, debut, fin)
    if (sites.length === 0) return
    if (!sites.some((s) => peutVoirSite(ctx, s))) {
      // Journalise et lève, sur le premier site de la liste : la raison réelle
      // (aucun des sites trouvés n'est accessible) est moins précise qu'un
      // refus sur un seul site, mais `exigerAccesSite` reste l'unique endroit
      // qui sait tracer ce refus (même discipline que le reste de la DAL).
      await exigerAccesSite(ctx, sites[0]!)
    }
  }
}

export async function creerIndisponibilite(ctx: AuthContext, input: CreerIndisponibiliteInput) {
  await requirePermission(ctx, 'presence', 'create')

  const { debut, fin } = calculerPeriode(input)
  if (!debut || !fin || fin <= debut) throw new PeriodeInvalideError()

  await verifierPortee(ctx, { praticienId: input.praticienId ?? null, siteId: input.siteId ?? null }, debut, fin)

  const candidats = await prisma.rendezVous.findMany({
    where: {
      statut: { in: STATUTS_ACTIFS_POUR_PRESENCE },
      debut: { lt: fin },
      fin: { gt: debut },
    },
    select: {
      id: true,
      praticienId: true,
      siteId: true,
      debut: true,
      fin: true,
      patient: { select: { nom: true, prenom: true } },
      motif: { select: { libelle: true } },
    },
  })

  const bloques = rendezVousBloquesParIndisponibilite(candidats, {
    type: input.type,
    praticienId: input.praticienId ?? null,
    siteId: input.siteId ?? null,
    debut,
    fin,
  })

  if (bloques.length > 0) {
    const parId = new Map(candidats.map((r) => [r.id, r]))
    // D5/D49 : la garde anti-orphelin (Q5) reste calculée sur TOUS les sites
    // (`bloques`, ci-dessus) — mais le détail renvoyé à l'écran ne peut
    // porter que sur les sites que l'appelant a le droit de voir. Un congé
    // praticien touchant un rendez-vous d'un site hors de sa portée est donc
    // refusé comme les autres, sans en révéler le patient.
    const visibles = bloques.filter((b) => peutVoirSite(ctx, parId.get(b.id)!.siteId))
    const horsPortee = bloques.length - visibles.length
    const detail: RendezVousConcerne[] = visibles.map((b) => {
      const complet = parId.get(b.id)!
      return {
        id: b.id,
        debut: complet.debut,
        fin: complet.fin,
        patientNom: complet.patient.nom,
        patientPrenom: complet.patient.prenom,
        motifLibelle: complet.motif.libelle,
      }
    })
    throw new IndisponibiliteBloqueeError(detail, horsPortee)
  }

  return prisma.$transaction(async (tx) => {
    const creee = await tx.indisponibilite.create({
      data: {
        type: input.type,
        praticienId: input.praticienId ?? null,
        siteId: input.siteId ?? null,
        debut,
        fin,
        motif: input.motif ?? null,
      },
      select: { id: true },
    })

    await recordAudit(tx, ctx, {
      action: 'CREATE',
      entityType: 'indisponibilite',
      entityId: creee.id,
      metadata: { type: input.type, praticienId: input.praticienId ?? null, siteId: input.siteId ?? null },
    })

    return creee
  })
}

export async function supprimerIndisponibilite(ctx: AuthContext, input: SupprimerIndisponibiliteInput) {
  const existante = await prisma.indisponibilite.findUnique({
    where: { id: input.id },
    select: { id: true, type: true, praticienId: true, siteId: true, debut: true, fin: true },
  })
  if (!existante) throw new Error('Indisponibilité introuvable.')

  await requirePermission(ctx, 'presence', 'delete')
  // Une suppression ne peut qu'ouvrir de la disponibilité : aucune garde Q5
  // n'est nécessaire ici, contrairement à la création.
  await verifierPortee(ctx, existante, existante.debut, existante.fin)

  await prisma.$transaction(async (tx) => {
    await tx.indisponibilite.delete({ where: { id: existante.id } })

    await recordAudit(tx, ctx, {
      action: 'DELETE',
      entityType: 'indisponibilite',
      entityId: existante.id,
      metadata: { type: existante.type, praticienId: existante.praticienId, siteId: existante.siteId },
    })
  })
}
