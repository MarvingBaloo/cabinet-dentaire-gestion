import { expect, test, type Page } from '@playwright/test'

import { client, codePatient, lireEtat, lireRendezVous, oublierDemandesCode, rendezVousDupont } from './donnees'
import { sansDefilementHorizontal, surveillerConsole } from './outils'

// La journée des patients, jouée dans le navigateur — d'abord sur iPhone, où ils réservent. Le patient n'a pas
// de compte : son numéro et le code reçu par SMS le reconnaissent (D23). Aucune session du personnel ici.

const etat = lireEtat()
const P = etat.portail

test.use({ storageState: { cookies: [], origins: [] } })
surveillerConsole(test)

// Chaque parcours se présente avec sa propre adresse, comme des patients différents : la limite de cinq
// demandes de code par heure et par connexion n'est pas l'objet de ces parcours.
let compteur = 0
test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ 'x-forwarded-for': `198.18.${Date.now() % 250}.${compteur++ % 250}` })
})

/** Le rang du navigateur : chacun prend ses propres heures, pour ne pas se disputer les créneaux. */
const rang = (nom: string) => ['chrome', 'safari', 'iphone'].indexOf(nom)

async function saisirCodeEnCases(page: Page, code: string) {
  await page.getByLabel('Chiffre 1 sur 6').click()
  await page.keyboard.type(code)
}

async function ouvrirMesRendezVous(page: Page, local: string, telephone: string) {
  await oublierDemandesCode(telephone)
  await page.goto('/mes-rendez-vous')
  const depuis = new Date(Date.now() - 1000)
  await page.getByLabel('Votre numéro de téléphone').fill(local)
  await page.getByRole('button', { name: 'Recevoir un code' }).click()
  await expect(page.getByText(/Si ce numéro est connu du cabinet, un code vient de partir/)).toBeVisible()
  await page.getByLabel('Code à six chiffres').fill(await codePatient(telephone, 'acces', depuis))
  await page.getByRole('button', { name: 'Voir mes rendez-vous →' }).click()
  await expect(page.getByRole('heading', { name: 'Mes rendez-vous passés' })).toBeVisible({ timeout: 30_000 })
}

/** La carte d'un rendez-vous dans « Mes rendez-vous », retrouvée par son jour (« Dimanche 25 octobre »). */
function carte(page: Page, debut: Date) {
  const jour = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Guadeloupe',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
    .format(debut)
    .replace(/^./, (c) => c.toUpperCase())
  const heure = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'America/Guadeloupe',
    hour: '2-digit',
    minute: '2-digit',
  }).format(debut)
  return page.getByRole('article').filter({ has: page.getByRole('heading', { name: `${jour} · ${heure}` }) })
}

