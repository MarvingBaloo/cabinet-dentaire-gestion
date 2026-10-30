import { devices, expect, test, type Page } from '@playwright/test'

import {
  MOT_DE_PASSE,
  client,
  codeRecu,
  decaler,
  heureDans,
  instant,
  lireEtat,
  lireRendezVous,
  rendezVousFrais,
  telephoneDeConfiance,
  terminerRendezVous,
} from './donnees'
import { demanderLeCodeSms, sansDefilementHorizontal, surveillerConsole } from './outils'

// La journée de Nadège Lebon, secrétaire à Marie-Galante, jouée dans le navigateur. Ce que les tests du serveur
// (tests/role-secretaire.test.ts) ne voient pas : ce qui ne part pas, ce qui s'affiche vide, ce qui se
// réinitialise — et ce que l'écran laisse deviner de la Guadeloupe.

const etat = lireEtat()
const demain = decaler(etat.aujourdhui, 1)

surveillerConsole(test)

async function ouvrirRendezVous(page: Page, jour: string, nomPatient: string) {
  await page.goto(`/tableau-de-bord/agenda?date=${jour}`)
  await page.getByRole('listitem').filter({ hasText: nomPatient }).getByRole('button').first().click()
  const panneau = page.getByRole('complementary', { name: new RegExp(`Rendez-vous de .*${nomPatient}`) })
  await expect(panneau).toBeVisible()
  return panneau
}

test.describe('Accueil et navigation', () => {
  test('l’accueil montre la journée de Marie-Galante, et rien de la Guadeloupe', async ({ page }) => {
    await page.goto('/tableau-de-bord')
    // 30 s : la première ouverture après une mise à jour compile tout à froid.
    await expect(page.getByRole('heading', { name: 'Bonjour Nadège' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(`Marie ${etat.patients.dupont.nom}`).first()).toBeVisible()
    await expect(page.getByText(etat.patients.guadeloupe.nom)).toHaveCount(0)
    await expect(page.getByText(etat.praticienGP.nom)).toHaveCount(0)
    await expect(page.getByText('Cabinet de Guadeloupe')).toHaveCount(0)

    const rail = page.getByRole('navigation', { name: 'Navigation principale' })
    await expect(rail.getByRole('link', { name: 'Accueil' })).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Agenda' })).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Patients' })).toBeVisible()
    await expect(rail.getByRole('link', { name: 'Réglages' })).toHaveCount(0)
    await sansDefilementHorizontal(page)
  })

  test('au clavier, Tab passe par « Aller au contenu » puis le menu — Safari compris (24/10)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'pas de clavier sur le téléphone')
    await page.goto('/tableau-de-bord/agenda')
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 30_000 })
    // La première fois, la page peut n'avoir pas fini de charger : on repart du haut et on recommence.
    await expect(async () => {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      await page.keyboard.press('Tab')
      await expect(page.getByRole('link', { name: 'Aller au contenu' })).toBeFocused({ timeout: 1_000 })
    }).toPass()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Accueil' })).toBeFocused()
  })

  test('le menu du compte la présente comme « Secrétaire »', async ({ page }) => {
    await page.goto('/tableau-de-bord')
    await page.locator('summary', { hasText: 'Compte de Nadège Lebon' }).click()
    await expect(page.getByText(etat.secretaire.email)).toBeVisible()
    await expect(page.getByText('secrétaire', { exact: true })).toBeVisible()
  })

  for (const [chemin, titre] of [
    ['/tableau-de-bord/comptes', 'Comptes du personnel'],
    ['/tableau-de-bord/postes', 'Postes de travail'],
    ['/tableau-de-bord/journal', 'Journal'],
    ['/tableau-de-bord/messages', 'Modèles de messages'],
  ] as const) {
    test(`l’adresse ${chemin} tapée à la main répond « réservé à l’administrateur », sans onglets`, async ({
      page,
    }) => {
      await page.goto(chemin)
      await expect(page.getByRole('heading', { name: titre })).toBeVisible()
      await expect(page.getByRole('status')).toHaveText('Cet écran est réservé à l’administrateur du cabinet.')
      await expect(page.getByRole('navigation', { name: 'Onglets' }).getByRole('link')).toHaveCount(0)
    })
  }

  test('pas d’icône « Statistiques », et l’adresse tapée à la main est refusée, sans onglets (D73)', async ({ page }) => {
    await page.goto('/tableau-de-bord')
    await expect(page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Agenda' })).toBeVisible()
    await expect(
      page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Statistiques' }),
    ).toHaveCount(0)
    await page.goto('/tableau-de-bord/statistiques/absences')
    await expect(page.getByRole('status')).toHaveText('Les statistiques sont réservées aux praticiens et à l’administrateur.')
    await expect(page.getByRole('navigation', { name: 'Onglets' }).getByRole('link')).toHaveCount(0)
  })

  test('le menu des patients est en lecture seule', async ({ page }) => {
    await page.goto('/tableau-de-bord/motifs')
    await expect(page.getByText('Lecture seule · modifiable par l’administrateur du cabinet')).toBeVisible()
    await expect(page.getByRole('main').getByRole('button')).toHaveCount(0)
  })

  test('elle voit les patients bloqués, mais le déblocage reste à l’administrateur', async ({ page }) => {
    const prisma = client()
    const bloque = await prisma.patient.create({
      data: {
        nom: `Bloque${etat.suffixe.slice(-5)}${test.info().project.name}`,
        prenom: 'Zoé',
        telephone: '+590690100009',
        manquements: 3,
        reservationBloquee: true,
      },
    })
    await prisma.$disconnect()
    await page.goto('/tableau-de-bord/patients/bloques')
    const ligne = page.getByRole('row').filter({ hasText: bloque.nom })
    await expect(ligne).toContainText('Déblocage par un administrateur')
    await expect(page.getByRole('button', { name: /Débloquer/ })).toHaveCount(0)
  })
})

