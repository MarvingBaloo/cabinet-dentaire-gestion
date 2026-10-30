import { expect, test, type Page } from '@playwright/test'

import { client, decaler, lireEtat, lireRendezVous, rendezVousFrais } from './donnees'
import { sansDefilementHorizontal, surveillerConsole } from './outils'

// La journée de la Dr Claire Rivière, praticienne à Marie-Galante, jouée dans le navigateur. Ce qu'elle a de plus
// que la secrétaire : son accueil, trancher les demandes d'annulation de SES rendez-vous, annuler directement les
// siens, l'urgence et le hors-horaires sur SON agenda. Et ce qui lui reste fermé : les demandes de son confrère,
// l'administration (D64).

const etat = lireEtat()
const demain = decaler(etat.aujourdhui, 1)

test.use({
  // La session de la praticienne propre à chaque navigateur (posée par connexion.setup.ts).
  storageState: async ({}, fournir, info) => {
    await fournir(`e2e/.auth/praticien-${info.project.name}.json`)
  },
})
surveillerConsole(test)

async function ouvrirRendezVous(page: Page, nomPatient: string, tous = false, jour = demain) {
  await page.goto(`/tableau-de-bord/agenda?date=${jour}${tous ? '&tousPraticiens=1' : ''}`)
  await page.getByRole('listitem').filter({ hasText: nomPatient }).getByRole('button').first().click()
  const panneau = page.getByRole('complementary', { name: new RegExp(`Rendez-vous de .*${nomPatient}`) })
  await expect(panneau).toBeVisible()
  return panneau
}

test.describe('Son accueil', () => {
  test('« Bonjour Dr Rivière » : ses rendez-vous et ses demandes à trancher, pas ceux de son confrère', async ({
    page,
  }) => {
    const sienne = await rendezVousFrais(etat, { jour: demain, demandeAnnulation: true, prenom: 'Sienne' })
    const autre = await rendezVousFrais(etat, {
      jour: demain,
      demandeAnnulation: true,
      confrere: true,
      prenom: 'Autre',
    })
    await page.goto('/tableau-de-bord')
    await expect(page.getByRole('heading', { name: 'Bonjour Dr Rivière' })).toBeVisible()
    await expect(page.getByText(`Marie ${etat.patients.dupont.nom}`).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Demandes d’annulation à valider' })).toBeVisible()
    await expect(
      page
        .getByRole('listitem')
        .filter({ hasText: sienne.patient.nom })
        .getByRole('button', { name: 'Valider l’annulation' }),
    ).toBeVisible()
    await expect(page.getByText(autre.patient.nom)).toHaveCount(0)
    await sansDefilementHorizontal(page)
  })

  test('elle valide une demande depuis l’accueil : annulé, et le patient sera prévenu par SMS', async ({ page }) => {
    const { patient, rdv } = await rendezVousFrais(etat, { jour: demain, demandeAnnulation: true, prenom: 'Valide' })
    await page.goto('/tableau-de-bord')
    await page
      .getByRole('listitem')
      .filter({ hasText: patient.nom })
      .getByRole('button', { name: 'Valider l’annulation' })
      .click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).statut).toBe('ANNULE')
    const prisma = client()
    expect(await prisma.notification.count({ where: { rendezVousId: rdv.id, type: 'ANNULATION_CABINET' } })).toBe(1)
    await prisma.$disconnect()
  })
})

test.describe('La fiche d’un rendez-vous', () => {
  test('elle refuse une demande sur son rendez-vous : il revient « confirmé »', async ({ page }) => {
    const { patient, rdv, jour } = await rendezVousFrais(etat, { jour: demain, demandeAnnulation: true, prenom: 'Refus' })
    const panneau = await ouvrirRendezVous(page, patient.nom, false, jour)
    await expect(panneau).toContainText('Le créneau reste réservé jusqu’à la décision du praticien.')
    await panneau.getByRole('button', { name: 'Refuser, garder le rendez-vous' }).click()
    const confirmer = page.getByRole('dialog').getByRole('button', { name: /Refuser|Confirmer/ })
    if (await confirmer.count()) await confirmer.first().click()
    await expect.poll(async () => (await lireRendezVous(rdv.id)).statut).toBe('CONFIRME')
  })

  test('elle annule directement son rendez-vous', async ({ page }) => {
    const sien = await rendezVousFrais(etat, { jour: demain, prenom: 'Direct' })
    const panneau = await ouvrirRendezVous(page, sien.patient.nom, false, sien.jour)
    await expect(panneau.getByRole('button', { name: 'Demander l’annulation' })).toHaveCount(0)
    await panneau.getByRole('button', { name: /^Annuler/ }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^Annuler/ })
      .click()
    await expect.poll(async () => (await lireRendezVous(sien.rdv.id)).statut).toBe('ANNULE')
  })

  test('« Modifier » : elle ajoute une note à son rendez-vous (27/10)', async ({ page }) => {
    const { patient, rdv, jour } = await rendezVousFrais(etat, { jour: demain, prenom: 'Modifie' })
    const panneau = await ouvrirRendezVous(page, patient.nom, false, jour)
    await panneau.getByRole('button', { name: 'Modifier' }).click()
    const formulaire = panneau.getByRole('form', { name: 'Modifier le rendez-vous' })
    // Elle seule : pas de choix de praticien.
    await expect(formulaire.getByLabel('Praticien')).toHaveCount(0)
    await formulaire.getByLabel('Note').fill('Apporter la radio')
    await formulaire.getByRole('button', { name: 'Enregistrer' }).click()
    await expect(panneau.getByRole('status')).toHaveText('Rendez-vous modifié.')
    await expect(panneau).toContainText('Apporter la radio')
    const apres = await lireRendezVous(rdv.id)
    expect(apres.note).toBe('Apporter la radio')
    expect(apres.debut.getTime()).toBe(rdv.debut.getTime())
  })
})

