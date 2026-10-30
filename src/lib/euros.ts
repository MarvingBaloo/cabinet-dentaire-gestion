// Les montants vivent en centimes (D81) : jamais de virgule flottante sur de l'argent.

const sansCentimes = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const avecCentimes = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2 })

/** « 4 800 € », ou « 62,50 € » quand il y a des centimes. */
export function euros(centimes: number): string {
  return (centimes % 100 === 0 ? sansCentimes : avecCentimes).format(centimes / 100)
}

/** « 60 », « 60,5 », « 60.50 € » → 6000, 6050, 6050 centimes. `null` si ce n'est pas un montant. */
export function centimesDepuisSaisie(saisie: string): number | null {
  const propre = saisie.replace(/\s|€/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(propre)) return null
  return Math.round(Number(propre) * 100)
}

/** Le montant d'un champ, en euros, pour l'afficher dans un champ de saisie : 6050 → « 60,50 ». */
export function eurosSaisie(centimes: number | null): string {
  if (centimes === null) return ''
  return centimes % 100 === 0 ? String(centimes / 100) : (centimes / 100).toFixed(2).replace('.', ',')
}