test.describe('Le patient, du téléphone au fauteuil', () => {
  test('depuis l’accueil, « Arrivé » fait passer le patient en salle d’attente, et ça tient au rechargement', async ({
    page,
  }) => {
    // Dans la demi-heure écoulée, sur cinq minutes : l'accueil n'affiche que les cinq prochains rendez-vous, et
    // ceux des autres parcours ne doivent pas repousser celui-ci hors de la liste.
    const { patient, rdv } = await rendezVousFrais(etat, { apres: heureDans(-25), duree: 5, pas: 5 })
    await page.goto('/tableau-de-bord')
    const ligne = page.getByRole('listitem').filter({ hasText: patient.nom })
    await ligne.getByRole('button', { name: 'Arrivé →', exact: true }).click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).statut).toBe('SALLE_ATTENTE')
    await page.reload()
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: patient.nom })
        .getByRole('button', { name: 'Arrivé →', exact: true }),
    ).toHaveCount(0)
    await terminerRendezVous(rdv.id)
  })

  test('la recherche ⌘K retrouve Madame Dupont et ouvre son prochain rendez-vous, puis sa fiche', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'la barre de recherche n’existe qu’à partir de la tablette')
    await page.goto('/tableau-de-bord')
    await page.getByRole('combobox', { name: 'Chercher un patient' }).fill(etat.patients.dupont.nom)
    const option = page.getByRole('option').filter({ hasText: etat.patients.dupont.nom })
    await expect(option).toBeVisible()
    await option.click()
    // Au téléphone, c'est le prochain rendez-vous qu'on vient chercher (D66) : l'agenda s'ouvre dessus.
    await expect(page).toHaveURL(new RegExp(`rdv=${etat.rdv.dupontAujourdhui}`))
    const panneau = page.getByRole('complementary', { name: `Rendez-vous de Marie ${etat.patients.dupont.nom}` })
    await expect(panneau).toBeVisible()
    await panneau.getByRole('link', { name: 'Fiche du patient →' }).click()
    await expect(page).toHaveURL(new RegExp(`/patients/${etat.patients.dupont.id}`))
    await expect(page.getByRole('heading', { name: `Marie ${etat.patients.dupont.nom}` })).toBeVisible()
  })

  test('le patient de la Guadeloupe a une fiche, mais ses rendez-vous là-bas restent invisibles', async ({ page }) => {
    await page.goto(`/tableau-de-bord/patients/${etat.patients.guadeloupe.id}`)
    await expect(page.getByRole('heading', { name: `Gaston ${etat.patients.guadeloupe.nom}` })).toBeVisible()
    await expect(page.getByText(etat.praticienGP.nom)).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Rendez-vous à venir' }).getByRole('link')).toHaveCount(0)
  })

  test('elle crée la fiche d’un nouveau patient et lui donne rendez-vous sur un créneau libre', async ({ page }) => {
    const nom = `Nouveau${etat.suffixe.slice(-5)}${test.info().project.name}`
    await page.goto(`/tableau-de-bord/agenda/nouveau?date=${demain}`)
    await page.getByRole('button', { name: '+ Le patient n’est pas au fichier' }).click()
    await page.locator('#nom-patient').fill(nom)
    await page.locator('#prenom-patient').fill('Inès')
    await page.locator('#telephone-patient').fill('0690 55 44 33')
    await page.getByRole('button', { name: 'Créer la fiche' }).click()
    await expect(page.getByText(nom).first()).toBeVisible()

    await page.getByLabel('Praticien').selectOption({ label: `Dr Claire ${etat.praticienMG.nom}` })
    await page.getByLabel('Motif').selectOption({ label: `Détartrage E2E ${etat.suffixe}` })
    await page.locator('button[aria-pressed]').first().click()
    await expect(page.locator('button[aria-pressed="true"]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Enregistrer le rendez-vous' }).click()

    const prisma = client()
    await expect.poll(async () => prisma.rendezVous.count({ where: { patient: { nom } } }), { timeout: 20_000 }).toBe(1)
    const cree = await prisma.patient.findFirstOrThrow({ where: { nom } })
    await prisma.$disconnect()
    // Le numéro tapé à la française est enregistré au format international (D65).
    expect(cree.telephone).toBe('+590690554433')
  })
})

