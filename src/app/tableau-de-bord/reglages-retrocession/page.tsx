import { BandeauReglages } from '@/components/features/reglages/bandeau-reglages'
import { ReglagePart, ReglagePrix } from '@/components/features/retrocession/retrocession'
import { AccesReserve } from '@/components/ui/acces-reserve'
import { eurosSaisie } from '@/lib/euros'
import { PermissionDeniedError } from '@/server/auth/permissions'
import { exigerContexte } from '@/server/auth/session-courante'
import { lireReglagesRetrocession } from '@/server/queries/retrocession'

// Les deux réglages de la rétrocession (D81), à faire une fois : la part de chaque praticien, et le prix de chaque
// soin, proposé à la secrétaire au passage en caisse.

export const metadata = { title: 'Rétrocession' }

export default async function PageReglagesRetrocession() {
  const ctx = await exigerContexte()
  let reglages: Awaited<ReturnType<typeof lireReglagesRetrocession>>
  try {
    reglages = await lireReglagesRetrocession(ctx)
  } catch (e) {
    if (e instanceof PermissionDeniedError) return <AccesReserve titre="Rétrocession" />
    throw e
  }
  const sansPrix = reglages.motifs.filter((m) => m.prixCentimes === null).length

  return (
    <div className="max-w-(--largeur-page) space-y-6">
      <BandeauReglages
        titre="Rétrocession"
        chiffres={[
          {
            valeur: reglages.praticiens.filter((p) => p.partRetrocession !== null).length,
            libelle: 'praticiens avec une part',
            cible: 'avec-part',
          },
          { valeur: sansPrix, libelle: sansPrix > 1 ? 'soins sans prix' : 'soin sans prix', alerte: true, cible: 'sans-prix' },
        ]}
      >
        Chaque mois, le cabinet reverse à chaque praticien sa part des soins qu’il a faits. Réglez ici sa part, et le
        prix de chaque soin : la secrétaire le valide au passage en caisse, et le relevé se calcule tout seul.
      </BandeauReglages>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section aria-labelledby="titre-parts" className="carte-douce px-5 py-5 sm:px-7">
          <h2 id="titre-parts" className="font-heading text-lg font-semibold">
            La part de chaque praticien
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">Vide pour le titulaire : il ne se reverse rien.</p>
          <div className="mt-3">
            {reglages.praticiens.map((p) => (
              <ReglagePart
                key={p.id}
                praticien={{
                  id: p.id,
                  nom: `Dr ${p.prenom} ${p.nom}`,
                  couleur: p.couleur,
                  part: p.partRetrocession,
                  titulaire: p.userId === ctx.userId,
                }}
              />
            ))}
          </div>
        </section>

        <section aria-labelledby="titre-prix" className="carte-douce px-5 py-5 sm:px-7">
          <h2 id="titre-prix" className="font-heading text-lg font-semibold">
            Le prix de chaque soin
          </h2>
          <p className="mt-1 text-[0.8125rem] text-muted-foreground">
            Un prix de départ : la secrétaire le corrige au passage en caisse si le praticien a fait plus.
          </p>
          <div className="mt-3">
            {reglages.motifs.map((m) => (
              <ReglagePrix key={m.id} motif={{ id: m.id, libelle: m.libelle, prix: eurosSaisie(m.prixCentimes) }} />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
