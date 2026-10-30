import { expect, test as preparation } from '@playwright/test'

import { MOT_DE_PASSE, codeRecu, lireEtat } from './donnees'
import { demanderLeCodeSms } from './outils'

// Chaque navigateur se connecte une fois, par le vrai écran : mot de passe, puis code SMS. La session est gardée
// pour les parcours qui suivent (`storageState`).

preparation(
  'la secrétaire se connecte : mauvais mot de passe refusé, puis mot de passe et code SMS',
  async ({ page }, info) => {
    const etat = lireEtat()
    await page.goto('/tableau-de-bord')
    await expect(page).toHaveURL(/\/connexion/)

    await page.getByLabel('Adresse professionnelle').fill(etat.secretaire.email)
    await page.getByLabel('Mot de passe').fill('pas-le-bon-mot-de-passe')
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toBeVisible()
    await expect(page).toHaveURL(/\/connexion(\?|$)/)
    // La saisie de l'adresse n'est pas effacée par le refus.
    await expect(page.getByLabel('Adresse professionnelle')).toHaveValue(etat.secretaire.email)

    const depuis = new Date(Date.now() - 1000)
    await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE)
    await page.getByRole('button', { name: 'Se connecter' }).click()
    await expect(page).toHaveURL(/second-facteur/)
    await demanderLeCodeSms(page)
    await expect(page.getByText('Un code vient de vous être envoyé par SMS.')).toBeVisible()

    const code = await codeRecu(etat.secretaire.id, depuis)
    await page.getByLabel('Chiffre 1 sur 6').click()
    await page.keyboard.type(code)
    if (/second-facteur/.test(page.url()))
      await page
        .getByRole('button', { name: 'Valider' })
        .click()
        .catch(() => {})
    await expect(page).toHaveURL(/\/tableau-de-bord$/)
    // 30 s : la première ouverture après une mise à jour compile tout à froid.
    await expect(page.getByRole('heading', { name: 'Bonjour Nadège' })).toBeVisible({ timeout: 30_000 })

    const nom = info.project.name.replace('connexion-', '')
    await page.context().storageState({ path: `e2e/.auth/${nom}.json` })
  },
)

preparation('la Dr Rivière, praticienne, se connecte avec son code SMS', async ({ page }, info) => {
  const etat = lireEtat()
  await page.goto('/connexion')
  const depuis = new Date(Date.now() - 1000)
  await page.getByLabel('Adresse professionnelle').fill(etat.praticien.email)
  await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/second-facteur/)
  await demanderLeCodeSms(page)
  await page.getByLabel('Chiffre 1 sur 6').click()
  await page.keyboard.type(await codeRecu(etat.praticien.id, depuis))
  if (/second-facteur/.test(page.url()))
    await page
      .getByRole('button', { name: 'Valider' })
      .click()
      .catch(() => {})
  await expect(page.getByRole('heading', { name: 'Bonjour Dr Rivière' })).toBeVisible({ timeout: 30_000 })
  const nom = info.project.name.replace('connexion-', '')
  await page.context().storageState({ path: `e2e/.auth/praticien-${nom}.json` })
})

preparation('Aline Gustave, administratrice, se connecte avec son code SMS', async ({ page }, info) => {
  const etat = lireEtat()
  await page.goto('/connexion')
  const depuis = new Date(Date.now() - 1000)
  await page.getByLabel('Adresse professionnelle').fill(etat.admin!.email)
  await page.getByLabel('Mot de passe').fill(MOT_DE_PASSE)
  await page.getByRole('button', { name: 'Se connecter' }).click()
  await expect(page).toHaveURL(/second-facteur/)
  await demanderLeCodeSms(page)
  await page.getByLabel('Chiffre 1 sur 6').click()
  await page.keyboard.type(await codeRecu(etat.admin!.id, depuis))
  if (/second-facteur/.test(page.url()))
    await page
      .getByRole('button', { name: 'Valider' })
      .click()
      .catch(() => {})
  await expect(page).toHaveURL(/\/tableau-de-bord$/, { timeout: 30_000 })
  const nom = info.project.name.replace('connexion-', '')
  await page.context().storageState({ path: `e2e/.auth/admin-${nom}.json` })
})