test.describe('La fiche d’un rendez-vous dans l’agenda', () => {
  test('« Demander l’annulation » : la demande part, le rendez-vous reste au planning, aucun bouton pour valider', async ({
    page,
  }) => {
    const { patient, rdv, jour } = await rendezVousFrais(etat, { jour: demain })
    const panneau = await ouvrirRendezVous(page, jour, patient.nom)
    await expect(panneau.getByRole('button', { name: /Valider l’annulation|Refuser/ })).toHaveCount(0)
    await panneau.getByRole('button', { name: 'Demander l’annulation' }).click()
    const confirmation = page.getByRole('dialog')
    await expect(confirmation).toContainText('Le praticien devra la valider. D’ici là, le créneau reste réservé.')
    await confirmation.getByRole('button', { name: 'Demander l’annulation' }).click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).statut).toBe('ANNULATION_DEMANDEE')
    await page.reload()
    await expect(page.getByRole('listitem').filter({ hasText: patient.nom })).toBeVisible()
  })

  test('« Le patient est arrivé » depuis la fiche du rendez-vous', async ({ page }) => {
    // Un patient attendu il y a quelques minutes, sur cinq minutes : le parcours « déplace » remplit la soirée
    // de rendez-vous. Passé 23h en Guadeloupe, la journée est pleine : le lendemain matin fait aussi bien l'affaire.
    const { patient, rdv, jour } = await rendezVousFrais(etat, { apres: heureDans(-20), duree: 5, pas: 5 }).catch(() =>
      rendezVousFrais(etat, { jour: demain, duree: 5, pas: 5 }),
    )
    const panneau = await ouvrirRendezVous(page, jour, patient.nom)
    await panneau.getByRole('button', { name: 'Le patient est arrivé →' }).click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).statut).toBe('SALLE_ATTENTE')
    await terminerRendezVous(rdv.id)
  })

  test('un second clic sur le rendez-vous referme sa fiche (24/10)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'sur le téléphone, la fiche couvre l’écran : elle se ferme par sa croix')
    const { patient, jour } = await rendezVousFrais(etat, { jour: demain })
    const panneau = await ouvrirRendezVous(page, jour, patient.nom)
    await page.getByRole('listitem').filter({ hasText: patient.nom }).getByRole('button').first().click()
    await expect(panneau).toBeHidden()
  })

  test('elle déplace un rendez-vous sur un créneau libre proposé', async ({ page }) => {
    const { patient, rdv, jour } = await rendezVousFrais(etat, { jour: demain })
    const panneau = await ouvrirRendezVous(page, jour, patient.nom)
    const deplacer = panneau.getByRole('region', { name: 'Déplacer' })
    const creneau = deplacer.getByRole('button', { name: /\d{1,2}[:h]\d{2}/ }).first()
    await expect(creneau).toBeVisible()
    await creneau.click()
    const confirmer = page.getByRole('button', { name: /Confirmer|Déplacer ici|Valider/ })
    if (await confirmer.count()) await confirmer.first().click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).debut.getTime()).not.toBe(rdv.debut.getTime())
  })
})

