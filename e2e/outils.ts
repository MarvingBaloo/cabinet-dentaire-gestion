import { expect, type Page, type TestType } from '@playwright/test'

// Partagé par les parcours de chaque rôle : la console du navigateur reste propre, et aucune page ne déborde
// en largeur (un défilement horizontal au téléphone élargit tout l'écran).

/** Échoue le parcours sur toute erreur de la console ou de la page, sauf le bruit connu ci-dessous. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function surveillerConsole(test: TestType<any, any>) {
  let erreurs: string[] = []

  test.beforeEach(async ({ page }: { page: Page }) => {
    erreurs = []
    page.on('console', (m) => {
      // Une requête coupée par une navigation (rechargement, lien suivi pendant un chargement, flux de l'agenda
      // en direct interrompu) : Safari l'écrit « Load failed », Next en développement « Failed to fetch RSC
      // payload ». Ce n'est pas une panne de l'écran ; toute autre erreur l'est.
      // Même famille sous Safari : le flux de l'agenda ou du chat en direct coupé par le changement de page. Safari coupe
      // parfois l'adresse d'un saut de ligne (« http:\n//localhost… ») : d'où `[\s\S]*` plutôt que `.*`.
      if (
        m.type() === 'error' &&
        !/Load failed|Failed to fetch RSC payload|EventSource cannot load [\s\S]*flux-(agenda|chat)/.test(m.text())
      )
        erreurs.push(`${m.text()} — ${m.location().url}`)
    })
    page.on('pageerror', (e) => {
      // Outils du mode développement sous WebKit, absents de la version en ligne : le panneau de Next qui va
      // chercher les piles d'origine (`next-devtools`) et les mesures de performance de React.
      if (/Load failed|EventSource cannot load [\s\S]*flux-(agenda|chat)/.test(e.message)) return
      if (/next-devtools|flushComponentPerformance/.test(e.stack ?? '')) return
      erreurs.push(`${e.name}: ${e.message} ${(e.stack ?? '').slice(0, 400)}`)
    })
  })

  test.afterEach(() => {
    expect(erreurs, 'erreurs dans la console du navigateur').toEqual([])
  })
}

/** Un téléphone déjà reconnu fait afficher un QR (D83) : les parcours qui veulent le code SMS le demandent. */
export async function demanderLeCodeSms(page: Page) {
  await expect(page.getByRole('heading', { name: 'Vérification en deux étapes' })).toBeVisible({ timeout: 30_000 })
  const sms = page.getByRole('button', { name: /Recevoir plutôt un code par SMS/ })
  if (await sms.isVisible()) {
    await sms.click()
    await expect(page.getByText('Un code vient de vous être envoyé par SMS.')).toBeVisible({ timeout: 30_000 })
  }
}

export async function sansDefilementHorizontal(page: Page) {
  const { large, ecran } = await page.evaluate(() => ({
    large: document.documentElement.scrollWidth,
    ecran: document.documentElement.clientWidth,
  }))
  expect(large, 'la page déborde en largeur').toBeLessThanOrEqual(ecran)
}
