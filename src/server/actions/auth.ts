'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import {
  deconnecter,
  demarrerConnexion,
  renvoyerCode,
  validerSecondFacteur,
} from '@/server/auth/connexion'
import {
  assurerPoste,
  lireOrigine,
  lireSession,
  poserCookieSession,
  retirerCookieSession,
} from '@/server/auth/session-courante'
import { type EtatPoste, approuver, etatValidation, refuser } from '@/server/auth/telephone'

// Server Actions et non routes API : c'est d'elles que vient la protection CSRF
// depuis qu'Auth.js a été écarté (D6). Une route API écrite à la main ne
// l'aurait pas.

// `email` : la saisie rendue au formulaire après un refus, pour ne pas la faire retaper (le mot de passe, lui,
// n'est jamais renvoyé).
export type EtatFormulaire = { erreur?: string; succes?: string; email?: string }

const connexionSchema = z.object({
  email: z.string().trim().min(1, 'Adresse requise'),
  motDePasse: z.string().min(1, 'Mot de passe requis'),
})

const codeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Le code comporte 6 chiffres')

export async function connexionAction(
  _precedent: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  const email = String(donnees.get('email') ?? '')
  const saisie = connexionSchema.safeParse({
    email: donnees.get('email'),
    motDePasse: donnees.get('motDePasse'),
  })
  if (!saisie.success) {
    return { erreur: saisie.error.issues[0]?.message ?? 'Saisie invalide', email }
  }

  // Le poste est déclaré ici : c'est le premier moment où l'on peut poser un
  // cookie, et l'origine ainsi complétée sera portée par toutes les entrées
  // d'audit de la session à venir.
  const poste = await assurerPoste()
  const origine = { ...(await lireOrigine()), workstationId: poste.id, siteId: poste.siteId }

  const resultat = await demarrerConnexion(saisie.data.email, saisie.data.motDePasse, origine)

  switch (resultat.etat) {
    case 'connecte':
      await poserCookieSession(resultat.jeton)
      redirect('/tableau-de-bord')

    case 'mfa_requis':
    case 'telephone_requis':
      await poserCookieSession(resultat.jeton)
      redirect('/connexion/second-facteur')

    // Le mot de passe était bon, mais aucun code ne peut partir. Le dire sans
    // détour : traiter ces cas comme un mot de passe erroné enverrait chercher
    // une erreur là où il n'y en a pas.
    case 'numero_manquant':
      return {
        erreur:
          'Aucun numéro de mobile n’est enregistré sur ce compte. Demandez à un administrateur de le renseigner.',
        email,
      }

    case 'sms_indisponible':
      return { erreur: resultat.raison, email }

    case 'compte_verrouille': {
      const minutes = Math.max(1, Math.ceil((resultat.jusqua.getTime() - Date.now()) / 60_000))
      return { erreur: `Compte temporairement bloqué. Réessayez dans ${minutes} minutes.`, email }
    }

    case 'trop_de_tentatives':
      return {
        erreur:
          'Trop de tentatives de connexion depuis ce réseau. Réessayez dans quelques minutes.',
        email,
      }

    // Message identique pour un identifiant inconnu, un mot de passe faux et un
    // compte désactivé : distinguer les cas dirait à qui essaie quels comptes
    // existent (D6bis).
    case 'compte_desactive':
    case 'identifiants_invalides':
      return { erreur: 'Adresse ou mot de passe incorrect.', email }
  }
}

export async function secondFacteurAction(
  _precedent: EtatFormulaire,
  donnees: FormData,
): Promise<EtatFormulaire> {
  const code = codeSchema.safeParse(donnees.get('code'))
  if (!code.success) return { erreur: code.error.issues[0]?.message ?? 'Code invalide' }

  const session = await lireSession()
  if (session.etat !== 'mfa_requis') redirect('/connexion?motif=session_perdue')

  const resultat = await validerSecondFacteur(session.sessionId, code.data, await lireOrigine())

  switch (resultat.etat) {
    case 'connecte':
      redirect('/tableau-de-bord')

    case 'code_invalide':
      // Le nombre d'essais restants est annoncé : sans lui, on découvre le
      // blocage en le déclenchant.
      return {
        erreur:
          resultat.tentativesRestantes > 1
            ? `Code incorrect. Encore ${resultat.tentativesRestantes} essais.`
            : 'Code incorrect. Dernier essai avant blocage.',
      }

    case 'code_expire':
      return { erreur: 'Ce code a expiré. Demandez-en un nouveau.' }

    case 'trop_de_tentatives':
      return { erreur: 'Trop d’essais. Demandez un nouveau code.' }

    case 'session_invalide':
      redirect('/connexion?motif=expiree')
  }
}

/** Renvoie un code : un SMS peut se perdre ou tarder. */
export async function renvoyerCodeAction(): Promise<EtatFormulaire> {
  const session = await lireSession()
  if (session.etat !== 'mfa_requis') redirect('/connexion?motif=session_perdue')

  const resultat = await renvoyerCode(session.sessionId)
  if (resultat.etat === 'envoye') {
    return { succes: `Nouveau code envoyé au ${resultat.masque}.` }
  }
  return { erreur: resultat.raison }
}

/** Le poste attend le « Oui » du téléphone (D83) : interrogé toutes les deux secondes par l'écran du QR. */
export async function attendreTelephoneAction(): Promise<{ etat: EtatPoste }> {
  const session = await lireSession()
  if (session.etat === 'valide') redirect('/tableau-de-bord')
  // Refusée depuis le téléphone : la session a été coupée.
  if (session.etat === 'revoquee') return { etat: 'refuse' }
  if (session.etat !== 'mfa_requis') redirect('/connexion?motif=expiree')
  return { etat: await etatValidation(session.sessionId) }
}

/** Pas de téléphone sous la main : le code part par SMS, et l'écran passe à sa saisie. */
export async function passerAuSmsAction(): Promise<EtatFormulaire> {
  const session = await lireSession()
  if (session.etat !== 'mfa_requis') redirect('/connexion?motif=session_perdue')
  const resultat = await renvoyerCode(session.sessionId)
  if (resultat.etat === 'impossible') return { erreur: resultat.raison }
  redirect('/connexion/second-facteur')
}

/** Les deux réponses du téléphone, après le scan du QR (D83). */
export type EtatReponseTelephone = { etat?: 'acceptee' | 'refusee' | 'non_reconnu' | 'perimee' }

export async function repondreDepuisTelephoneAction(
  _precedent: EtatReponseTelephone,
  donnees: FormData,
): Promise<EtatReponseTelephone> {
  const jeton = String(donnees.get('jeton') ?? '')
  const origine = await lireOrigine()
  const oui = donnees.get('reponse') === 'oui'
  const reponse = oui ? await approuver(jeton, origine) : await refuser(jeton, origine)
  if (reponse.etat === 'fait') return { etat: oui ? 'acceptee' : 'refusee' }
  return { etat: reponse.etat }
}

export async function deconnexionAction(): Promise<void> {
  const session = await lireSession()

  if (session.etat === 'valide') {
    await deconnecter(
      session.sessionId,
      { id: session.ctx.userId, email: session.ctx.email },
      await lireOrigine(),
    )
  }

  await retirerCookieSession()
  redirect('/connexion?motif=deconnecte')
}