test.describe('Le glisser-déposer (23/10)', () => {
  test('elle glisse un rendez-vous : la carte suit, le bandeau confirme, « Annuler » le remet en place', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'la grille par fauteuil n’existe qu’à partir de la tablette')
    const frais = await rendezVousFrais(etat, { jour: demain, apres: '08:00' })
    const { patient } = frais
    const rdv = await lireRendezVous(frais.rdv.id)
    // Une place libre une heure ou plus plus tard, sur le même praticien : la journée de la passe est partagée.
    const prisma = client()
    const occupes = await prisma.rendezVous.findMany({
      where: { praticienId: rdv.praticienId, debut: { gte: instant(frais.jour, '00:00'), lt: instant(frais.jour, '23:59') } },
      select: { debut: true, fin: true },
    })
    await prisma.$disconnect()
    const quart = 15 * 60_000
    const duree = rdv.fin.getTime() - rdv.debut.getTime()
    let k = 4
    while (
      occupes.some(
        (o) =>
          o.debut.getTime() < rdv.debut.getTime() + k * quart + duree &&
          o.fin.getTime() > rdv.debut.getTime() + k * quart &&
          o.debut.getTime() !== rdv.debut.getTime(),
      )
    )
      k++

    await page.goto(`/tableau-de-bord/agenda?date=${frais.jour}`)
    const carte = page.locator('article', { hasText: patient.nom })
    await carte.scrollIntoViewIfNeeded()
    const r = (await carte.boundingBox())!
    await page.mouse.move(r.x + r.width / 2, r.y + 10)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width / 2, r.y + 10 + k * 22, { steps: 15 })
    await page.mouse.up()

    const bandeau = page.getByRole('status').filter({ hasText: patient.nom })
    await expect(bandeau).toContainText('le patient sera prévenu par SMS')
    await expect.poll(async () => (await lireRendezVous(rdv.id)).debut.getTime()).toBe(rdv.debut.getTime() + k * quart)

    await bandeau.getByRole('button', { name: 'Annuler' }).click()
    await expect(page.getByRole('status').filter({ hasText: 'Déplacement annulé' })).toBeVisible()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).debut.getTime()).toBe(rdv.debut.getTime())
  })
})

test.describe('Un rendez-vous posé par l’assistant des urgences (D77)', () => {
  test('la fiche montre ce que le patient a dit, et le niveau se corrige', async ({ page }) => {
    const { patient, rdv, jour } = await rendezVousFrais(etat, { jour: demain })
    const prisma = client()
    const conversation = await prisma.conversationAssistant.create({
      data: {
        usage: 'URGENCES',
        ipAddress: '198.18.0.1',
        rendezVousId: rdv.id,
        niveau: 'URGENCE_FORTE',
        resume: ['Douleur forte, dent en bas à droite, depuis hier', 'Joue gonflée, un peu de fièvre'],
        raison: 'Urgence forte : créneau d’urgence le plus proche, dans les 48 heures.',
        messages: [
          { role: 'patient', texte: 'J’ai très mal et ma joue a gonflé.' },
          { role: 'assistant', texte: 'Avez-vous de la fièvre ?' },
        ],
      },
      select: { id: true },
    })
    await prisma.$disconnect()

    const panneau = await ouvrirRendezVous(page, jour, patient.nom)
    const section = panneau.getByRole('region', { name: 'Demande à l’assistant' })
    await expect(section).toContainText('Joue gonflée, un peu de fièvre')
    await expect(section).toContainText('Pourquoi ce créneau : Urgence forte')
    await expect(section.getByRole('button', { name: 'Urgence forte' })).toHaveAttribute('aria-pressed', 'true')
    await section.getByRole('button', { name: 'Différable' }).click()
    const verif = client()
    await expect
      .poll(async () => (await verif.conversationAssistant.findUniqueOrThrow({ where: { id: conversation.id } })).niveauCabinet)
      .toBe('DIFFERABLE')
    await verif.$disconnect()
    await expect(section).toContainText('l’assistant avait dit « Urgence forte »')
  })

  test('une urgence que l’assistant n’a pas pu placer apparaît sur l’accueil ; « Rappelé » la retire (D79)', async ({ page }) => {
    const prisma = client()
    const nom = `Rappel${Date.now() % 100000}`
    const demande = await prisma.conversationAssistant.create({
      data: {
        usage: 'URGENCES',
        ipAddress: '198.18.0.2',
        niveau: 'URGENCE_FORTE',
        resume: ['Douleur insupportable depuis hier soir'],
        contactPrenom: 'Jean-Marc',
        contactNom: nom,
        contactTelephone: '+33639981234',
        demandeLe: new Date(),
      },
      select: { id: true },
    })
    await prisma.$disconnect()

    await page.goto('/tableau-de-bord')
    const encart = page.getByRole('region', { name: 'Urgences à rappeler' })
    await expect(encart).toContainText(`Jean-Marc ${nom}`)
    await expect(encart).toContainText('Douleur insupportable depuis hier soir')
    await encart.getByRole('listitem').filter({ hasText: nom }).getByRole('button', { name: 'Rappelé ✓' }).click()
    const verif = client()
    await expect
      .poll(async () => (await verif.conversationAssistant.findUniqueOrThrow({ where: { id: demande.id } })).demandeTraiteeLe)
      .not.toBeNull()
    await verif.$disconnect()
    await expect(page.getByText(`Jean-Marc ${nom}`)).toHaveCount(0)
  })
})

