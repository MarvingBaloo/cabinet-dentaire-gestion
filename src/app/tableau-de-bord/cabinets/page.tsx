import { CircleCheck, CircleOff } from 'lucide-react'

import { ActiviteCabinet } from '@/components/features/reglages/activite-cabinet'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { AccesReserve } from '@/components/ui/acces-reserve'
import { cn } from '@/lib/utils'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { listerCabinetsReglage } from '@/server/services/cabinets'

export const metadata = { title: 'Cabinets' }

const court = (nom: string) => nom.replace(/^Cabinet (de |d’|d')/, '')

// Les cabinets et leur réglage « En activité » (D74) : le seul écran où un cabinet décoché apparaît encore.
export default async function PageCabinets() {
  const ctx = await exigerContexte()

  let cabinets: Awaited<ReturnType<typeof listerCabinetsReglage>>
  try {
    cabinets = await listerCabinetsReglage(ctx)
  } catch (e) {
    if (e instanceof PermissionDeniedError) return <AccesReserve titre="Cabinets" />
    throw e
  }
  const enActivite = cabinets.filter((c) => c.actif).length

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Cabinets"
        chiffres={[
          { valeur: enActivite, libelle: 'en activité', cible: 'cabinet-actif' },
          { valeur: cabinets.length - enActivite, libelle: 'retiré', alerte: true, cible: 'cabinet-retire' },
        ]}
      >
        Un cabinet retiré n’apparaît plus nulle part : ni sur le site, ni dans la réservation en ligne, ni dans
        l’agenda, les patients ou les statistiques, pour personne. Ses rendez-vous et ses réglages restent enregistrés
        et reviennent dès qu’on le remet en activité.
      </BandeauReglages>

      <ul className="grid gap-4 md:grid-cols-2">
        {cabinets.map((c) => {
          const Icone = c.actif ? CircleCheck : CircleOff
          return (
            <li
              key={c.id}
              data-cible={c.actif ? 'cabinet-actif' : 'cabinet-retire'}
              className="carte-douce space-y-4 px-6 py-5"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-heading text-lg font-semibold">{c.nom}</h2>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {c._count.fauteuils} {c._count.fauteuils > 1 ? 'fauteuils' : 'fauteuil'}
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[0.8125rem] font-semibold whitespace-nowrap',
                    c.actif ? 'bg-etat-succes-fond text-etat-succes' : 'bg-muted text-muted-foreground',
                  )}
                >
                  <Icone aria-hidden className="size-4" strokeWidth={1.8} />
                  {c.actif ? 'En activité' : 'Retiré'}
                </span>
              </div>
              <ActiviteCabinet id={c.id} nom={court(c.nom)} actif={c.actif} />
            </li>
          )
        })}
      </ul>
    </div>
  )
}
