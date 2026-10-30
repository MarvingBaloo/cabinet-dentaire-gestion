import { KeyRound, LogIn, Plus, ShieldAlert, type LucideIcon } from 'lucide-react'

import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { AccesReserve } from '@/components/ui/acces-reserve'
import { Pagination } from '@/components/ui/pagination'
import { FUSEAU_CABINET } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { compterJournal, lireActiviteRecente } from '@/server/queries/tableau-bord'

// Le journal des connexions et des créations (tour du 20/10). Il occupait le bas
// de l'Accueil du praticien, en jargon technique (« poste de confiance — second
// facteur non demandé ») : il vit désormais dans les Réglages, en phrases.

export const metadata = { title: 'Journal' }

const heure = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: FUSEAU_CABINET,
})

const CREATION: Record<string, string> = {
  agenda: 'a créé un rendez-vous',
  patient: 'a créé une fiche patient',
  liste_attente: 'a inscrit un patient sur la liste d’attente',
  user: 'a créé un compte',
  workstation: 'a enregistré un poste',
}

type Ligne = Awaited<ReturnType<typeof lireActiviteRecente>>[number]

function phrase(e: Ligne): { icone: LucideIcon; ton: 'normal' | 'alerte' | 'erreur'; texte: string; detail?: string } {
  const qui = e.personne ?? e.actorEmail ?? 'Quelqu’un'
  switch (e.action) {
    case 'LOGIN_SUCCESS':
      return {
        icone: LogIn,
        ton: 'normal',
        texte: `${qui} s’est connecté(e)`,
        detail: e.deniedReason?.includes('poste de confiance')
          ? 'sans code : poste déjà reconnu'
          : 'avec le code reçu par SMS',
      }
    case 'LOGIN_FAILURE':
      return {
        icone: KeyRound,
        ton: 'alerte',
        texte: `Connexion refusée pour ${e.actorEmail ?? 'une adresse inconnue'}`,
      }
    case 'PERMISSION_DENIED':
      return { icone: ShieldAlert, ton: 'erreur', texte: `${qui} a ouvert un écran qui ne lui est pas permis` }
    default:
      // Sans personne connectée : c'est le site public, donc un patient (réservation, liste d'attente).
      if (!e.actorEmail && e.entityType === 'agenda')
        return { icone: Plus, ton: 'normal', texte: 'Un patient a réservé en ligne' }
      if (!e.actorEmail && e.entityType === 'liste_attente')
        return { icone: Plus, ton: 'normal', texte: 'Un patient s’est inscrit sur la liste d’attente' }
      return { icone: Plus, ton: 'normal', texte: `${qui} ${CREATION[e.entityType ?? ''] ?? 'a créé un élément'}` }
  }
}

/** Lignes par page (Marving, 29/10 : « il faut de la pagination »). */
const PAR_PAGE = 30

export default async function PageJournal({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const ctx = await exigerContexte()

  let lignes: Ligne[]
  let total: number
  let refus: number
  let page: number
  let pages: number
  try {
    ;({ total, refus } = await compterJournal(ctx))
    pages = Math.max(1, Math.ceil(total / PAR_PAGE))
    // Une page hors bornes (adresse tapée, journal qui a raccourci) montre la plus proche.
    page = Math.min(pages, Math.max(1, Number.parseInt((await searchParams).page ?? '1', 10) || 1))
    lignes = await lireActiviteRecente(ctx, PAR_PAGE, (page - 1) * PAR_PAGE)
  } catch (e) {
    if (e instanceof PermissionDeniedError) return <AccesReserve titre="Journal" />
    throw e
  }

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Journal"
        chiffres={[
          { valeur: total, libelle: total > 1 ? 'actions' : 'action', cible: 'action' },
          { valeur: refus, libelle: refus > 1 ? 'refus' : 'refus', alerte: true, cible: 'refus' },
        ]}
      >
        Qui s’est connecté, depuis quel poste, et ce qui a été créé. Le journal complet est conservé et ne se modifie
        pas.
      </BandeauReglages>

      <section aria-label="Dernières actions" className="carte-douce px-5 py-4 sm:px-7">
        {pages > 1 ? (
          <p className="pt-1 pb-2 text-[0.8125rem] text-muted-foreground">
            Page {page} sur {pages} · actions {(page - 1) * PAR_PAGE + 1} à {Math.min(page * PAR_PAGE, total)}, de la
            plus récente à la plus ancienne
          </p>
        ) : null}
        {lignes.length === 0 ? (
          <p className="py-4 text-sm text-muted-foreground">Rien d’enregistré pour l’instant.</p>
        ) : (
          <ul className="divide-y divide-[#eef2f2]">
            {lignes.map((l) => {
              const { icone: Icone, ton, texte, detail } = phrase(l)
              return (
                <li
                  key={String(l.id)}
                  data-cible={l.action !== 'LOGIN_SUCCESS' && l.action !== 'CREATE' ? 'action refus' : 'action'}
                  className="flex items-center gap-4 py-3.5"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'hexagone grid h-[2.75rem] w-[2.375rem] shrink-0 place-items-center',
                      ton === 'normal' && 'bg-[#e4f1ee] text-[#387a70]',
                      ton === 'alerte' && 'bg-etat-alerte-fond text-etat-alerte',
                      ton === 'erreur' && 'bg-etat-erreur-fond text-etat-erreur',
                    )}
                  >
                    <Icone className="size-[1.125rem]" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{texte}</p>
                    <p className="text-[0.8125rem] text-muted-foreground">
                      {[detail, l.workstation ? `depuis ${l.workstation.nom}` : null, l.site?.nom]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  </div>
                  <time className="chiffres shrink-0 text-[0.8125rem] text-muted-foreground">
                    {heure.format(l.occurredAt)}
                  </time>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <Pagination
        page={page}
        pages={pages}
        href={(n) => (n === 1 ? '/tableau-de-bord/journal' : `/tableau-de-bord/journal?page=${n}`)}
      />
    </div>
  )
}