test.describe('Le clavier dans l’agenda (24/10)', () => {
  test('elle déplace un rendez-vous aux flèches, valide par Entrée, puis « Annuler » le remet en place', async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'la grille par fauteuil n’existe qu’à partir de la tablette')
    const frais = await rendezVousFrais(etat, { jour: demain, apres: '08:00' })
    const rdv = await lireRendezVous(frais.rdv.id)
    // Un quart d'heure plus tôt ou plus tard, là où le praticien est libre.
    const prisma = client()
    const occupes = await prisma.rendezVous.findMany({
      where: { praticienId: rdv.praticienId, id: { not: rdv.id }, debut: { gte: instant(frais.jour, '00:00'), lt: instant(frais.jour, '23:59') } },
      select: { debut: true, fin: true },
    })
    await prisma.$disconnect()
    const quart = 15 * 60_000
    const libre = (d: number) => !occupes.some((o) => o.debut.getTime() < rdv.fin.getTime() + d && o.fin.getTime() > rdv.debut.getTime() + d)
    const vers = libre(quart) ? quart : -quart

    await page.goto(`/tableau-de-bord/agenda?date=${frais.jour}`)
    const carte = page.locator('article', { hasText: frais.patient.nom })
    await expect(async () => {
      await carte.focus()
      await page.keyboard.press(vers > 0 ? 'ArrowDown' : 'ArrowUp')
      await expect(page.getByRole('status').filter({ hasText: 'Entrée : valider' })).toBeVisible({ timeout: 1_000 })
    }).toPass()
    await page.keyboard.press('Enter')

    const bandeau = page.getByRole('status').filter({ hasText: frais.patient.nom })
    await expect(bandeau).toContainText('le patient sera prévenu par SMS')
    await expect.poll(async () => (await lireRendezVous(rdv.id)).debut.getTime()).toBe(rdv.debut.getTime() + vers)
    await expect(page.locator('article', { hasText: frais.patient.nom })).toBeFocused()

    await bandeau.getByRole('button', { name: 'Annuler' }).click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).debut.getTime()).toBe(rdv.debut.getTime())
  })

  test('un rendez-vous terminé ne se glisse pas, et le dit', async ({ page, isMobile }) => {
    test.skip(isMobile, 'la grille par fauteuil n’existe qu’à partir de la tablette')
    const { patient, rdv, jour } = await rendezVousFrais(etat, { jour: demain })
    await terminerRendezVous(rdv.id)
    await page.goto(`/tableau-de-bord/agenda?date=${jour}`)
    const carte = page.locator('article', { hasText: patient.nom })
    await expect(carte).toHaveAttribute('title', 'Rendez-vous terminé : il ne se déplace plus.')

    await carte.scrollIntoViewIfNeeded()
    const r = (await carte.boundingBox())!
    await page.mouse.move(r.x + r.width / 2, r.y + 8)
    await page.mouse.down()
    await page.mouse.move(r.x + r.width / 2, r.y + 120, { steps: 10 })
    await page.mouse.up()
    await expect(page.getByRole('alert').filter({ hasText: 'Rendez-vous terminé : il ne se déplace plus.' })).toBeVisible()
    // Lâché plus bas, sur la grille : ni fiche ouverte, ni « Nouveau rendez-vous ».
    await expect(page).toHaveURL(/\/tableau-de-bord\/agenda\?/)
    await expect(page.getByRole('complementary', { name: /Rendez-vous de/ })).toHaveCount(0)
    expect((await lireRendezVous(rdv.id)).debut.getTime()).toBe(rdv.debut.getTime())
  })

  test('les raccourcis : S, →, T, et ? pour l’aide', async ({ page, isMobile }) => {
    test.skip(isMobile, 'pas de clavier sur le téléphone')
    await page.goto(`/tableau-de-bord/agenda?date=${demain}`)
    await expect(page.getByRole('heading', { name: 'Agenda' })).toBeVisible({ timeout: 30_000 })
    // Tant que la page n'a pas fini de charger, la touche n'a encore personne pour l'écouter : on la redonne.
    await expect(async () => {
      await page.keyboard.press('s')
      await expect(page).toHaveURL(/vue=semaine/, { timeout: 2_000 })
    }).toPass()
    await expect(page.getByRole('link', { name: 'Semaine' })).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('ArrowRight')
    await expect(page).toHaveURL(new RegExp(`vue=semaine&date=${decaler(demain, 7)}`))
    await page.keyboard.press('t')
    await expect(page).toHaveURL(new RegExp(`date=${etat.aujourdhui}`))
    await page.keyboard.press('?')
    const aide = page.getByRole('dialog', { name: 'Raccourcis clavier' })
    await expect(aide).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(aide).toBeHidden()
  })
})

