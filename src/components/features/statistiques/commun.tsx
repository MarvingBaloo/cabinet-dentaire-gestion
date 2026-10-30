import { AccesReserve } from '@/components/ui/acces-reserve'
import { FiltresStatistiques } from '@/components/features/statistiques/filtres'
import { Message } from '@/components/ui/message'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import type { AuthContext } from '@/server/auth/context'
import { LIBELLE_PERIODE, PERIODES, type Granularite } from '@/server/domaine/statistiques'
import { SansFichePraticienError, type Demande, type Portee } from '@/server/queries/statistiques'

/** « par mois » : le pas des courbes, qui suit la période. */
export const PAR: Record<Granularite, string> = { jour: 'par jour', semaine: 'par semaine', mois: 'par mois' }

export type ParamsStatistiques = Promise<{ periode?: string; praticien?: string; cabinet?: string }>

/**
 * Lit un onglet des statistiques, ou rend l'écran qui dit pourquoi on ne le peut pas : secrétariat (refus
 * tracé par la DAL), ou praticien sans fiche d'agenda.
 */
export async function chargerOnglet<T extends { portee: Portee }>(
  titre: string,
  searchParams: ParamsStatistiques,
  lire: (ctx: AuthContext, demande: Demande) => Promise<T>,
): Promise<{ ok: true; resultat: T } | { ok: false; ecran: React.ReactNode }> {
  const ctx = await exigerContexte()
  try {
    return { ok: true, resultat: await lire(ctx, await searchParams) }
  } catch (e) {
    if (e instanceof PermissionDeniedError)
      return {
        ok: false,
        ecran: (
          <AccesReserve
            titre={titre}
            message={
              e.action === 'cabinet'
                ? 'Les chiffres d’un confrère ou de tout le cabinet sont réservés à l’administrateur.'
                : 'Les statistiques sont réservées aux praticiens et à l’administrateur.'
            }
          />
        ),
      }
    if (e instanceof SansFichePraticienError)
      return {
        ok: false,
        ecran: (
          <Message ton="info" role="status">
            Ce compte n’a pas de fiche praticien : il n’y a pas de rendez-vous à compter.
          </Message>
        ),
      }
    throw e
  }
}

export function EnTeteStatistiques({ portee, sousTitre }: { portee: Portee; sousTitre: string }) {
  const praticien =
    portee.choix.praticien === 'tous' ? 'tout le cabinet' : (portee.noms.praticiens.get(portee.choix.praticien) ?? '')
  return (
    <div className="space-y-3">
      <FiltresStatistiques
        periodes={PERIODES.map((p) => ({ valeur: p, libelle: LIBELLE_PERIODE[p] }))}
        praticiens={portee.options.praticiens}
        cabinets={portee.options.cabinets}
        choix={portee.choix}
      />
      <p className="text-[0.8125rem] text-muted-foreground">
        {sousTitre} — {praticien}
        {portee.options.cabinets.length > 1 && portee.choix.cabinet !== 'tous'
          ? `, ${portee.noms.sites.get(portee.choix.cabinet)}`
          : ''}
        . Comparé à la même période un an plus tôt.
      </p>
    </div>
  )
}