test.describe('Elle ne voit que ce qui la concerne (27/10)', () => {
  test('le rendez-vous de son confrère n’est pas dans son agenda, même en demandant tous les praticiens', async ({
    page,
  }) => {
    const autre = await rendezVousFrais(etat, { jour: demain, confrere: true, prenom: 'Cache' })
    const sien = await rendezVousFrais(etat, { jour: autre.jour, prenom: 'Visible' })
    // Le sien a pu glisser au lendemain si sa journée était pleine.
    await page.goto(`/tableau-de-bord/agenda?date=${sien.jour}&tousPraticiens=1`)
    await expect(page.getByText(sien.patient.nom).filter({ visible: true }).first()).toBeVisible()
    await page.goto(`/tableau-de-bord/agenda?date=${autre.jour}&tousPraticiens=1`)
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
    await expect(page.getByText(autre.patient.nom)).toHaveCount(0)
    await expect(page.getByText(`Dr Paul ${etat.confrere.nom}`)).toHaveCount(0)
  })

  test('en vue jour, seulement son fauteuil : pas la colonne de son confrère (30/10)', async ({ page, isMobile }) => {
    test.skip(isMobile, 'au téléphone, la vue jour est une liste, sans colonnes de fauteuils')
    const sien = `Fauteuil E2E ${etat.suffixe.slice(-4)}`
    await page.goto(`/tableau-de-bord/agenda?date=${demain}&tousPraticiens=1`)
    await expect(page.getByText(sien, { exact: true })).toBeVisible()
    await expect(page.getByText(`${sien} bis`, { exact: true })).toHaveCount(0)
    await expect(page.getByText(/· 1 fauteuil ·/)).toBeVisible()
  })

  test('le patient de son confrère est introuvable, à la recherche comme à sa fiche', async ({ page }) => {
    const autre = await rendezVousFrais(etat, { jour: demain, confrere: true, prenom: 'Introuvable' })
    await page.goto(`/tableau-de-bord/patients?q=${encodeURIComponent(autre.patient.nom)}`)
    await expect(page.getByRole('heading', { name: 'Patients' })).toBeVisible()
    await expect(page.getByRole('link', { name: new RegExp(autre.patient.nom) })).toHaveCount(0)
    await page.goto(`/tableau-de-bord/patients/${autre.patient.id}`)
    await expect(page.getByText(autre.patient.nom)).toHaveCount(0)
  })

  test('« Workflow » : ses patients du jour, pas ceux de son confrère', async ({ page }) => {
    const sien = await rendezVousFrais(etat, { prenom: 'Colonne', apres: '08:00' })
    const autre = await rendezVousFrais(etat, { confrere: true, prenom: 'Ailleurs', apres: '08:00' })
    await page.goto('/tableau-de-bord')
    const rail = page.getByRole('navigation', { name: 'Navigation principale' })
    await rail.getByRole('link', { name: 'Workflow' }).click()
    await expect(page.getByRole('heading', { name: 'Workflow' })).toBeVisible()
    await expect(page.getByRole('listitem').filter({ hasText: sien.patient.nom })).toContainText('Étape : Attendu')
    await expect(page.getByText(autre.patient.nom)).toHaveCount(0)
    await sansDefilementHorizontal(page)
  })

  test('« Apps » : l’icône est là, aucune application connectée pour l’instant', async ({ page }) => {
    await page.goto('/tableau-de-bord')
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Apps' }).click()
    await expect(page.getByRole('heading', { name: 'Apps' })).toBeVisible()
    await expect(page.getByText('Aucune application connectée pour l’instant.')).toBeVisible()
  })
})