test.describe('La journée du cabinet', () => {
  test('elle écrit une note du jour, la retrouve, puis l’efface', async ({ page, isMobile }) => {
    const texte = `Livraison des gants ${test.info().project.name}`
    await page.goto(`/tableau-de-bord/agenda?date=${demain}`)
    const notes = page.getByRole('region', { name: 'Notes du jour' })
    // Au téléphone, les notes vivent dans le volet « Calendrier et filtres ».
    if (isMobile) await page.getByRole('button', { name: 'Calendrier et filtres' }).click()
    await notes.getByRole('button', { name: /Ajouter une note/ }).click()
    const fenetre = page.getByRole('dialog')
    await fenetre.getByLabel('Texte de la note').fill(texte)
    await expect(fenetre.getByText(`${texte.length} / 280 caractères`)).toBeVisible()
    await fenetre.getByRole('button', { name: 'Ajouter la note' }).click()
    await expect(notes.getByText(texte)).toBeVisible()
    await page.reload()
    if (isMobile) await page.getByRole('button', { name: 'Calendrier et filtres' }).click()
    await expect(notes.getByText(texte)).toBeVisible()
    await notes.getByRole('button', { name: new RegExp(texte) }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Supprimer la note' }).click()
    await expect(notes.getByText(texte)).toHaveCount(0)
  })

  test('les coordonnées : une adresse invalide est refusée sans effacer la saisie, puis acceptée corrigée', async ({
    page,
  }) => {
    const { patient } = await rendezVousFrais(etat, { jour: decaler(etat.aujourdhui, 2) })
    await page.goto('/tableau-de-bord/patients')
    await page.getByRole('searchbox', { name: 'Rechercher un patient' }).fill(patient.nom)
    await page.getByRole('searchbox', { name: 'Rechercher un patient' }).press('Enter')
    await expect(page).toHaveURL(/\?q=/)
    await page
      .getByRole('link', { name: new RegExp(patient.nom) })
      .first()
      .click()
    await expect(page.getByRole('heading', { name: `${patient.prenom} ${patient.nom}` })).toBeVisible()

    const coordonnees = page.getByRole('region', { name: 'Coordonnées' })
    await coordonnees.getByRole('button', { name: 'Modifier' }).click()
    const courriel = page.getByLabel(/E-mail/)
    await courriel.fill('pas-une-adresse')
    await page.getByRole('button', { name: /Enregistrer/ }).click()
    // Le navigateur refuse lui-même l'adresse (champ e-mail) : rien ne part, la saisie reste.
    expect(await courriel.evaluate((c: HTMLInputElement) => c.validity.valid)).toBe(false)
    await expect(courriel).toHaveValue('pas-une-adresse')

    await courriel.fill('ana@exemple.fr')
    await page.getByRole('button', { name: /Enregistrer/ }).click()
    await expect(coordonnees.getByText('ana@exemple.fr')).toBeVisible()
  })

  test('les onglets de l’agenda s’ouvrent : présences, congés, liste d’attente', async ({ page }) => {
    for (const [chemin, titre] of [
      ['/tableau-de-bord/presences', /Présences/],
      ['/tableau-de-bord/indisponibilites', /Congés/],
      ['/tableau-de-bord/liste-attente', /Liste d’attente/],
    ] as const) {
      await page.goto(chemin)
      await expect(page.getByRole('heading', { level: 1, name: titre })).toBeVisible()
      await expect(page.getByText(etat.patients.guadeloupe.nom)).toHaveCount(0)
      await sansDefilementHorizontal(page)
    }
  })

  test('aucun écran de sa journée ne déborde en largeur', async ({ page }) => {
    for (const chemin of [
      '/tableau-de-bord',
      `/tableau-de-bord/agenda?date=${etat.aujourdhui}`,
      `/tableau-de-bord/agenda?vue=semaine&date=${etat.aujourdhui}`,
      '/tableau-de-bord/patients',
      `/tableau-de-bord/patients/${etat.patients.dupont.id}`,
      '/tableau-de-bord/agenda/nouveau',
    ]) {
      await page.goto(chemin)
      await page.waitForLoadState('networkidle')
      await sansDefilementHorizontal(page)
    }
  })
})

test.describe('Un nouvel appareil', () => {
  // Un navigateur vierge : sa propre session, que la déconnexion peut fermer sans toucher aux autres parcours.
  test.use({ storageState: { cookies: [], origins: [] } })

  test('son téléphone reconnu valide la connexion : elle vise le QR, touche « Oui », le poste s’ouvre (D83)', async ({
    page,
    browser,
    baseURL,
  }) => {
    const telephone = await telephoneDeConfiance(etat.secretaire.id)
    try {
      await page.goto('/connexion')
      await page.getByLabel('Adresse professionnelle').fill(etat.secretaire.email)
      await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE)
      await page.getByRole('button', { name: 'Se connecter' }).click()
      const qr = page.getByRole('img', { name: 'QR code de connexion' })
      await expect(qr).toBeVisible({ timeout: 30_000 })
      const lien = await qr.getAttribute('data-lien')
      expect(lien).toContain('/connexion/telephone/')

      const contexte = await browser.newContext({ ...devices['iPhone 14'], baseURL: baseURL! })
      await contexte.addCookies([{ name: 'cabinet_poste', value: telephone.secret, url: baseURL! }])
      const tel = await contexte.newPage()
      await tel.goto(lien!)
      await expect(tel.getByText('C’est bien vous ?')).toBeVisible({ timeout: 30_000 })
      await expect(tel.getByText('Nadège Lebon')).toBeVisible()
      await tel.getByRole('button', { name: 'Oui, c’est moi' }).click()
      await expect(tel.getByText('C’est fait : le poste s’ouvre.')).toBeVisible()
      await contexte.close()

      // Le poste s'ouvre de lui-même, sans rien taper.
      await expect(page.getByRole('heading', { name: 'Bonjour Nadège' })).toBeVisible({ timeout: 30_000 })
    } finally {
      await telephone.retirer()
    }
  })

  test('un téléphone qui n’est pas le sien ne valide rien', async ({ page, browser, baseURL }) => {
    const sien = await telephoneDeConfiance(etat.secretaire.id)
    try {
      await page.goto('/connexion')
      await page.getByLabel('Adresse professionnelle').fill(etat.secretaire.email)
      await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE)
      await page.getByRole('button', { name: 'Se connecter' }).click()
      const qr = page.getByRole('img', { name: 'QR code de connexion' })
      await expect(qr).toBeVisible({ timeout: 30_000 })

      const contexte = await browser.newContext({ ...devices['iPhone 14'], baseURL: baseURL! })
      const tel = await contexte.newPage()
      await tel.goto((await qr.getAttribute('data-lien'))!)
      await expect(tel.getByText('Ce téléphone n’est pas reconnu pour ce compte.', { exact: false })).toBeVisible({
        timeout: 30_000,
      })
      await expect(tel.getByText('Nadège')).toHaveCount(0)
      await contexte.close()
      await expect(page).toHaveURL(/second-facteur/)
    } finally {
      await sien.retirer()
    }
  })

  test('le code est redemandé ; à la déconnexion, le retour arrière ne rouvre rien', async ({ page }) => {
    await page.goto('/connexion')
    const depuis = new Date(Date.now() - 1000)
    await page.getByLabel('Adresse professionnelle').fill(etat.secretaire.email)
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/second-facteur/)
    await demanderLeCodeSms(page)
    const code = await codeRecu(etat.secretaire.id, depuis)
    await page.getByLabel('Chiffre 1 sur 6').click()
    await page.keyboard.type(code)
    if (/second-facteur/.test(page.url()))
      await page
        .getByRole('button', { name: 'Valider' })
        .click()
        .catch(() => {})
    // 30 s : la première ouverture après une mise à jour compile tout à froid.
    await expect(page.getByRole('heading', { name: 'Bonjour Nadège' })).toBeVisible({ timeout: 30_000 })

    await page.locator('summary', { hasText: 'Compte de Nadège Lebon' }).click()
    await page.getByRole('button', { name: 'Se déconnecter' }).click()
    await expect(page).toHaveURL(/\/connexion/)
    await page.goBack()
    await expect(page).toHaveURL(/\/connexion/)
    await page.goto('/tableau-de-bord/patients')
    await expect(page).toHaveURL(/\/connexion/)
    await expect(page.getByText(etat.patients.dupont.nom)).toHaveCount(0)
  })
})

