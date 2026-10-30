import { TriangleAlert } from 'lucide-react'

import { IconePoste, LignePoste } from '@/components/features/comptes/formulaire-poste'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { AccesReserve } from '@/components/ui/acces-reserve'
import { PermissionDeniedError, hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { listerPostes } from '@/server/queries/postes'
import { listerSites } from '@/server/queries/users'

export const metadata = { title: 'Postes de travail' }

const FUSEAU = 'America/Guadeloupe'
const jourCle = new Intl.DateTimeFormat('fr-CA', { timeZone: FUSEAU })
const heure = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: FUSEAU })
const jour = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short', timeZone: FUSEAU })

/** « aujourd’hui, 10:20 », « hier, 17:52 », « vendredi 9 oct., 15:31 ». */
function vuPourLaDerniereFois(date: Date | null, maintenant: Date): string {
  if (!date) return 'jamais'
  const cle = jourCle.format(date)
  const hier = new Date(maintenant.getTime() - 24 * 60 * 60 * 1000)
  const quand =
    cle === jourCle.format(maintenant) ? 'aujourd’hui' : cle === jourCle.format(hier) ? 'hier' : jour.format(date)
  return `${quand}, ${heure.format(date)}`
}

const court = (nom: string) => nom.replace(/^Cabinet (de |d’|d')/, '')

export default async function PagePostes() {
  const ctx = await exigerContexte()
  const peutModifier = hasPermission(ctx, 'workstation', 'update')

  let postes: Awaited<ReturnType<typeof listerPostes>>
  let sites: Awaited<ReturnType<typeof listerSites>>
  try {
    ;[postes, sites] = await Promise.all([listerPostes(ctx), listerSites(ctx)])
  } catch (e) {
    // Secrétaire ou assistante qui tape l'adresse : le refus est déjà tracé par la DAL.
    if (e instanceof PermissionDeniedError) return <AccesReserve titre="Postes de travail" />
    throw e
  }
  const listeSites = sites.map((s) => ({ id: s.id, code: s.code, nom: s.nom }))
  const maintenant = new Date()
  const actifs = postes.filter((p) => p.actif).length
  const sansSite = postes.filter((p) => p.actif && !p.site).length

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Postes de travail"
        chiffres={[
          { valeur: actifs, libelle: actifs > 1 ? 'postes actifs' : 'poste actif', cible: 'poste-actif' },
          { valeur: sansSite, libelle: 'sans site rattaché', alerte: true, cible: 'sans-site' },
        ]}
      >
        Chaque machine est enregistrée à sa première connexion. Le rattachement au site n’est pas décoratif : c’est de
        lui que le journal d’audit tire le site de chaque action.
      </BandeauReglages>

      {sansSite > 0 ? (
        <div
          role="status"
          className="carte-douce flex items-center gap-4 border-[#f0d9a8] bg-[#fffaf0] px-5 py-4 text-[0.9375rem] text-[#7a4a00] sm:px-6"
        >
          <span
            aria-hidden
            className="hexagone grid h-[2.75rem] w-[2.375rem] shrink-0 place-items-center bg-etat-alerte-fond text-etat-alerte"
          >
            <TriangleAlert className="size-[1.125rem]" strokeWidth={1.8} />
          </span>
          <p>
            {sansSite} poste{sansSite > 1 ? 's actifs' : ' actif'} sans site. Les actions faites depuis ces machines
            sont tracées sans indication de site.
          </p>
        </div>
      ) : null}

      <div className="carte-douce overflow-x-auto px-4 py-5 sm:px-6">
        <table className="w-full min-w-4xl text-[0.9375rem]">
          <thead>
            <tr className="border-b border-[#eef2f2] text-left text-xs tracking-[0.1em] text-muted-foreground uppercase">
              <th scope="col" className="px-4 py-3 font-semibold">
                Nom du poste
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Site
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                État
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Vu pour la dernière fois
              </th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {postes.map((poste) =>
              peutModifier && poste.actif ? (
                <LignePoste
                  key={poste.id}
                  poste={{ id: poste.id, nom: poste.nom, siteId: poste.site?.id ?? null }}
                  sites={listeSites}
                  vuLe={vuPourLaDerniereFois(poste.lastSeenAt, maintenant)}
                />
              ) : (
                <tr
                  key={poste.id}
                  data-cible={poste.actif ? (poste.site ? 'poste-actif' : 'poste-actif sans-site') : undefined}
                  className="border-b border-[#eef2f2] last:border-0"
                >
                  <td className="px-4 py-4 font-medium">
                    <span className="flex items-center gap-3">
                      <IconePoste rattache={!!poste.site} />
                      {poste.nom}
                    </span>
                  </td>
                  <td className={poste.site?.code === 'GUADELOUPE' ? 'px-4 py-4 text-[#5B3FB0]' : 'px-4 py-4'}>
                    {poste.site ? court(poste.site.nom) : <span className="text-muted-foreground">non rattaché</span>}
                  </td>
                  <td className="px-4 py-4">
                    <span
                      className={
                        poste.actif
                          ? 'rounded-full bg-etat-succes-fond px-2.5 py-0.5 text-[0.8125rem] font-semibold text-etat-succes'
                          : 'rounded-full bg-secondary px-2.5 py-0.5 text-[0.8125rem] font-semibold text-muted-foreground'
                      }
                    >
                      {poste.actif ? 'Actif' : 'Désactivé'}
                    </span>
                  </td>
                  <td className="px-4 py-4">{vuPourLaDerniereFois(poste.lastSeenAt, maintenant)}</td>
                  <td />
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
