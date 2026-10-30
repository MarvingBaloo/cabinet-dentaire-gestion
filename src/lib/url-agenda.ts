// Construction des liens de l'agenda (lot 4) : un seul endroit qui connaît le
// nom des paramètres d'URL, pour que la page et les composants de vue ne
// répètent pas chacun leur propre sérialisation.

export type ParametresLienAgenda = {
  vue?: 'jour' | 'semaine' | 'mois' | undefined
  date?: string | undefined
  /** Un identifiant de site, ou `'tous'` pour la vue consolidée. */
  site?: string | undefined
  praticien?: string | undefined
  /** Exclusions d'affichage de la vue semaine (D58), en paramètres répétés. */
  sansPraticien?: readonly string[] | undefined
  sansMotif?: readonly string[] | undefined
  sansStatut?: readonly string[] | undefined
  /** Le praticien a coché ses confrères : sans ce drapeau, il ne voit que les
   *  siens (décision du 13/10, maquettes). */
  tousPraticiens?: boolean | undefined
}

/**
 * L'URL de l'agenda pour les paramètres donnés — ceux qui valent leur défaut
 * (vue « jour ») sont omis pour garder les liens courts et stables.
 */
export function hrefAgenda(params: ParametresLienAgenda): string {
  const qs = new URLSearchParams()
  if (params.vue && params.vue !== 'jour') qs.set('vue', params.vue)
  if (params.date) qs.set('date', params.date)
  if (params.site) qs.set('site', params.site)
  if (params.praticien) qs.set('praticien', params.praticien)
  for (const v of params.sansPraticien ?? []) qs.append('sansPraticien', v)
  for (const v of params.sansMotif ?? []) qs.append('sansMotif', v)
  for (const v of params.sansStatut ?? []) qs.append('sansStatut', v)
  if (params.tousPraticiens) qs.set('tousPraticiens', '1')
  const s = qs.toString()
  return `/tableau-de-bord/agenda${s ? `?${s}` : ''}`
}

/** Le panneau de gauche replié (Marving, 29/10) : retenu sur ce poste, lu par la page pour l'afficher d'emblée replié. */
export const COOKIE_PANNEAU_REPLIE = 'agenda-panneau-replie'