test.describe('Workflow, Apps et « Modifier » (27/10)', () => {
  test('« Workflow » : les patients des deux praticiens ; « Arrivé » fait passer en salle d’attente', async ({ page }) => {
    // Le Workflow montre toute la journée, heures passées comprises : des places du matin, toujours libres le soir.
    const sien = await rendezVousFrais(etat, { prenom: 'Flux', apres: '08:00' })
    const autre = await rendezVousFrais(etat, { confrere: true, prenom: 'Confrere', apres: '08:00' })
    await page.goto('/tableau-de-bord/workflow')
    await expect(page.getByRole('heading', { name: 'Workflow' })).toBeVisible({ timeout: 30_000 })
    // Une ligne par patient (direction B, 30/10) : son fil dit l'étape où il en est.
    const ligne = page.getByRole('listitem').filter({ hasText: sien.patient.nom })
    await expect(ligne).toContainText('Étape : Attendu')
    await expect(page.getByRole('listitem').filter({ hasText: autre.patient.nom })).toBeVisible()
    await ligne.getByRole('button', { name: /^Arrivé/ }).click()
    await expect(ligne).toContainText('Étape : Salle d’attente', { timeout: 30_000 })
    await expect.poll(async () => (await lireRendezVous(sien.rdv.id)).statut).toBe('SALLE_ATTENTE')
    await sansDefilementHorizontal(page)
  })

  test('pas d’icône « Apps » pour elle', async ({ page }) => {
    await page.goto('/tableau-de-bord')
    const rail = page.getByRole('navigation', { name: 'Navigation principale' })
    await expect(rail.getByRole('link', { name: 'Workflow' })).toBeVisible({ timeout: 30_000 })
    await expect(rail.getByRole('link', { name: 'Apps' })).toHaveCount(0)
  })

  test('« Modifier » : elle choisit le praticien et l’acte, et ajoute une note', async ({ page }) => {
    const { patient, rdv, jour } = await rendezVousFrais(etat, { jour: demain, prenom: 'Modif' })
    const panneau = await ouvrirRendezVous(page, jour, patient.nom)
    await panneau.getByRole('button', { name: 'Modifier' }).click()
    const formulaire = panneau.getByRole('form', { name: 'Modifier le rendez-vous' })
    await expect(formulaire.getByLabel('Praticien')).toBeVisible()
    await expect(formulaire.getByLabel('Acte')).toBeVisible()
    await formulaire.getByLabel('Note').fill('Prévoir la radio')
    await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(panneau.getByRole('status')).toHaveText('Rendez-vous modifié.')
    expect((await lireRendezVous(rdv.id)).note).toBe('Prévoir la radio')
  })
})

