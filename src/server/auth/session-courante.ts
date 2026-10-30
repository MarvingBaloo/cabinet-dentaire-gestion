import 'server-only'

import { cookies, headers } from 'next/headers'
import { redirect } from 'next/navigation'

import type { AuthContext } from '@/server/auth/context'
import { adresseIpClient } from '@/server/http/adresse-ip'
import {
  NOM_COOKIE_POSTE,
  type PosteIdentifie,
  declarerPoste,
  estUnTelephone,
  identifierPoste,
  marquerTelephone,
  optionsCookiePoste,
} from '@/server/auth/poste'
import {
  NOM_COOKIE_SESSION,
  type OrigineRequete,
  type ResultatSession,
  optionsCookieSession,
  resoudreSession,
} from '@/server/auth/session'

// Point d'entrée unique de la session côté application.
//
// Pas de middleware Next : il s'exécute par défaut sur l'Edge Runtime, que D2
// proscrit, et il n'a de toute façon pas accès à PostgreSQL. La protection se
// fait donc dans les layouts serveur — au plus près de la donnée, ce qui est
// cohérent avec D4 : le garde vit là où la donnée est lue.

export async function lireOrigine(): Promise<OrigineRequete> {
  const h = await headers()
  const jar = await cookies()

  const poste = await identifierPoste(jar.get(NOM_COOKIE_POSTE)?.value)

  return {
    ipAddress: await adresseIpClient(),
    userAgent: h.get('user-agent'),
    workstationId: poste?.id ?? null,
    // Le site vient du poste, pas de l'utilisateur : le praticien exerce en
    // alternance sur les deux sites, la machine non (D5, D7).
    siteId: poste?.siteId ?? null,
  }
}

/**
 * Identifie le poste, en le déclarant s'il est inconnu.
 *
 * À n'appeler que depuis une Server Action : un composant serveur ne peut pas
 * poser de cookie. C'est pourquoi le poste est déclaré à la connexion et pas au
 * premier affichage — la connexion est le premier moment où l'on peut écrire.
 */
export async function assurerPoste(): Promise<PosteIdentifie> {
  const jar = await cookies()

  let poste = await identifierPoste(jar.get(NOM_COOKIE_POSTE)?.value)
  if (!poste) {
    const declare = await declarerPoste()
    jar.set(NOM_COOKIE_POSTE, declare.secret, optionsCookiePoste())
    poste = declare.poste
  }
  // Un téléphone peut ensuite valider une connexion par QR code (D83).
  if (estUnTelephone((await headers()).get('user-agent'))) await marquerTelephone(poste.id)
  return poste
}

/**
 * Posé par le navigateur, quelques secondes, avant un rafraîchissement que
 * l'agenda en direct déclenche seul (D61) : cette lecture-là n'est pas un
 * geste de la personne et ne prolonge pas sa session. Le cookie ne fait que
 * retirer un avantage — le falsifier ne donne rien.
 */
export const NOM_COOKIE_MAJ_AUTO = 'maj-auto'

export async function lireSession({ prolonger }: { prolonger?: boolean } = {}): Promise<ResultatSession> {
  const jar = await cookies()
  const automatique = jar.get(NOM_COOKIE_MAJ_AUTO)?.value === '1'
  return resoudreSession(jar.get(NOM_COOKIE_SESSION)?.value, await lireOrigine(), {
    prolonger: (prolonger ?? true) && !automatique,
  })
}

/**
 * À appeler depuis tout layout protégé. Redirige plutôt que de lever : une page
 * n'a rien à décider d'un accès refusé, elle n'a qu'à ne pas s'afficher.
 */
export async function exigerContexte(): Promise<AuthContext> {
  const resultat = await lireSession()

  if (resultat.etat === 'valide') return resultat.ctx
  if (resultat.etat === 'mfa_requis') redirect('/connexion/second-facteur')

  // Le motif accompagne la redirection : « votre session a expiré » et « vous
  // avez été déconnecté pour inactivité » ne disent pas la même chose à qui
  // revient devant son poste.
  redirect(`/connexion?motif=${resultat.etat}`)
}

export async function poserCookieSession(jeton: string): Promise<void> {
  const jar = await cookies()
  jar.set(NOM_COOKIE_SESSION, jeton, optionsCookieSession())
}

export async function retirerCookieSession(): Promise<void> {
  const jar = await cookies()
  jar.delete(NOM_COOKIE_SESSION)
}