test.describe('Prendre rendez-vous en ligne', () => {
  test('un nouveau patient réserve de bout en bout ; un mauvais code est refusé sans perdre la réservation', async ({
    page,
  }, info) => {
    const numero = P.nouveaux[info.project.name]!
    const nom = `Nouveau${P.dupont.nom.slice(-4)}${info.project.name}`
    await page.goto('/rendez-vous')
    const etape = async (lien: ReturnType<Page['getByRole']>, adresse: RegExp) => {
      await Promise.all([page.waitForURL(adresse, { timeout: 30_000 }), lien.click()])
    }
    await etape(page.getByRole('link', { name: /^Marie-Galante/ }), /site=/)
    await etape(page.getByRole('link', { name: new RegExp(P.menuLibelle.replace(/[()]/g, '.')) }), /motif=/)
    await etape(page.getByRole('link', { name: `Dr Léa ${P.praticien.nom}` }), /praticien=/)
    // P1 (26/10) : trois propositions ; chaque navigateur prend la sienne.
    const propositions = page.getByRole('region', { name: /Choisissez un créneau/ }).getByRole('listitem').getByRole('link')
    await expect(propositions).toHaveCount(3)
    await etape(propositions.nth(rang(info.project.name)), /creneau=/)

    await page.getByLabel('Prénom').fill('Inès')
    await page.getByLabel('Nom', { exact: true }).fill(nom)
    await page.getByLabel('Téléphone mobile').fill(numero.local.replace(/(\d{4})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4'))
    const depuis = new Date(Date.now() - 1000)
    await page.getByRole('button', { name: 'Recevoir mon code →' }).click()
    await expect(page.getByRole('heading', { name: 'Votre code' })).toBeVisible()
    const code = await codePatient(numero.telephone, 'reservation', depuis)

    await saisirCodeEnCases(page, code === '000000' ? '111111' : '000000')
    await page.getByRole('button', { name: 'Confirmer mon rendez-vous' }).click()
    await expect(page.getByText('Code incorrect. Il vous reste 2 essais.')).toBeVisible()
    for (let i = 1; i <= 6; i++) await page.getByLabel(`Chiffre ${i} sur 6`).fill('')
    await saisirCodeEnCases(page, code)
    const confirmer = page.getByRole('button', { name: 'Confirmer mon rendez-vous' })
    if (await confirmer.isVisible().catch(() => false)) await confirmer.click().catch(() => {})
    await expect(page.getByText('C’est réservé.')).toBeVisible({ timeout: 30_000 })
    await expect(
      page.getByText('Un SMS de confirmation vous est envoyé, puis un rappel deux jours avant.'),
    ).toBeVisible()

    const prisma = client()
    const rdv = await prisma.rendezVous.findFirstOrThrow({
      where: { patient: { telephone: numero.telephone } },
      include: { patient: true },
    })
    const sms = await prisma.notification.count({ where: { rendezVousId: rdv.id, type: 'CONFIRMATION_RESERVATION' } })
    await prisma.$disconnect()
    expect(rdv.statut).toBe('A_CONFIRMER')
    expect(rdv.patient).toMatchObject({ prenom: 'Inès', nom, telephone: numero.telephone })
    expect(sms).toBe(1)
  })

  test('« Un autre jour ? » : le calendrier, puis trois horaires au plus pour le jour choisi (P1)', async ({ page }) => {
    await page.goto('/rendez-vous')
    await Promise.all([page.waitForURL(/site=/), page.getByRole('link', { name: /^Marie-Galante/ }).click()])
    await Promise.all([
      page.waitForURL(/motif=/),
      page.getByRole('link', { name: new RegExp(P.menuLibelle.replace(/[()]/g, '.')) }).click(),
    ])
    await Promise.all([page.waitForURL(/praticien=/), page.getByRole('link', { name: `Dr Léa ${P.praticien.nom}` }).click()])
    const etape4 = page.getByRole('region', { name: /Choisissez un créneau/ })
    // Plus de mur d'horaires ni de compteur.
    await expect(etape4.getByText(/\+ \d+ horaires/)).toHaveCount(0)
    await Promise.all([page.waitForURL(/autre=1/), etape4.getByRole('link', { name: 'Un autre jour ? Choisir une date' }).click()])
    const jours = etape4.getByRole('link', { name: /^Choisir le / })
    // En fin de mois, il peut ne rester qu'un jour libre dans le mois affiché (le 30/10, seulement le 31).
    const jour = (await jours.count()) > 1 ? jours.nth(1) : jours.first()
    await Promise.all([page.waitForURL(/date=/), jour.click()])
    const horaires = etape4.getByRole('link', { name: /^\d{1,2}\s?h\s?\d{2}$/ })
    const n = await horaires.count()
    expect(n).toBeGreaterThan(0)
    expect(n).toBeLessThanOrEqual(3)
    await Promise.all([page.waitForURL(/creneau=/), horaires.first().click()])
    await expect(page.getByLabel('Prénom')).toBeVisible()
    await sansDefilementHorizontal(page)
  })

  test('un patient bloqué (trois absences) est prié d’appeler le cabinet, et rien n’est réservé', async ({
    page,
  }, info) => {
    await page.goto('/rendez-vous')
    await Promise.all([page.waitForURL(/site=/), page.getByRole('link', { name: /^Marie-Galante/ }).click()])
    await Promise.all([
      page.waitForURL(/motif=/),
      page.getByRole('link', { name: new RegExp(P.menuLibelle.replace(/[()]/g, '.')) }).click(),
    ])
    await Promise.all([page.waitForURL(/praticien=/), page.getByRole('link', { name: 'Peu importe' }).click()])
    const propositions = page.getByRole('region', { name: /Choisissez un créneau/ }).getByRole('listitem').getByRole('link')
    await Promise.all([page.waitForURL(/creneau=/), propositions.nth(rang(info.project.name)).click()])
    await page.getByLabel('Prénom').fill('Hugo')
    await page.getByLabel('Nom', { exact: true }).fill(`Bloque${P.dupont.nom.slice(-4)}`)
    await page.getByLabel('Téléphone mobile').fill(P.bloque.local)
    const depuis = new Date(Date.now() - 1000)
    await page.getByRole('button', { name: 'Recevoir mon code →' }).click()
    await saisirCodeEnCases(page, await codePatient(P.bloque.telephone, 'reservation', depuis))
    const confirmer = page.getByRole('button', { name: 'Confirmer mon rendez-vous' })
    if (await confirmer.isVisible().catch(() => false)) await confirmer.click().catch(() => {})
    await expect(
      page.getByText('La réservation en ligne n’est pas disponible pour ce numéro. Merci d’appeler le cabinet.'),
    ).toBeVisible({ timeout: 30_000 })
    const prisma = client()
    expect(await prisma.rendezVous.count({ where: { patient: { telephone: P.bloque.telephone } } })).toBe(0)
    await prisma.$disconnect()
  })
})

test.describe('Mes rendez-vous', () => {
  test('un numéro inconnu reçoit exactement le même message qu’un numéro de patient', async ({ page }, info) => {
    // Un numéro inconnu propre à la passe et au navigateur : cinq demandes par heure et par numéro (D71).
    const inconnu = `06909${rang(info.project.name)}${etat.suffixe.slice(-4)}`
    await page.goto('/mes-rendez-vous')
    await page.getByLabel('Votre numéro de téléphone').fill(inconnu)
    await page.getByRole('button', { name: 'Recevoir un code' }).click()
    await expect(
      page.getByText(new RegExp(`Si ce numéro est connu du cabinet, un code vient de partir au •+${inconnu.slice(-2)}\\.`)),
    ).toBeVisible()
  })

  test('Madame Dupont voit ses rendez-vous ; à moins de 24 h, pas d’annulation en ligne mais le déplacement reste', async ({
    page,
  }) => {
    await ouvrirMesRendezVous(page, P.dupont.local, P.dupont.telephone)
    const bientot = carte(page, new Date(P.rdvDans3Heures.debut))
    await expect(bientot).toContainText(
      'Dans moins de 24 heures : plus d’annulation en ligne, mais vous pouvez encore le déplacer.',
    )
    await expect(bientot.getByRole('button', { name: 'Annuler' })).toHaveCount(0)
    await expect(bientot.getByRole('button', { name: 'Déplacer' })).toBeVisible()
    await expect(carte(page, new Date(P.rdvDans5Jours.debut)).getByRole('button', { name: 'Annuler' })).toBeVisible()
    await sansDefilementHorizontal(page)
  })

  test('elle déplace un rendez-vous sur un créneau libre : il change d’heure, sans absence comptée', async ({
    page,
  }, info) => {
    const rdv = await rendezVousDupont(etat, 8, `${String(9 + rang(info.project.name)).padStart(2, '0')}:00`)
    await ouvrirMesRendezVous(page, P.dupont.local, P.dupont.telephone)
    const c = carte(page, rdv.debut)
    await c.getByRole('button', { name: 'Déplacer' }).click()
    const choix = page.locator('button[aria-pressed]')
    await expect(choix.first()).toBeVisible()
    // Le dernier bouton proposé est un horaire (les premiers peuvent être des jours).
    await choix.last().click()
    await page.getByRole('button', { name: 'Confirmer le déplacement' }).click()
    await expect
      .poll(async () => (await lireRendezVous(rdv.id)).debut.getTime(), { timeout: 20_000 })
      .not.toBe(rdv.debut.getTime())
    const prisma = client()
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: P.dupont.id } })).manquements).toBe(0)
    await prisma.$disconnect()
  })

  test('elle annule un rendez-vous à plus de 24 h : il disparaît de sa liste, une absence est comptée', async ({
    page,
  }, info) => {
    const rdv = await rendezVousDupont(etat, 9, `${String(9 + rang(info.project.name)).padStart(2, '0')}:00`)
    const prisma = client()
    const avant = (await prisma.patient.findUniqueOrThrow({ where: { id: P.dupont.id } })).manquements
    await ouvrirMesRendezVous(page, P.dupont.local, P.dupont.telephone)
    const c = carte(page, rdv.debut)
    // Un premier toucher ne fait que demander confirmation, en disant ce que coûte une annulation.
    await c.getByRole('button', { name: 'Annuler' }).click()
    await expect(c.getByText(/Une annulation compte comme une absence/)).toBeVisible()
    await c.getByRole('button', { name: 'Garder mon rendez-vous' }).click()
    await expect(c.getByText(/Une annulation compte comme une absence/)).toHaveCount(0)
    expect((await lireRendezVous(rdv.id)).statut).toBe('CONFIRME')

    await c.getByRole('button', { name: 'Annuler' }).click()
    await c.getByRole('button', { name: 'Oui, annuler' }).click()
    await expect(page.getByText('Votre rendez-vous est annulé. Le créneau est de nouveau disponible.')).toBeVisible()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).statut).toBe('ANNULE')
    expect((await prisma.patient.findUniqueOrThrow({ where: { id: P.dupont.id } })).manquements).toBe(avant + 1)
    // On remet le compteur : les autres parcours ne doivent pas hériter de cette absence.
    await prisma.patient.update({ where: { id: P.dupont.id }, data: { manquements: avant } })
    await prisma.$disconnect()
  })

  test('elle coupe les « autres messages » ; le choix tient au rechargement, les rappels restent', async ({ page }) => {
    // Repart des réglages par défaut : un autre navigateur a pu les changer juste avant.
    const prisma0 = client()
    await prisma0.preferenceNotification.deleteMany({ where: { destinataire: P.dupont.telephone } })
    await prisma0.$disconnect()
    await ouvrirMesRendezVous(page, P.dupont.local, P.dupont.telephone)
    const autres = page.getByRole('switch', { name: /Autres messages/ })
    const rappels = page.getByRole('switch', { name: /Rappels de rendez-vous/ })
    // L'interrupteur se touche par son libellé, comme le fait le patient (la case elle-même est masquée).
    const libelleAutres = page.getByText('Autres messages', { exact: true })
    if (!(await autres.isChecked())) {
      await libelleAutres.click()
      await expect(autres).toBeChecked()
    }
    await libelleAutres.click()
    await expect(autres).not.toBeChecked()
    await expect
      .poll(async () => {
        const prisma = client()
        const ligne = await prisma.preferenceNotification.findFirst({
          where: { destinataire: P.dupont.telephone, canal: 'SMS' },
        })
        await prisma.$disconnect()
        return ligne?.nonEssentiels
      })
      .toBe(false)
    await page.reload()
    await expect(page.getByRole('switch', { name: /Autres messages/ })).not.toBeChecked()
    await expect(rappels).toBeChecked()
  })
})

