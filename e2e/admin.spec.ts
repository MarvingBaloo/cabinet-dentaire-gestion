import { expect, test } from '@playwright/test'

import { client, lireEtat } from './donnees'
import { sansDefilementHorizontal, surveillerConsole } from './outils'

// La journée d'Aline Gustave, administratrice du cabinet, jouée dans le navigateur : comptes, modèles de SMS,
// menu des patients, déblocage, journal, les deux cabinets.
//
// Les comptes et les postes ne se jouent que sur demande (E2E_COMPTES=1), sous Chrome : la base de test garde des
// milliers de comptes et de postes laissés par les passes précédentes (le journal les cite, ils ne s'effacent pas),
// et ces pages les listent tous — de longues minutes d'affichage en développement, là où un cabinet en compte une
// dizaine.

const etat = lireEtat()
const P = etat.portail

test.use({
  storageState: async ({}, fournir, info) => {
    await fournir(`e2e/.auth/admin-${info.project.name}.json`)
  },
})
surveillerConsole(test)

test('l’accueil d’Aline, avec l’onglet Réglages que la secrétaire n’a pas', async ({ page }) => {
  await page.goto('/tableau-de-bord')
  await expect(page.getByRole('heading', { name: 'Bonjour Aline' })).toBeVisible()
  await expect(
    page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Réglages' }),
  ).toBeVisible()
  await sansDefilementHorizontal(page)
})

test('elle voit les deux cabinets : le rendez-vous de Guadeloupe apparaît dans la vue regroupée', async ({ page }) => {
  await page.goto(`/tableau-de-bord/agenda?site=tous&date=${etat.aujourdhui}`)
  await expect(page.getByText(etat.patients.guadeloupe.nom).filter({ visible: true }).first()).toBeVisible()
})

test('elle modifie le rappel J-2, puis revient au texte par défaut', async ({ page }) => {
  await page.goto('/tableau-de-bord/messages')
  await page.getByRole('button', { name: /^Rappel 2 jours avant/ }).click()
  const texte = `{cabinet} : RDV le {date} à {heure}. Essai ${test.info().project.name}.`
  await page.locator('#corps').fill(texte)
  await page.getByRole('button', { name: 'Enregistrer' }).click()
  const prisma = client()
  await expect
    .poll(async () => (await prisma.modeleMessage.findFirst({ where: { type: 'RAPPEL_J2', canal: 'SMS' } }))?.corps)
    .toBe(texte)
  await page.getByRole('button', { name: 'Revenir au texte par défaut' }).click()
  const confirmer = page.getByRole('dialog').getByRole('button', { name: /Revenir|Confirmer/ })
  if (await confirmer.count()) await confirmer.first().click()
  await expect.poll(async () => prisma.modeleMessage.count({ where: { type: 'RAPPEL_J2', canal: 'SMS' } })).toBe(0)
  await prisma.$disconnect()
})

test('elle renomme une entrée du menu de réservation en ligne', async ({ page }) => {
  const prisma = client()
  const nouveau = `${P.menuLibelle} — ${test.info().project.name}`
  try {
    await page.goto('/tableau-de-bord/motifs')
    // La plus petite carte qui porte à la fois le titre de l'entrée et son bouton « Modifier ».
    const carte = page
      .locator('div, section, article, li')
      .filter({ has: page.getByRole('heading', { name: P.menuLibelle }) })
      .filter({ has: page.getByRole('button', { name: 'Modifier' }) })
      .last()
    await carte.getByRole('button', { name: 'Modifier' }).click()
    await page.locator(`#libelle-${P.menuId}`).fill(nouveau)
    await page
      .locator(`#libelle-${P.menuId}`)
      .locator('xpath=ancestor::form')
      .getByRole('button', { name: /Enregistrer/ })
      .click()
    await expect
      .poll(async () => (await prisma.motifPatient.findUniqueOrThrow({ where: { id: P.menuId } })).libelle)
      .toBe(nouveau)
  } finally {
    // Le parcours du patient, joué ensuite, cherche cette entrée sous son nom d'origine.
    await prisma.motifPatient.update({ where: { id: P.menuId }, data: { libelle: P.menuLibelle } })
    await prisma.$disconnect()
  }
})

test('elle débloque une patiente sanctionnée après trois absences', async ({ page }) => {
  const prisma = client()
  const zoe = await prisma.patient.create({
    data: {
      nom: `Sanction${etat.suffixe.slice(-5)}${test.info().project.name}`,
      prenom: 'Zoé',
      telephone: '+590690100077',
      manquements: 3,
      reservationBloquee: true,
    },
  })
  await page.goto('/tableau-de-bord/patients/bloques')
  await page
    .getByRole('row')
    .filter({ hasText: zoe.nom })
    .getByRole('button', { name: /Débloquer/ })
    .click()
  const confirmer = page.getByRole('dialog').getByRole('button', { name: /Débloquer|Confirmer/ })
  if (await confirmer.count()) await confirmer.first().click()
  await expect
    .poll(async () => (await prisma.patient.findUniqueOrThrow({ where: { id: zoe.id } })).reservationBloquee)
    .toBe(false)
  await prisma.$disconnect()
})

test('elle lit le journal', async ({ page }) => {
  await page.goto('/tableau-de-bord/journal')
  await expect(page.getByRole('heading', { name: 'Journal', level: 1 })).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)
})

