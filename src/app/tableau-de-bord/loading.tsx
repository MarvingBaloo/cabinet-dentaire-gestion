// Affiché dès le clic sur un onglet, le temps que la page arrive du serveur.
// Sans lui, rien ne bougeait pendant une à trois secondes (base de la démo en
// veille, session vérifiée et lecture tracée à chaque page) : on recliquait,
// croyant le premier clic perdu (retour de Marving du 20/10).
export default function Chargement() {
  return (
    <div role="status" aria-label="Chargement de la page" className="max-w-(--largeur-page) animate-pulse space-y-6">
      <div className="fond-v2-uni h-40 rounded-[2rem] opacity-70" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="carte-douce h-80" />
        <div className="carte-douce h-56" />
      </div>
    </div>
  )
}