test.describe('Ce qui reste fermé au patient', () => {
  test('« Fermer mon espace » le referme : un retour arrière ne rouvre rien', async ({ page }) => {
    await ouvrirMesRendezVous(page, P.dupont.local, P.dupont.telephone)
    await page.getByRole('button', { name: 'Fermer mon espace' }).click()
    await expect(page.getByText('Votre espace est fermé. À bientôt.')).toBeVisible()
    await expect(page.getByLabel('Votre numéro de téléphone')).toBeVisible()
    // Le retour arrière ne doit pas réafficher les rendez-vous depuis la mémoire du navigateur.
    await page.goBack()
    await page.waitForLoadState('load')
    await expect(page.getByRole('heading', { name: 'Mes rendez-vous passés' })).toHaveCount(0)
    await expect(page.getByLabel('Votre numéro de téléphone')).toBeVisible()
  })

  test('l’espace du cabinet le renvoie à la connexion du personnel', async ({ page }) => {
    for (const chemin of ['/tableau-de-bord', '/tableau-de-bord/patients', '/tableau-de-bord/agenda']) {
      await page.goto(chemin)
      await expect(page).toHaveURL(/\/connexion/)
    }
  })

  test('aucune page publique ne déborde en largeur, et aucune ne nomme un patient', async ({ page }) => {
    for (const chemin of [
      '/',
      '/rendez-vous',
      '/mes-rendez-vous',
      '/cabinets/marie-galante',
      '/rendez-vous/liste-attente',
    ]) {
      await page.goto(chemin)
      await page.waitForLoadState('networkidle')
      await sansDefilementHorizontal(page)
      await expect(page.getByText(P.dupont.nom)).toHaveCount(0)
    }
  })
})