test.describe('Nouveau rendez-vous', () => {
  test('les exceptions réservées au praticien s’affichent pour son agenda, pas pour celui de son confrère', async ({
    page,
  }) => {
    await page.goto(`/tableau-de-bord/agenda/nouveau?date=${demain}`)
    const urgence = page.getByRole('checkbox', { name: 'Urgence ajoutée sur un planning complet' })
    await expect(urgence).toBeVisible()
    await expect(page.getByRole('checkbox', { name: 'Hors des horaires d’ouverture' })).toBeVisible()
    await page.getByLabel('Praticien').selectOption({ label: `Dr Paul ${etat.confrere.nom}` })
    await expect(urgence).toHaveCount(0)
  })
})

test.describe('Ce qui reste à l’administrateur', () => {
  test('elle lit la liste du personnel, sans rien pouvoir y créer ni modifier (D64)', async ({ page }) => {
    await page.goto('/tableau-de-bord/comptes')
    await expect(page.getByRole('heading', { name: 'Comptes du personnel' })).toBeVisible()
    await expect(page.getByRole('row').nth(1)).toBeVisible()
    await expect(page.getByRole('link', { name: /Ajouter/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Désactiver|Réactiver|Réinitialiser/ })).toHaveCount(0)
  })

  for (const [chemin, titre] of [
    ['/tableau-de-bord/postes', 'Postes de travail'],
    ['/tableau-de-bord/journal', 'Journal'],
    ['/tableau-de-bord/messages', 'Modèles de messages'],
  ] as const) {
    test(`${chemin} lui répond « réservé à l’administrateur »`, async ({ page }) => {
      await page.goto(chemin)
      await expect(page.getByRole('heading', { name: titre })).toBeVisible()
      await expect(page.getByRole('status')).toHaveText('Cet écran est réservé à l’administrateur du cabinet.')
    })
  }

  test('le menu des patients est en lecture seule, le déblocage d’un patient lui est fermé', async ({ page }) => {
    await page.goto('/tableau-de-bord/motifs')
    await expect(page.getByText('Lecture seule · modifiable par l’administrateur du cabinet')).toBeVisible()
    await page.goto('/tableau-de-bord/patients/bloques')
    await expect(page.getByRole('button', { name: /Débloquer/ })).toHaveCount(0)
  })
})

test.describe('Ses statistiques (D73)', () => {
  test('l’icône « Statistiques » ouvre six onglets ; la période suit d’un onglet à l’autre ; pas de menu « praticien »', async ({
    page,
  }) => {
    await page.goto('/tableau-de-bord')
    await page.getByRole('navigation', { name: 'Navigation principale' }).getByRole('link', { name: 'Statistiques' }).click()
    await expect(page).toHaveURL(/\/tableau-de-bord\/statistiques$/)
    const onglets = page.getByRole('navigation', { name: 'Onglets' })
    for (const nom of ['Activité', 'Motifs', 'Absences', 'Prise de rendez-vous', 'Remplissage', 'Patients']) {
      await expect(onglets.getByRole('link', { name: nom })).toBeVisible()
    }
    await expect(page.getByRole('heading', { name: 'Rendez-vous honorés par mois' })).toBeVisible()
    // Ses chiffres seulement : le choix « Tout le cabinet » n'existe pas pour elle.
    await expect(page.getByRole('option', { name: 'Tout le cabinet' })).toHaveCount(0)

    await page.getByRole('navigation', { name: 'Période' }).getByRole('link', { name: '3 mois' }).click()
    await expect(page.getByRole('heading', { name: 'Rendez-vous honorés par semaine' })).toBeVisible()
    await onglets.getByRole('link', { name: 'Absences' }).click()
    await expect(page).toHaveURL(/\/statistiques\/absences\?periode=3m/)
    await expect(page.getByRole('heading', { name: 'Taux d’absence par semaine' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Par jour et par heure' })).toBeVisible()
    await sansDefilementHorizontal(page)
  })

  test('demander les chiffres de tout le cabinet par l’adresse : refusé', async ({ page }) => {
    await page.goto('/tableau-de-bord/statistiques?praticien=tous')
    await expect(page.getByRole('status')).toHaveText(
      'Les chiffres d’un confrère ou de tout le cabinet sont réservés à l’administrateur.',
    )
  })
})

test.describe('Ma rétrocession (D81)', () => {
  test('elle voit sa part et ses mois, sans ligne de son confrère', async ({ page }) => {
    const prisma = client()
    await prisma.praticien.update({ where: { id: etat.praticienMG.id }, data: { partRetrocession: 60 } })
    await prisma.$disconnect()
    await page.goto('/tableau-de-bord/statistiques/retrocession')
    await expect(page.getByRole('heading', { name: 'Ma rétrocession' })).toBeVisible()
    await expect(page.getByText('Votre part :')).toContainText('60 %')
    await expect(page.getByText(`Dr Paul ${etat.confrere.nom}`)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Marquer comme versé/ })).toHaveCount(0)
  })
})