test.describe('Comptes et postes (Chrome seulement)', () => {
  // Facultatifs (E2E_COMPTES=1) : la base de test garde des milliers de comptes et de postes que ces pages listent
  // tous — de longues minutes par affichage. Leur logique est éprouvée à chaque passe par tests/role-admin.test.ts.
  test.skip(
    ({ browserName, isMobile }) => process.env.E2E_COMPTES !== '1' || browserName !== 'chromium' || isMobile,
    'pages très longues sur la base de test (E2E_COMPTES=1 pour les jouer)',
  )
  // Cinq minutes : assez pour une base de test chargée, assez court pour qu'un clic bloqué échoue au lieu d'attendre
  // quarante minutes (23/10 : un bouton recouvert n'est apparu qu'au bout de ce délai).
  test.setTimeout(300_000)

  test('elle crée le compte de Lina avec son mobile, change son numéro, désactive le compte — jamais le sien', async ({
    page,
  }) => {
    const email = `lina-${etat.suffixe}@test.local`
    await page.goto('/tableau-de-bord/comptes', { timeout: 600_000 })
    // Sa propre ligne : « vous », et aucun bouton pour se désactiver.
    const sienne = page.getByRole('row').filter({ hasText: etat.admin!.email })
    await expect(sienne.getByText('vous', { exact: true })).toBeVisible()
    await expect(sienne.getByRole('button', { name: /^Désactiver/ })).toHaveCount(0)
    const formulaire = page.getByRole('region', { name: 'Ajouter une personne' })
    await formulaire.getByLabel('Prénom').fill('Lina')
    await formulaire.getByLabel('Nom', { exact: true }).fill(`Assistante${etat.suffixe.slice(-5)}`)
    await formulaire.getByLabel('Adresse professionnelle').fill(email)
    await formulaire.getByLabel('Téléphone mobile').fill('0690 77 66 55')
    await formulaire.getByLabel('Mot de passe provisoire').fill('Un-mot-de-passe-provisoire')
    await formulaire.getByRole('checkbox', { name: 'Assistante' }).check()
    await formulaire.getByRole('button', { name: 'Créer le compte' }).click()
    await expect(page.getByText(/Compte créé pour Lina/)).toBeVisible({ timeout: 600_000 })

    const prisma = client()
    const lina = await prisma.user.findUniqueOrThrow({ where: { email } })
    expect(lina.telephoneMobile).toBe('+590690776655')

    await page.reload({ timeout: 600_000 })
    const ligne = page.getByRole('row').filter({ hasText: email })
    await ligne.getByText('Changer le numéro').click()
    await ligne.getByLabel(/Nouveau mobile/).fill('0690 44 33 22')
    await ligne.getByRole('button', { name: 'Enregistrer le numéro' }).click()
    await expect
      .poll(async () => (await prisma.user.findUniqueOrThrow({ where: { email } })).telephoneMobile, {
        timeout: 600_000,
      })
      .toBe('+590690443322')

    await ligne.getByRole('button', { name: /^Désactiver/ }).click()
    await expect
      .poll(async () => (await prisma.user.findUniqueOrThrow({ where: { email } })).actif, { timeout: 600_000 })
      .toBe(false)
    await prisma.$disconnect()
  })

  test('elle ouvre la liste des postes de travail', async ({ page }) => {
    await page.goto('/tableau-de-bord/postes', { timeout: 600_000 })
    await expect(page.getByRole('heading', { name: 'Postes de travail' })).toBeVisible()
  })
})

test.describe('La rétrocession (D81)', () => {
  test('elle règle la part d’un praticien, puis le relevé du mois le montre et elle le marque versé', async ({ page }, info) => {
    // Un praticien à soi par navigateur : les trois passes ne se marchent pas dessus.
    const prisma = client()
    const nom = `Retro${info.project.name}${etat.suffixe.slice(-5)}`
    const site = await prisma.site.findUniqueOrThrow({ where: { code: 'MARIE_GALANTE' } })
    const fauteuil = await prisma.fauteuil.create({ data: { siteId: site.id, nom: `Fauteuil ${nom}` } })
    const praticien = await prisma.praticien.create({ data: { nom, prenom: 'Léa', couleur: '#7A4FB5' } })
    const maintenant = new Date()
    await prisma.rendezVous.create({
      data: {
        patientId: etat.patients.dupont.id,
        praticienId: praticien.id,
        siteId: site.id,
        fauteuilId: fauteuil.id,
        motifId: etat.motifId,
        debut: new Date(maintenant.getTime() - 3 * 3600_000),
        fin: new Date(maintenant.getTime() - 2.5 * 3600_000),
        statut: 'EN_CAISSE',
        montantCentimes: 50000,
        encaisseLe: maintenant,
      },
    })
    await prisma.$disconnect()

    await page.goto('/tableau-de-bord/reglages-retrocession')
    await expect(page.getByRole('heading', { name: 'Rétrocession' })).toBeVisible({ timeout: 30_000 })
    const part = page.getByLabel(new RegExp(`Dr Léa ${nom}`))
    await part.fill('60')
    await part.locator('xpath=ancestor::form').getByRole('button', { name: 'Enregistrer' }).click()
    await expect(part.locator('xpath=ancestor::form').getByRole('status')).toHaveText('Part enregistrée.')

    await page.goto('/tableau-de-bord/statistiques/retrocession')
    const ligne = page.getByRole('listitem', { name: `Dr Léa ${nom}` })
    await expect(ligne).toContainText('500 €')
    await expect(ligne).toContainText('60 %')
    await expect(ligne).toContainText('300 €')
    await ligne.getByRole('button', { name: /Marquer comme versé/ }).click()
    await expect(page.getByRole('listitem', { name: `Dr Léa ${nom}` })).toContainText('Versé le')
    await sansDefilementHorizontal(page)
  })
})
