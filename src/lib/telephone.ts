// Affichage d'un numéro de téléphone, lisible d'un coup d'œil au téléphone de
// l'accueil : « +590 690 12 34 56 », « +33 6 39 98 90 08 », « 06 90 12 34 56 ».
// Affichage seulement — le numéro stocké, lui, ne change pas.

const INDICATIFS_OUTRE_MER = ['+590', '+594', '+596', '+262', '+269', '+687', '+689']

const paires = (chiffres: string) => chiffres.match(/.{1,2}/g)?.join(' ') ?? chiffres

export function afficherTelephone(numero: string): string {
  const brut = numero.replace(/[\s.-]/g, '')
  const outreMer = INDICATIFS_OUTRE_MER.find((i) => brut.startsWith(i))
  if (outreMer && brut.length === outreMer.length + 9) {
    const reste = brut.slice(outreMer.length)
    return `${outreMer} ${reste.slice(0, 3)} ${paires(reste.slice(3))}`
  }
  if (brut.startsWith('+33') && brut.length === 12) return `+33 ${brut[3]} ${paires(brut.slice(4))}`
  if (/^0\d{9}$/.test(brut)) return paires(brut)
  return numero
}

// Portables d'outre-mer : même numérotation nationale à dix chiffres que la
// métropole, mais un indicatif international à part. « 0690 12 34 56 » est donc
// guadeloupéen (+590 690…), « 06 12 34 56 78 » métropolitain (+33 6…).
const PORTABLES_OUTRE_MER: [prefixe: string, indicatif: string][] = [
  ['0690', '+590'],
  ['0691', '+590'],
  ['0694', '+594'],
  ['0696', '+596'],
  ['0697', '+596'],
  ['0692', '+262'],
  ['0693', '+262'],
  // Pas de 0639 (Mayotte) : les patients de démonstration et des tests portent des
  // numéros fictifs 06 39 98…, la plage que l'ARCEP réserve à la fiction, écrits +33.
]

/**
 * Le numéro tel que le patient le tape (« 0690 12 34 56 », « 00590… ») ramené au
 * format international sous lequel les fiches sont enregistrées. Ce qui n'a pas
 * la forme d'un numéro français est seulement débarrassé de ses séparateurs.
 */
export function versInternational(saisie: string): string {
  const brut = saisie.replace(/[\s.\-()]/g, '')
  if (brut.startsWith('00')) return `+${brut.slice(2)}`
  if (!/^0\d{9}$/.test(brut)) return brut
  const outreMer = PORTABLES_OUTRE_MER.find(([prefixe]) => brut.startsWith(prefixe))
  return `${outreMer ? outreMer[1] : '+33'}${brut.slice(1)}`
}
