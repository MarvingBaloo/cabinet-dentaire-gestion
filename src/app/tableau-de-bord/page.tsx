import Link from 'next/link'

import {
  CarteCabinets,
  CarteSecurite,
  Carte,
  Chiffre,
  DemandesTransmises,
  ProchainsRendezVous,
  dateCourte,
  quandRelatif,
} from '@/components/features/accueil/accueil'
import { DemandesAValider } from '@/components/features/accueil/demandes-a-valider'
import { DemandesUrgence } from '@/components/features/accueil/demandes-urgence'
import { FicheRendezVousProvider } from '@/components/features/agenda/panneau-rendez-vous'
import { Message } from '@/components/ui/message'
import { FUSEAU_CABINET, heureCabinet } from '@/lib/dates'
import { afficherTelephone } from '@/lib/telephone'
import { hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { type CabinetAccessible, lireCabinetChoisi } from '@/server/cabinet-choisi'
import { lireAccueil, lireDemandesTransmises } from '@/server/queries/accueil'
import { lireDemandesAnnulationEnAttente } from '@/server/queries/agenda'
import { listerDemandesUrgence } from '@/server/queries/demandes-urgence'
import { lireIdentite } from '@/server/queries/identite'
import { lireIndicateurs } from '@/server/queries/tableau-bord'

const dateDuJour = new Intl.DateTimeFormat('fr-FR', {
  timeZone: FUSEAU_CABINET,
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

const pluriel = (n: number, un: string, plusieurs: string) => (n > 1 ? plusieurs : un)

export default async function PageAccueil() {
  const ctx = await exigerContexte()
  const maintenant = new Date()
  const [identite, { choisi, cabinets }] = await Promise.all([lireIdentite(ctx), lireCabinetChoisi(ctx)])

  if (!choisi) {
    return <Message ton="alerte">Votre compte n’est rattaché à aucun cabinet. Voyez un administrateur.</Message>
  }

  // L'Accueil du praticien ne montre que ses rendez-vous et les demandes qu'il
  // doit trancher ; la secrétaire et l'administratrice voient tout le cabinet.
  const praticienId = identite.praticienId && hasPermission(ctx, 'agenda', 'valider') ? identite.praticienId : null
  // Le chiffre des annulations mène à leur carte, plus bas, quand l'encart du rôle la montre (pas à l'administrateur
  // sans fauteuil, qui a l'encart Sécurité) ; sinon à l'agenda.
  const annulationsSurLaPage =
    !!praticienId || !(hasPermission(ctx, 'audit', 'read') && hasPermission(ctx, 'utilisateur', 'read'))
  const accueil = await lireAccueil(ctx, choisi, cabinets, praticienId ? { praticienId, maintenant } : { maintenant })
  const cabinet = accueil.cabinets.find((c) => c.id === choisi.id)
  const { nombre, longues, premier } = accueil.salleAttente

  const salut = praticienId ? `Bonjour Dr ${identite.nom}` : `Bonjour ${identite.prenom}`
  const jour = dateDuJour.format(maintenant)

  // Les urgences que l'assistant n'a pas pu placer dans le délai (D79), en tête : le cabinet doit rappeler.
  const demandesUrgence = hasPermission(ctx, 'agenda', 'read') ? await listerDemandesUrgence(ctx) : []

  // Un clic sur une ligne de « Prochains rendez-vous » ouvre sa fiche, comme dans l'agenda (tour du 20/10).
  const signature = accueil.prochains.map((r) => `${r.id}:${r.statut}:${r.debut.getTime()}`).join('|')

  return (
    <FicheRendezVousProvider signature={signature}>
      <div className="max-w-(--largeur-page) space-y-5 sm:space-y-8">
        <header className="fond-v2-uni flex flex-col gap-4 overflow-hidden rounded-[1.75rem] px-5 py-5 sm:gap-8 sm:rounded-[2rem] sm:px-10 sm:py-9 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 xl:flex-1">
            <p className="text-[0.8125rem] font-bold tracking-[0.12em] text-encre/80 uppercase">
              {jour} · {heureCabinet(maintenant)}
            </p>
            <h1 className="mt-1 font-heading text-2xl leading-tight font-extrabold sm:mt-2 sm:text-[length:var(--texte-titre-3)] xl:text-[2.25rem]">
              {salut}
            </h1>
            <p className="mt-2 hidden text-encre/85 sm:block">
              Voici ce qui demande votre attention aujourd’hui au{' '}
              {choisi.nom.charAt(0).toLowerCase() + choisi.nom.slice(1)}.
            </p>
          </div>

          {/* Sur téléphone, trois pastilles au lieu des quatre alvéoles : les rendez-vous restent dans le premier écran. */}
          <ul aria-label="Aujourd’hui" className="flex flex-wrap gap-2 sm:hidden">
            {(
              [
                [accueil.rendezVousDuJour, 'rendez-vous', false, '/tableau-de-bord/agenda'],
                [nombre, 'en salle d’attente', false, '/tableau-de-bord/workflow'],
                [
                  accueil.annulations,
                  pluriel(accueil.annulations, 'annulation', 'annulations'),
                  true,
                  annulationsSurLaPage ? '#annulations' : '/tableau-de-bord/agenda',
                ],
              ] as const
            ).map(([n, libelle, alerte, href]) => (
              <li key={libelle}>
                <Link
                  href={href}
                  className={
                    alerte && n > 0
                      ? 'block rounded-full bg-[#FBF0DC] px-3 py-1 text-sm font-semibold text-etat-alerte'
                      : 'block rounded-full bg-white/60 px-3 py-1 text-sm font-semibold'
                  }
                >
                  {n} {libelle}
                </Link>
              </li>
            ))}
          </ul>

          <section
            aria-label="Aujourd’hui"
            className="hidden grid-cols-2 gap-x-2 gap-y-7 sm:grid sm:grid-cols-4 xl:w-[36rem] xl:shrink-0"
          >
            <Chiffre
              href="/tableau-de-bord/agenda"
              valeur={accueil.rendezVousDuJour}
              libelle={pluriel(accueil.rendezVousDuJour, 'rendez-vous aujourd’hui', 'rendez-vous aujourd’hui')}
              detail={
                praticienId
                  ? accueil.fauteuilsDuJour.join(' · ')
                  : `${cabinet?.fauteuils ?? 0} ${pluriel(cabinet?.fauteuils ?? 0, 'fauteuil', 'fauteuils')}`
              }
            />
            <Chiffre
              href="/tableau-de-bord/workflow"
              valeur={nombre}
              libelle={pluriel(nombre, 'patient en salle d’attente', 'patients en salle d’attente')}
              detail={
                praticienId && premier
                  ? `${premier.patient.prenom} ${premier.patient.nom}, arrivé(e) à ${heureCabinet(premier.updatedAt)}`
                  : longues > 0
                    ? `dont ${longues} depuis plus de 20 min`
                    : nombre > 0
                      ? 'aucun depuis plus de 20 min'
                      : 'personne pour l’instant'
              }
            />
            <Chiffre
              alerte
              href={annulationsSurLaPage ? '#annulations' : '/tableau-de-bord/agenda'}
              valeur={accueil.annulations}
              libelle={pluriel(accueil.annulations, 'demande d’annulation', 'demandes d’annulation')}
              detail={praticienId ? 'à valider par vous' : 'à valider par le praticien'}
            />
            <Chiffre
              href="/tableau-de-bord/liste-attente"
              valeur={accueil.creneauxLiberes}
              libelle={pluriel(accueil.creneauxLiberes, 'créneau libéré', 'créneaux libérés')}
              detail="liste d’attente prévenue par SMS"
            />
          </section>
        </header>

        <DemandesUrgence
          peutTraiter={hasPermission(ctx, 'agenda', 'update')}
          demandes={demandesUrgence.map((d) => ({
            id: d.id,
            niveau: d.niveau,
            patient: `${d.contactPrenom ?? ''} ${d.contactNom ?? ''}`.trim(),
            telephone: afficherTelephone(d.contactTelephone ?? ''),
            telephoneLien: d.contactTelephone ?? '',
            quand: d.demandeLe ? quandRelatif(d.demandeLe, maintenant) : '',
            resume: d.resume,
          }))}
        />

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_27.25rem] xl:items-start">
          <ProchainsRendezVous rendezVous={accueil.prochains} vuDuPraticien={!!praticienId} maintenant={maintenant} />
          <div className="space-y-6">
            <CarteCabinets cabinets={accueil.cabinets} />
            <EncartDuRole ctx={ctx} cabinet={choisi} praticien={!!praticienId} maintenant={maintenant} />
          </div>
        </div>
      </div>
    </FicheRendezVousProvider>
  )
}

async function EncartDuRole({
  ctx,
  cabinet,
  praticien,
  maintenant,
}: {
  ctx: Awaited<ReturnType<typeof exigerContexte>>
  cabinet: CabinetAccessible
  praticien: boolean
  maintenant: Date
}) {
  if (praticien) {
    const demandes = (await lireDemandesAnnulationEnAttente(ctx)).filter((d) => d.site.id === cabinet.id)
    return (
      <Carte id="annulations" titre="Demandes d’annulation à valider">
        <DemandesAValider
          demandes={demandes.map((d) => ({
            id: d.id,
            quand: dateCourte(d.debut),
            patient: `${d.patient.prenom} ${d.patient.nom}`,
            demandeur: d.annulationDemandeePar
              ? `Demandée par ${d.annulationDemandeePar.prenom} ${d.annulationDemandeePar.nom}${
                  d.annulationDemandeeLe ? `, ${quandRelatif(d.annulationDemandeeLe, maintenant)}` : ''
                }`
              : 'Demandée en ligne par le patient',
          }))}
        />
      </Carte>
    )
  }

  if (hasPermission(ctx, 'audit', 'read') && hasPermission(ctx, 'utilisateur', 'read')) {
    const i = await lireIndicateurs(ctx)
    return (
      <CarteSecurite
        lignes={[
          { valeur: i.comptesActifs, libelle: pluriel(i.comptesActifs, 'compte actif', 'comptes actifs') },
          {
            valeur: i.sansMfa,
            libelle: pluriel(i.sansMfa, 'compte sans double authentification', 'comptes sans double authentification'),
            ton: 'erreur',
          },
          { valeur: i.postesActifs, libelle: pluriel(i.postesActifs, 'poste de travail', 'postes de travail') },
          {
            valeur: i.postesSansSite,
            libelle: pluriel(i.postesSansSite, 'poste sans site rattaché', 'postes sans site rattaché'),
            ton: 'alerte',
          },
          ...(i.audit
            ? [
                {
                  valeur: i.audit.echecsConnexion24h,
                  libelle: pluriel(i.audit.echecsConnexion24h, 'échec de connexion', 'échecs de connexion'),
                  ton: 'alerte' as const,
                },
                {
                  valeur: i.audit.refusPermission24h,
                  libelle: pluriel(i.audit.refusPermission24h, 'accès refusé', 'accès refusés'),
                  ton: 'erreur' as const,
                },
              ]
            : []),
        ]}
      />
    )
  }

  const demandes = await lireDemandesTransmises(ctx, cabinet)
  return <DemandesTransmises demandes={demandes} moi={ctx.userId} maintenant={maintenant} />
}
