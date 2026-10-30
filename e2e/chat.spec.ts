import { type BrowserContextOptions, expect, test } from '@playwright/test'

import { decaler, lireEtat, rendezVousFrais } from './donnees'
import { surveillerConsole } from './outils'

// Le chat interne (D82, maquette du 28/10), joué à deux : la secrétaire écrit au Dr Rivière en citant le rendez-vous
// d'une patiente ; chez la praticienne, ouverte sur l'agenda, la pastille de « Chat » monte sans recharger la page,
// et la carte citée ouvre le rendez-vous.

const etat = lireEtat()
surveillerConsole(test)

test('la secrétaire écrit au Dr Rivière en citant un rendez-vous ; la pastille monte en direct chez elle', async ({
  page,
  browser,
}, info) => {
  const n = info.project.name
  const { patient, rdv } = await rendezVousFrais(etat, { jour: decaler(etat.aujourdhui, 1), prenom: 'Chat' })
  const texte = `${patient.prenom} ${patient.nom} arrive 10 minutes plus tard (${n}).`
  const u = info.project.use
  const options: BrowserContextOptions = {
    ...(u.viewport ? { viewport: u.viewport } : {}),
    ...(u.userAgent ? { userAgent: u.userAgent } : {}),
    ...(u.deviceScaleFactor ? { deviceScaleFactor: u.deviceScaleFactor } : {}),
    isMobile: u.isMobile ?? false,
    hasTouch: u.hasTouch ?? false,
    locale: 'fr-FR',
    timezoneId: 'America/Guadeloupe',
    baseURL: u.baseURL!,
    storageState: `e2e/.auth/praticien-${n}.json`,
  }
  const praticienne = await (await browser.newContext(options)).newPage()
  await praticienne.goto('/tableau-de-bord/agenda')
  const lienChat = praticienne
    .getByRole('navigation', { name: 'Navigation principale' })
    .getByRole('link', { name: /^Chat/ })
  await expect(lienChat).toBeVisible()
  const avant = Number((await lienChat.getAttribute('aria-label'))?.match(/(\d+) non lus/)?.[1] ?? 0)

  await page.goto('/tableau-de-bord/chat')
  await page
    .getByRole('link', { name: new RegExp(etat.praticienMG.nom) })
    .first()
    .click()
  const conversation = page.getByRole('region', { name: new RegExp(`Conversation avec .*${etat.praticienMG.nom}`) })
  await expect(conversation).toBeVisible()

  await conversation.getByRole('button', { name: 'Citer un patient' }).click()
  const citer = page.getByRole('dialog', { name: 'Citer un patient' })
  await citer.getByRole('searchbox').fill(patient.nom)
  // Le rendez-vous, pas la fiche : sa ligne porte l'heure.
  await citer.getByRole('button', { name: /\d{2}:\d{2}/ }).first().click()
  await conversation.getByRole('textbox').fill(texte)
  await conversation.getByRole('textbox').press('Enter')
  await expect(conversation.getByText(texte)).toBeVisible()
  await expect(conversation.getByRole('link', { name: /Ouvrir/ }).last()).toBeVisible()

  // Chez la praticienne, restée sur l'agenda : la pastille, sans recharger.
  await expect(lienChat).toHaveAttribute('aria-label', `Chat, ${avant + 1} non lus`, { timeout: 15_000 })
  await lienChat.click()
  await praticienne.getByRole('link').filter({ hasText: texte }).click()
  const chezElle = praticienne.getByRole('region', { name: /Conversation avec/ })
  await expect(chezElle.getByText(texte)).toBeVisible()
  // Ouverte, la conversation est lue : la pastille retombe.
  await expect(lienChat).not.toHaveAttribute('aria-label', `Chat, ${avant + 1} non lus`)
  await chezElle
    .getByRole('link', { name: /Ouvrir/ })
    .last()
    .click()
  await expect(praticienne).toHaveURL(new RegExp(`/tableau-de-bord/agenda\\?.*rdv=${rdv.id}`))
  await praticienne.context().close()
})