test.describe('Le passage en caisse (D81)', () => {
  test('un soin sans prix : elle saisit 62,50 € et le patient passe en caisse', async ({ page }) => {
    const { patient, rdv, jour } = await rendezVousFrais(etat, { prenom: 'Caisse', apres: '08:00' })
    await terminerRendezVous(rdv.id)
    const panneau = await ouvrirRendezVous(page, jour, patient.nom)
    await expect(panneau).toContainText('Montant du soin')
    // Le soin de test n'a pas de prix : la fiche demande le montant d'emblée, et dit où fixer le prix.
    await expect(panneau).toContainText('Pas encore de prix pour ce soin')
    await panneau.getByLabel('Montant en euros').fill('62,50')
    await panneau.getByRole('button', { name: 'Passé en caisse' }).click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).statut).toBe('EN_CAISSE')
    expect((await lireRendezVous(rdv.id)).montantCentimes).toBe(6250)
    await expect(panneau).toContainText('62,50 €')
  })

  test('pas d’onglet « Rétrocession » pour elle : l’adresse tapée est refusée', async ({ page }) => {
    await page.goto('/tableau-de-bord/statistiques/retrocession')
    await expect(page.getByRole('status')).toHaveText('La rétrocession est réservée aux praticiens et à l’administrateur.')
  })
})
