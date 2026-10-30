import Link from 'next/link'
import { cookies } from 'next/headers'
import { Check, ListPlus, LogOut, Smartphone } from 'lucide-react'

import { AccesParTelephone } from '@/components/features/portail/acces-par-telephone'
import { HistoriqueRendezVous } from '@/components/features/portail/historique-rendez-vous'
import { MesInscriptionsListeAttente } from '@/components/features/portail/mes-inscriptions-liste-attente'
import { MesPreferencesNotifications } from '@/components/features/portail/mes-preferences-notifications'
import { MesRendezVous } from '@/components/features/portail/mes-rendez-vous'
import { TelephoneSms } from '@/components/features/portail/telephone-sms'
import { CerclePointille } from '@/components/features/vitrine/cercle-pointille'
import { EnTetePublic } from '@/components/features/vitrine/en-tete-public'
import { PiedDePage } from '@/components/features/vitrine/pied-de-page'
import { jourLocal } from '@/lib/dates'
import { fermerEspaceAction } from '@/server/actions/acces-patient'
import { masquerNumero } from '@/server/auth/code-sms'
import { listerPraticiensPublics } from '@/server/queries/public/catalogue'
import {
  NOM_COOKIE_ACCES,
  fenetreValide,
  historiqueDuPatient,
  rendezVousDuPatient,
} from '@/server/services/acces-patient'
import { inscriptionsDuPatient } from '@/server/services/inscription-liste-attente'
import { preferencesDuPatient } from '@/server/services/preferences-notifications'

// L'espace patient (« Mes rendez-vous » dans l'en-tête du site) : le patient
// retrouve ses rendez-vous avec son numéro et un code reçu par SMS — pas de mot
// de passe, pas de compte à créer (D8, D23). C'est le même numéro vérifié qui le
// reconnaît d'une réservation sur l'autre.

// Page personnelle (jeton d'accès patient) : jamais indexée (lot F, D36).
export const metadata = { title: 'Mes rendez-vous', robots: { index: false } }

// La page lit un cookie : elle ne peut pas être rendue à l'avance.
export const dynamic = 'force-dynamic'

