import Link from 'next/link'

import {
  type LigneVue,
  MaRetrocession,
  NavigationMois,
  ReleveCabinet,
} from '@/components/features/retrocession/retrocession'
import { AccesReserve } from '@/components/ui/acces-reserve'
import { Message } from '@/components/ui/message'
import { FUSEAU_CABINET } from '@/lib/dates'
import { hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { decalerMois, moisDe, moisEnClair, moisValide } from '@/server/domaine/retrocession'
import { type LigneRetrocession, lireMaRetrocession, lireRetrocessionCabinet } from '@/server/queries/retrocession'

// La rétrocession (D81, maquette du 28/10) : l'administrateur voit le relevé du mois de chaque praticien et le
// marque versé ; un praticien voit le sien, mois par mois. La secrétaire n'a pas l'onglet.

export const metadata = { title: 'Statistiques — Rétrocession' }

const jour = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU_CABINET, weekday: 'short', day: 'numeric', month: 'long' })
const date = new Intl.DateTimeFormat('fr-FR', { timeZone: FUSEAU_CABINET, day: 'numeric', month: 'long' })

function vue(l: LigneRetrocession): LigneVue {
  return {
    ...l,
    soins: l.soins.map((s) => ({ ...s, jour: jour.format(s.debut) })),
    versement: l.versement ? { montantCentimes: l.versement.montantCentimes, le: date.format(l.versement.verseLe) } : null,
  }
}

export default async function PageRetrocession({ searchParams }: { searchParams: Promise<{ mois?: string }> }) {
  const ctx = await exigerContexte()
  const maintenant = new Date()
  const mois = moisValide((await searchParams).mois, maintenant)
  const courant = moisDe(maintenant)

  if (hasPermission(ctx, 'statistiques', 'cabinet')) {
    const lignes = await lireRetrocessionCabinet(ctx, mois)
    return (
      <div className="max-w-(--largeur-page) space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-bold">Rétrocession</h1>
          <NavigationMois
            precedent={decalerMois(mois, -1)}
            suivant={mois < courant ? decalerMois(mois, 1) : null}
            libelle={moisEnClair(mois)}
          />
        </header>
        {lignes.length === 0 ? (
          <Message ton="info" role="status">
            Aucun praticien n’a de part réglée.{' '}
            <Link href="/tableau-de-bord/reglages-retrocession" className="font-semibold underline-offset-4 hover:underline">
              Réglez-la dans Réglages → Rétrocession
            </Link>
            .
          </Message>
        ) : (
          <ReleveCabinet lignes={lignes.map(vue)} mois={mois} />
        )}
        <p className="text-[0.8125rem] text-muted-foreground">
          Soins passés en caisse dans le mois × part du praticien. Le titulaire n’a pas de ligne : il ne se reverse rien.
          {mois === courant ? ' Le mois en cours se remplit au fil des jours.' : ''}
        </p>
      </div>
    )
  }

  if (!hasPermission(ctx, 'statistiques', 'read')) {
    return <AccesReserve titre="Rétrocession" message="La rétrocession est réservée aux praticiens et à l’administrateur." />
  }
  const mien = await lireMaRetrocession(ctx, mois, maintenant)
  return (
    <div className="max-w-[60rem] space-y-5">
      <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-bold">Ma rétrocession</h1>
      {mien ? (
        <MaRetrocession
          part={mien.part}
          historique={mien.historique.map((m) => ({ ...m, libelle: moisEnClair(m.mois) }))}
          choisi={mois}
          detail={vue(mien.detail)}
        />
      ) : (
        <Message ton="info" role="status">
          Ce compte n’a pas de fiche praticien : il n’y a rien à reverser.
        </Message>
      )}
    </div>
  )
}
