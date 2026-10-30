import { MenuPatient } from '@/components/features/agenda/menu-patient'
import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { hasPermission } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { listerMotifsPatientAdmin, listerMotifs } from '@/server/queries/agenda'
import { listerMotifsPatient } from '@/server/queries/public/catalogue'

// Ce que les patients voient sur le portail, réglé par le cabinet lui-même.
// Sans cet écran, ajouter une entrée passerait par une intervention sur le code
// — et la promesse d'un catalogue paramétrable (D14) serait en l'air.
//
// L'aperçu de droite lit le menu EXACTEMENT comme le portail public
// (`listerMotifsPatient`) : il ne peut pas promettre ce que le patient ne verra pas.

export const metadata = { title: 'Menu des patients' }

export default async function PageMotifsPatient() {
  const ctx = await exigerContexte()

  const [entrees, actes, apercu] = await Promise.all([
    listerMotifsPatientAdmin(ctx),
    listerMotifs(ctx),
    listerMotifsPatient(),
  ])
  // Masquer n'est pas protéger : le service garde `motif:update` (maquettes du
  // 13/10 — la secrétaire et l'assistante lisent sans modifier).
  const peutModifier = hasPermission(ctx, 'motif', 'update')
  // Les choix finaux visibles sur le site qui ne mènent à aucun acte : le patient ne les verra pas.
  const sansActe = entrees.flatMap((e) =>
    e.enfants.length > 0 ? e.enfants.filter((c) => c.actif && !c.motif) : e.actif && !e.motif ? [e] : [],
  ).length

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Menu des patients"
        chiffres={[
          { valeur: entrees.length, libelle: entrees.length > 1 ? 'entrées' : 'entrée', cible: 'entree' },
          { valeur: sansActe, libelle: 'sans acte', alerte: true, cible: 'sans-acte' },
        ]}
        action={
          peutModifier ? null : (
            <p className="inline-block rounded-full bg-white/20 px-3.5 py-1 text-[0.8125rem] font-medium">
              Lecture seule · modifiable par l’administrateur du cabinet
            </p>
          )
        }
      >
        Ce que vos patients lisent sur le site quand ils prennent rendez-vous. Chaque choix final doit pointer vers un
        acte de l’agenda : c’est lui qui donne la durée. Une entrée sans acte n’est pas proposée.
      </BandeauReglages>

      <MenuPatient
        entrees={entrees}
        actes={actes.map((a) => ({ id: a.id, libelle: a.libelle }))}
        apercu={apercu.map((e) => ({ id: e.id, libelle: e.libelle, aide: e.aide }))}
        peutModifier={peutModifier}
      />
    </div>
  )
}