export default async function PageMesRendezVous({ searchParams }: { searchParams: Promise<{ ferme?: string }> }) {
  const { ferme } = await searchParams
  const jeton = (await cookies()).get(NOM_COOKIE_ACCES)?.value

  // L'horloge est lue ICI, dans la fonction d'accès, et passée à l'affichage :
  // un composant qui appellerait `new Date()` pendant son rendu serait impur.
  const maintenant = new Date()
  const lus = jeton ? await rendezVousDuPatient(jeton, maintenant) : null
  // Jours restants, comptés en dates du cabinet : « Demain », « J-8 » (M3, 19/10).
  const aujourdhui = Date.parse(jourLocal(maintenant))
  const rdvs = lus?.map((r) => ({
    ...r,
    dansJours: Math.round((Date.parse(jourLocal(r.debut)) - aujourdhui) / 86_400_000),
  }))
  const passes = rdvs && jeton ? await historiqueDuPatient(jeton, maintenant) : null

  // Le numéro de la fenêtre ouverte, masqué : le patient voit sous quel numéro
  // il est reconnu, sans que le numéro entier ne s'affiche à l'écran.
  const fenetre = rdvs && jeton ? await fenetreValide(jeton) : null

  // Pour nommer, dans l'écran de déplacement, un praticien qui n'est pas
  // forcément celui du rendez-vous d'origine (D28) — déjà public.
  const praticiens = rdvs ? await listerPraticiensPublics() : []

  // Même jeton, même fenêtre (D29, D44).
  const inscriptions = rdvs && jeton ? await inscriptionsDuPatient(jeton, new Date()) : null
  const etatPreferences = rdvs && jeton ? await preferencesDuPatient(jeton) : null

  return (
    <>
      {/* M3 de maquette-mes-rendez-vous.pdf (19/10) : bandeau bleu-vert, cartes sur le fond clair à hexagones. */}
      <section className="fond-v2-hexagones relative isolate">
        <EnTetePublic surCouleur />
        <div className="mx-auto max-w-[90rem] px-6 pt-36 pb-12 lg:px-20 lg:pt-40">
          <h1 className="font-heading text-[length:var(--texte-titre-2)] leading-none font-extrabold tracking-tight">
            Mes rendez-vous
          </h1>
          <p className="mt-3 text-encre/85">
            Déplacer, annuler, ajouter à votre agenda, et retrouver vos rendez-vous passés.
          </p>
          {fenetre ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <p className="inline-flex items-center gap-2 rounded-full bg-white/60 px-3.5 py-2 text-[0.8125rem] font-semibold">
                <Check aria-hidden className="size-4" /> Numéro vérifié : {masquerNumero(fenetre.telephone)}
              </p>
              {/* Sur la tablette familiale, l'espace ne reste pas ouvert derrière le patient (21/10). */}
              <form action={fermerEspaceAction}>
                <button
                  type="submit"
                  className="inline-flex items-center gap-2 rounded-full border border-encre/30 px-3.5 py-2 text-[0.8125rem] font-semibold hover:bg-white/40"
                >
                  <LogOut aria-hidden className="size-4" /> Fermer mon espace
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </section>

      <main className="fond-hexagones">
        {rdvs ? (
          <div className="mx-auto grid max-w-[90rem] items-start gap-6 px-4 py-12 sm:px-6 lg:grid-cols-[minmax(0,1fr)_22.5rem] lg:gap-8 lg:px-20 lg:py-16">
            <div className="min-w-0 space-y-6">
              <MesRendezVous
                rendezVous={rdvs}
                praticiens={praticiens.map((p) => ({ id: p.id, nom: p.nom, prenom: p.prenom }))}
              />
              {passes ? <HistoriqueRendezVous rendezVous={passes} /> : null}
              <Link href="/" className="inline-block text-sm font-medium text-primary hover:underline">
                ← Retour au site
              </Link>
            </div>

            <aside className="space-y-6">
              {etatPreferences?.etat === 'chargees' ? (
                <MesPreferencesNotifications
                  preferences={etatPreferences.preferences}
                  inscritListeAttente={(inscriptions?.length ?? 0) > 0}
                />
              ) : null}
              <section className="fond-v2-hexagones relative overflow-hidden rounded-[1.75rem] px-7 pt-7 pb-20">
                <CerclePointille couleur="#fff" className="absolute -right-24 -bottom-28 w-52 opacity-50" />
                <span className="hexagone grid h-12 w-[2.625rem] place-items-center bg-white text-[#387a70]">
                  <ListPlus aria-hidden className="size-5" strokeWidth={1.6} />
                </span>
                <h2 className="mt-3 font-heading text-xl font-bold">Un autre rendez-vous ?</h2>
                <p className="relative mt-1.5 text-sm text-encre/85">
                  Réservez un créneau, ou inscrivez-vous à la liste d’attente.
                </p>
                <Link
                  href="/rendez-vous"
                  className="lien-action relative mt-4 inline-flex h-11 items-center rounded-full bg-white px-5 text-sm text-[#387a70] hover:bg-white/90"
                >
                  Prendre rendez-vous
                </Link>
              </section>
              {inscriptions ? <MesInscriptionsListeAttente inscriptions={inscriptions} /> : null}
            </aside>
          </div>
        ) : (
          <div className="mx-auto grid max-w-[68.75rem] items-center gap-16 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_17.5rem] lg:py-20">
            <section aria-labelledby="titre-acces" className="carte-douce px-6 py-8 sm:px-8">
              <div className="flex items-center gap-4">
                <span className="hexagone grid h-[3.75rem] w-[3.25rem] shrink-0 place-items-center bg-linear-to-br from-[#4f9a8f] to-[#387a70] text-white">
                  <Smartphone aria-hidden className="size-6" strokeWidth={1.6} />
                </span>
                <h2 id="titre-acces" className="font-heading text-2xl font-bold">
                  Retrouver mes rendez-vous
                </h2>
              </div>
              {ferme ? (
                <p role="status" className="mt-3 font-medium text-[#387a70]">
                  Votre espace est fermé. À bientôt.
                </p>
              ) : null}
              <p className="mt-3 text-muted-foreground">
                Votre numéro suffit : pas de compte, pas de mot de passe. Un code vous est envoyé par SMS.
              </p>
              <div className="mt-6">
                <AccesParTelephone />
              </div>
              <Link href="/" className="mt-6 inline-block text-sm font-medium text-primary hover:underline">
                ← Retour au site
              </Link>
            </section>
            <div className="relative max-lg:hidden">
              <CerclePointille className="absolute -top-10 -left-20 w-64" />
              <TelephoneSms className="relative" />
            </div>
          </div>
        )}
      </main>

      <PiedDePage simple />
    </>
  )
}