test.describe('L’assistant des urgences (D77)', () => {
  test('M. Pelage décrit sa douleur, répond à trois questions et réserve le créneau d’urgence (urgence forte)', async ({
    page,
  }, info) => {
    const prisma = client()
    const urgence = await prisma.motifConsultation.findFirstOrThrow({
      where: { estUrgence: true, actif: true },
      orderBy: [{ ordre: 'asc' }, { createdAt: 'asc' }],
      select: { id: true },
    })
    // Le praticien du portail prend les urgences, comme ceux de la démo (25/10).
    await prisma.praticienMotif.upsert({
      where: { praticienId_motifId: { praticienId: P.praticien.id, motifId: urgence.id } },
      update: {},
      create: { praticienId: P.praticien.id, motifId: urgence.id, dureeMinutes: 15 },
    })
    await prisma.$disconnect()
    const nouveau = P.nouveaux[info.project.name] ?? P.nouveaux.chrome!
    const telephone = `${nouveau.telephone.slice(0, 7)}5${nouveau.telephone.slice(8)}`
    const local = `0${telephone.slice(4)}`

    await page.goto('/')
    await page.getByRole('button', { name: 'Urgence dentaire ?' }).click()
    const fenetre = page.getByRole('dialog', { name: 'Assistant du cabinet' })
    await fenetre.getByLabel('Votre message').fill('J’ai très mal à une dent en bas à droite depuis hier, et ma joue a gonflé.')
    await fenetre.getByLabel('Votre message').press('Enter')
    await expect(fenetre.getByText('Avez-vous de la fièvre ?')).toBeVisible({ timeout: 30_000 })
    await fenetre.getByRole('button', { name: 'Un peu' }).click()
    await expect(fenetre.getByText('Avez-vous du mal à avaler ou à respirer ?')).toBeVisible()
    await fenetre.getByRole('button', { name: 'Non', exact: true }).click()
    await expect(fenetre.getByText('Et votre douleur, comment est-elle ?')).toBeVisible()
    await fenetre.getByRole('button', { name: 'Forte, elle me réveille' }).click()
    // Fièvre et joue gonflée : urgence forte, à voir sous 48 heures.
    await expect(fenetre.getByText('Urgence forte · sous 48 heures')).toBeVisible()

    await fenetre.getByRole('button', { name: /Je prends/ }).first().click()
    await fenetre.getByLabel('Prénom').fill('Jean-Marc')
    await fenetre.getByLabel('Nom', { exact: true }).fill(`Pelage${Date.now() % 10000}`)
    await fenetre.getByLabel('Portable').fill(local)
    const depuis = new Date(Date.now() - 1000)
    await fenetre.getByRole('button', { name: 'Recevoir le code par SMS' }).click()
    await fenetre.getByLabel(/Code envoyé au/).fill(await codePatient(telephone, 'reservation', depuis))
    await fenetre.getByRole('button', { name: 'Confirmer le rendez-vous' }).click()
    await expect(fenetre.getByText('C’est réservé')).toBeVisible()

    const verif = client()
    const conversation = await verif.conversationAssistant.findFirstOrThrow({
      where: { rendezVous: { patient: { telephone } } },
      select: { niveau: true, rendezVous: { select: { motifId: true } } },
    })
    await verif.$disconnect()
    expect(conversation).toMatchObject({ niveau: 'URGENCE_FORTE', rendezVous: { motifId: urgence.id } })
  })

  test('une urgence vitale : le 15, et aucun créneau', async ({ page }) => {
    await page.goto('/rendez-vous')
    await page.getByRole('button', { name: 'Urgence dentaire ?' }).click()
    const fenetre = page.getByRole('dialog', { name: 'Assistant du cabinet' })
    await fenetre.getByLabel('Votre message').fill('Ma joue a beaucoup gonflé, j’ai du mal à respirer.')
    await fenetre.getByRole('button', { name: 'Envoyer' }).click()
    await expect(fenetre.getByText('Appelez le 15 maintenant', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(fenetre.getByRole('link', { name: 'Appeler le 15' })).toHaveAttribute('href', 'tel:15')
    await expect(fenetre.getByRole('button', { name: /Je prends/ })).toHaveCount(0)
    await expect(fenetre.getByLabel('Votre message')).toHaveCount(0)
    // Après l'hôpital, le suivi au cabinet.
    await fenetre.getByRole('button', { name: 'Après l’hôpital : prendre un rendez-vous de suivi' }).click()
    await expect(fenetre.getByText(/Pour le suivi de votre dent|Aucune place n’est libre en ligne pour le suivi/)).toBeVisible()
    await sansDefilementHorizontal(page)
  })
})
