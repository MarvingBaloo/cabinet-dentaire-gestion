import { Chiffre } from '@/components/features/accueil/accueil'
import { ChiffreCible } from '@/components/features/reglages/chiffre-cible'

/**
 * Haut des onglets Réglages (maquette R2 du 20/10) : la bande bleu-vert de
 * l'Accueil, avec le titre, l'explication de l'écran et deux chiffres en alvéoles. Reprise
 * par les autres écrans de l'agenda et des patients (maquette V2 du 20/10).
 */
export function BandeauReglages({
  titre,
  children,
  chiffres,
  action,
}: {
  titre: string
  children: React.ReactNode
  /** `cible` : ce que le chiffre compte, marqué `data-cible` dans la page ; sans cible ou à 0, il ne se clique pas. */
  chiffres?: { valeur: number; libelle: string; alerte?: boolean; cible?: string }[]
  action?: React.ReactNode
}) {
  return (
    <header className="fond-v2-uni flex flex-col gap-8 overflow-hidden rounded-[2rem] px-6 py-8 sm:px-10 sm:py-9 lg:flex-row lg:items-center lg:justify-between">
      <div className="min-w-0 lg:max-w-[40rem]">
        <h1 className="font-heading text-[length:var(--texte-titre-3)] leading-tight font-extrabold">{titre}</h1>
        <p className="mt-2 text-encre/85">{children}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
      {chiffres ? (
        <div className="grid shrink-0 grid-cols-2 gap-x-4 sm:w-[20rem]">
          {chiffres.map(({ cible, ...c }) =>
            cible && c.valeur > 0 ? (
              <ChiffreCible key={c.libelle} cible={cible}>
                <Chiffre {...c} survol />
              </ChiffreCible>
            ) : (
              <Chiffre key={c.libelle} {...c} />
            ),
          )}
        </div>
      ) : null}
    </header>
  )
}
