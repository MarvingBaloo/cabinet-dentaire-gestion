import { Check, UserPlus } from 'lucide-react'

import { ChangerTelephone } from '@/components/features/comptes/changer-telephone'
import { FormulaireCreation } from '@/components/features/comptes/formulaire-creation'
import { Initiales, TitreAlveole } from '@/components/features/patients/alveoles'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { AccesReserve } from '@/components/ui/acces-reserve'
import { LIBELLE_ROLE } from '@/lib/roles'
import { cn } from '@/lib/utils'
import { desactiverCompteAction, reactiverCompteAction, reinitialiserMfaAction } from '@/server/actions/comptes'
import { PermissionDeniedError, hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { lireCabinetChoisi } from '@/server/cabinet-choisi'
import { listerSites, listerUtilisateurs } from '@/server/queries/users'

export const metadata = { title: 'Comptes du personnel' }

const RANG: Record<string, number> = { PRATICIEN: 0, SECRETAIRE: 1, ASSISTANTE: 2, ADMIN: 3 }

const TEINTE_ROLE: Record<string, string> = {
  PRATICIEN: 'bg-[#e8f2fc] text-[#1d4f8a]',
  SECRETAIRE: 'bg-secondary text-foreground',
  ASSISTANTE: 'bg-secondary text-foreground',
  ADMIN: 'bg-[#EFEAFB] text-[#5B3FB0]',
}

const PASTILLE = 'rounded-full px-2.5 py-0.5 text-[0.8125rem] font-semibold whitespace-nowrap'
const boutonAction = 'inline-flex h-9 items-center rounded-full border bg-white px-4 text-sm font-semibold whitespace-nowrap'

export default async function PageComptes() {
  const ctx = await exigerContexte()

  // Les fonctions de la DAL portent leur propre garde et lèveraient. On teste ici
  // uniquement pour ne pas AFFICHER ce que la personne ne pourra pas faire — le
  // contrôle réel reste côté serveur, jamais dans le composant (D4).
  const peutCreer = hasPermission(ctx, 'utilisateur', 'create')
  const peutModifier = hasPermission(ctx, 'utilisateur', 'update')

  let donnees: [
    Awaited<ReturnType<typeof listerUtilisateurs>>,
    Awaited<ReturnType<typeof listerSites>>,
    Awaited<ReturnType<typeof lireCabinetChoisi>>,
  ]
  try {
    donnees = await Promise.all([listerUtilisateurs(ctx), listerSites(ctx), lireCabinetChoisi(ctx)])
  } catch (e) {
    // Secrétaire ou assistante qui tape l'adresse (D67) : le refus est déjà tracé par la DAL.
    if (e instanceof PermissionDeniedError) return <AccesReserve titre="Comptes du personnel" />
    throw e
  }
  const [utilisateurs, sites, { choisi }] = donnees
  const rang = (u: (typeof utilisateurs)[number]) => Math.min(...u.roles.map(({ role }) => RANG[role.name] ?? 9))
  const tries = [...utilisateurs].sort((a, b) => Number(!a.actif) - Number(!b.actif) || rang(a) - rang(b))
  const actifs = utilisateurs.filter((u) => u.actif)
  const sansMfa = actifs.filter((u) => !u.mfaEnrolledAt).length

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Comptes du personnel"
        chiffres={[
          { valeur: actifs.length, libelle: actifs.length > 1 ? 'comptes actifs' : 'compte actif', cible: 'compte-actif' },
          { valeur: sansMfa, libelle: 'double authentification à configurer', alerte: true, cible: 'sans-mfa' },
        ]}
        action={
          peutCreer ? (
            <a
              href="#ajouter"
              className="inline-flex h-11 items-center rounded-full bg-white px-5 font-semibold text-[#387a70] hover:bg-white/90"
            >
              + Ajouter une personne
            </a>
          ) : null
        }
      >
        Les comptes se désactivent, ne se suppriment jamais : le journal d’audit y fait référence sur des années
        d’historique.
      </BandeauReglages>

      <div className="carte-douce overflow-x-auto px-4 py-5 sm:px-6">
        <table className="w-full min-w-4xl text-[0.9375rem]">
          <thead>
            <tr className="border-b border-[#eef2f2] text-left text-xs tracking-[0.1em] text-muted-foreground uppercase">
              <th scope="col" className="px-4 py-3 font-semibold">
                Personne
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Rôles
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                Double authentification
              </th>
              <th scope="col" className="px-4 py-3 font-semibold">
                État
              </th>
              {peutModifier ? (
                <th scope="col" className="px-4 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {tries.map((u) => (
              <tr
                key={u.id}
                data-cible={u.actif ? (u.mfaEnrolledAt ? 'compte-actif' : 'compte-actif sans-mfa') : undefined}
                className={cn('border-b border-[#eef2f2] last:border-0', !u.actif && 'text-muted-foreground')}
              >
                <td className="px-4 py-3.5">
                  <div className="flex items-center gap-3.5">
                    <Initiales prenom={u.prenom} nom={u.nom} />
                    <div>
                      <p className="font-semibold">
                        {u.prenom} {u.nom}
                      </p>
                      <p className="text-[0.8125rem] text-muted-foreground">{u.email}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <div className="flex gap-1.5">
                    {[...u.roles]
                      .sort((a, b) => (RANG[a.role.name] ?? 9) - (RANG[b.role.name] ?? 9))
                      .map(({ role }) => (
                        <span key={role.name} className={cn(PASTILLE, TEINTE_ROLE[role.name])}>
                          {LIBELLE_ROLE[role.name as keyof typeof LIBELLE_ROLE]}
                        </span>
                      ))}
                  </div>
                </td>
                <td className="px-4 py-4">
                  {u.mfaEnrolledAt ? (
                    <span className="inline-flex items-center gap-1.5 text-etat-succes">
                      <Check aria-hidden className="size-4" /> Activée · SMS
                    </span>
                  ) : (
                    <span className={cn(PASTILLE, 'bg-etat-alerte-fond text-etat-alerte')}>à configurer</span>
                  )}
                </td>
                <td className="px-4 py-4">
                  {u.actif ? (
                    <span className={cn(PASTILLE, 'bg-etat-succes-fond text-etat-succes')}>Actif</span>
                  ) : (
                    <span className={cn(PASTILLE, 'bg-secondary')}>Désactivé</span>
                  )}
                </td>

                {peutModifier ? (
                  <td className="px-4 py-4">
                    {/* Les gestes passent à la ligne plutôt que d'élargir la page (trois boutons ne tiennent pas à 1440 px). */}
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {u.actif ? <ChangerTelephone id={u.id} nom={`${u.prenom} ${u.nom}`} /> : null}
                      {/* Rien à réinitialiser tant que le numéro n'est pas enregistré. */}
                      {u.mfaEnrolledAt && u.actif ? (
                        <form action={reinitialiserMfaAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <button type="submit" className={cn(boutonAction, 'border-[#dde9e6] hover:bg-[#f5f9f8]')}>
                            Réinitialiser la double auth.
                            <span className="sr-only">
                              {' '}
                              de {u.prenom} {u.nom}
                            </span>
                          </button>
                        </form>
                      ) : null}

                      {u.actif ? (
                        // Se désactiver soi-même fermerait la session en cours ;
                        // l'action serveur le refuse aussi, ceci n'est que l'écran.
                        u.id === ctx.userId ? (
                          <span className="px-2 text-sm text-muted-foreground">vous</span>
                        ) : (
                          <form action={desactiverCompteAction}>
                            <input type="hidden" name="id" value={u.id} />
                            <button
                              type="submit"
                              className={cn(
                                boutonAction,
                                'border-[#f3d3cf] text-etat-erreur hover:bg-etat-erreur-fond',
                              )}
                            >
                              Désactiver
                              <span className="sr-only">
                                {' '}
                                {u.prenom} {u.nom}
                              </span>
                            </button>
                          </form>
                        )
                      ) : (
                        <form action={reactiverCompteAction}>
                          <input type="hidden" name="id" value={u.id} />
                          <button
                            type="submit"
                            className={cn(boutonAction, 'border-[#dde9e6] text-[#387a70] hover:bg-[#f5f9f8]')}
                          >
                            Réactiver
                            <span className="sr-only">
                              {' '}
                              {u.prenom} {u.nom}
                            </span>
                          </button>
                        </form>
                      )}
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {peutCreer ? (
        <section id="ajouter" aria-labelledby="titre-ajouter" className="carte-douce scroll-mt-6 px-5 py-6 sm:px-7">
          <div className="mb-6">
            <TitreAlveole id="titre-ajouter" icone={UserPlus}>
              Ajouter une personne
            </TitreAlveole>
          </div>
          <FormulaireCreation
            sites={[...sites].sort((a, b) => b.code.localeCompare(a.code)).map((s) => ({ id: s.id, nom: s.nom }))}
            siteChoisi={choisi?.id ?? null}
          />
        </section>
      ) : null}
    </div>
  )
}
