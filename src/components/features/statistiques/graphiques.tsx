import { cn } from '@/lib/utils'
import type { Case, PointCourbe, Valeur } from '@/server/domaine/statistiques'

// Graphiques des statistiques (maquette S1 du 22/10), dessinés en SVG sans bibliothèque : quelques courbes et
// barres ne justifiaient pas une dépendance. Le texte d'un SVG grandit et rétrécit avec lui : chaque graphique
// est donc dessiné deux fois, serré pour le téléphone et large pour l'ordinateur, et le CSS montre le bon.

export const SAUGE_PROFOND = '#387A70'
export const SAUGE = '#6DB7AB'
export const SAUGE_CLAIR = '#A9D6CD'
export const GRIS_N1 = '#B9C6C2'
export const SABLE = '#C9824F'
export const PALETTE = [SAUGE_PROFOND, SAUGE, SAUGE_CLAIR, SABLE, '#D9E3E0']

const nombre = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 })
export const fmtNombre = (v: number) => nombre.format(v)
export const fmtPourcent = (v: number | null, decimales = 0) =>
  v === null ? '—' : `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: decimales, minimumFractionDigits: decimales }).format(v * 100)} %`

// ─── Cartes et chiffres ──────────────────────────────────────────────────────

export function Carte({
  titre,
  aide,
  children,
  className,
}: {
  titre: string
  aide?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section aria-label={titre} className={cn('carte-douce min-w-0 px-5 py-4 sm:px-6 sm:py-5', className)}>
      <h2 className="font-heading text-[1rem] font-semibold">{titre}</h2>
      {aide ? <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{aide}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/**
 * Une variation à l'an dernier. `sens` dit ce qui est une bonne nouvelle : plus de rendez-vous, oui ; plus
 * d'absences, non. La flèche suit la valeur, la couleur suit le sens.
 */
export function Variation({
  valeur,
  sens = 'hausse',
  enPoints,
}: {
  valeur: number | null
  sens?: 'hausse' | 'baisse'
  enPoints?: boolean
}) {
  if (valeur === null || !Number.isFinite(valeur)) return <span className="text-muted-foreground">pas de comparaison</span>
  const arrondi = Math.round(valeur * (enPoints ? 1000 : 100)) / (enPoints ? 10 : 1)
  if (arrondi === 0) return <span className="text-muted-foreground">stable sur un an</span>
  const bon = (arrondi > 0) === (sens === 'hausse')
  return (
    <span>
      <span className={cn('font-semibold', bon ? 'text-etat-succes' : 'text-etat-erreur')}>
        {arrondi > 0 ? '▲' : '▼'} {fmtNombre(Math.abs(arrondi))}
        {enPoints ? ' pt' : ' %'}
      </span>{' '}
      sur un an
    </span>
  )
}

/** `texte` : la valeur est un intitulé (un motif), écrit plus petit et sur deux lignes au besoin. */
export function Kpi({
  libelle,
  valeur,
  detail,
  texte,
}: {
  libelle: string
  valeur: string
  detail?: React.ReactNode
  texte?: boolean
}) {
  return (
    <div className="min-w-0 rounded-[1.25rem] border border-[#e0ebe8] bg-white px-4 py-3.5">
      <p className="text-[0.8125rem] text-muted-foreground">{libelle}</p>
      <p
        title={texte ? valeur : undefined}
        className={cn(
          'chiffres mt-0.5 font-heading font-bold text-primary',
          texte
            ? 'line-clamp-2 text-[1.0625rem] leading-snug sm:text-[1.1875rem]'
            : 'truncate text-[1.625rem] leading-tight sm:text-[1.875rem]',
        )}
      >
        {valeur}
      </p>
      {detail ? <p className="mt-0.5 text-[0.75rem]">{detail}</p> : null}
    </div>
  )
}

export function Kpis({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
}

export function Legende({ items }: { items: { libelle: string; couleur: string; tirets?: boolean; carre?: boolean }[] }) {
  return (
    <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1 text-[0.75rem] text-muted-foreground">
      {items.map((i) => (
        <li key={i.libelle} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={cn('inline-block', i.carre ? 'size-2.5 rounded-[3px]' : 'h-[3px] w-4 rounded-full')}
            style={{
              background: i.tirets ? `repeating-linear-gradient(90deg, ${i.couleur} 0 4px, transparent 4px 7px)` : i.couleur,
            }}
          />
          {i.libelle}
        </li>
      ))}
    </ul>
  )
}

export function Vide({ children = 'Aucun rendez-vous sur cette période.' }: { children?: React.ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>
}

// ─── Axes ────────────────────────────────────────────────────────────────────

/** Un maximum d'axe lisible (1, 2, 2,5 ou 5 × 10ⁿ) au-dessus de la plus grande valeur. */
function maxLisible(v: number): number {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((m) => m * p >= v) ?? 10) * p
}

type Format = 'nombre' | 'pourcent'
const fmtAxe = (v: number, format: Format) => (format === 'pourcent' ? fmtPourcent(v) : fmtNombre(v))

function DeuxTailles({ etroit, large }: { etroit: React.ReactNode; large: React.ReactNode }) {
  return (
    <>
      <div className="sm:hidden">{etroit}</div>
      <div className="hidden sm:block">{large}</div>
    </>
  )
}

// ─── Courbe ──────────────────────────────────────────────────────────────────

function SvgCourbe({
  points,
  L,
  H,
  format,
  couleur,
  pasEtiquettes,
}: {
  points: PointCourbe[]
  L: number
  H: number
  format: Format
  couleur: string
  pasEtiquettes: number
}) {
  const g = format === 'pourcent' ? 44 : 38
  const b = 22
  const t = 10
  const max = maxLisible(Math.max(0, ...points.flatMap((p) => [p.valeur ?? 0, p.valeurN1 ?? 0])))
  const n = Math.max(1, points.length - 1)
  const x = (i: number) => g + (i * (L - g - 10)) / n
  const y = (v: number) => t + (H - t - b) * (1 - v / max)
  const trace = (cle: 'valeur' | 'valeurN1') =>
    points
      .map((p, i) => (p[cle] === null ? null : `${x(i)},${y(p[cle]!)}`))
      .filter(Boolean)
      .join(' ')
  const actuelle = trace('valeur')

  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="block w-full" role="img" aria-label="Courbe">
      {[0, 1, 2, 3, 4].map((k) => {
        const v = (max * k) / 4
        return (
          <g key={k}>
            <line x1={g} x2={L - 10} y1={y(v)} y2={y(v)} stroke="#E6EEEC" />
            <text x={g - 6} y={y(v) + 3.5} textAnchor="end" fontSize="10.5" fill="#5D6A66">
              {fmtAxe(v, format)}
            </text>
          </g>
        )
      })}
      {points.map((p, i) =>
        i % pasEtiquettes === 0 || i === points.length - 1 ? (
          <text key={p.cle} x={x(i)} y={H - 5} textAnchor="middle" fontSize="10.5" fill="#5D6A66">
            {p.libelle}
          </text>
        ) : null,
      )}
      <polyline points={trace('valeurN1')} fill="none" stroke={GRIS_N1} strokeWidth={2} strokeDasharray="5 5" strokeLinejoin="round" />
      {actuelle ? (
        <polygon
          points={`${x(points.findIndex((p) => p.valeur !== null))},${y(0)} ${actuelle} ${x(
            points.length - 1 - [...points].reverse().findIndex((p) => p.valeur !== null),
          )},${y(0)}`}
          fill={couleur}
          opacity={0.1}
        />
      ) : null}
      <polyline points={actuelle} fill="none" stroke={couleur} strokeWidth={2.75} strokeLinejoin="round" />
      {points.map((p, i) =>
        p.valeur === null ? null : (
          <circle key={p.cle} cx={x(i)} cy={y(p.valeur)} r={points.length > 20 ? 2.2 : 3.4} fill="#fff" stroke={couleur} strokeWidth={2}>
            <title>{`${p.titre} : ${fmtAxe(p.valeur, format)}${p.valeurN1 !== null ? ` (un an avant : ${fmtAxe(p.valeurN1, format)})` : ''}`}</title>
          </circle>
        ),
      )}
    </svg>
  )
}

export function Courbe({
  points,
  format = 'nombre',
  couleur = SAUGE_PROFOND,
  hauteur = 250,
}: {
  points: PointCourbe[]
  format?: Format
  couleur?: string
  hauteur?: number
}) {
  const pas = (cible: number) => Math.max(1, Math.ceil(points.length / cible))
  return (
    <>
      <Legende
        items={[
          { libelle: 'Période choisie', couleur },
          { libelle: 'Un an avant', couleur: GRIS_N1, tirets: true },
        ]}
      />
      <DeuxTailles
        etroit={<SvgCourbe points={points} L={340} H={190} format={format} couleur={couleur} pasEtiquettes={pas(5)} />}
        large={<SvgCourbe points={points} L={900} H={hauteur} format={format} couleur={couleur} pasEtiquettes={pas(13)} />}
      />
    </>
  )
}

// ─── Colonnes (simples ou empilées) ──────────────────────────────────────────

type Colonne = { cle: string; libelle: string; titre?: string; valeurs: (number | null)[] }

function SvgColonnes({
  colonnes,
  series,
  L,
  H,
  format,
  pasEtiquettes,
  valeursAuDessus,
  enAvant,
}: {
  colonnes: Colonne[]
  series: string[]
  L: number
  H: number
  format: Format
  pasEtiquettes: number
  valeursAuDessus: boolean
  enAvant?: number | undefined
}) {
  const g = 38
  const b = 22
  const t = valeursAuDessus ? 18 : 8
  const totaux = colonnes.map((c) => c.valeurs.reduce<number>((s, v) => s + (v ?? 0), 0))
  const max = maxLisible(Math.max(0, ...totaux))
  const larg = (L - g - 6) / Math.max(1, colonnes.length)
  const h = (v: number) => ((H - t - b) * v) / max
  const couleurs = series.length === 1 ? [SAUGE_CLAIR] : PALETTE

  return (
    <svg viewBox={`0 0 ${L} ${H}`} className="block w-full" role="img" aria-label="Histogramme">
      {!valeursAuDessus &&
        [0, 1, 2, 3, 4].map((k) => {
          const v = (max * k) / 4
          const yy = H - b - h(v)
          return (
            <g key={k}>
              <line x1={g} x2={L - 6} y1={yy} y2={yy} stroke="#E6EEEC" />
              <text x={g - 6} y={yy + 3.5} textAnchor="end" fontSize="10.5" fill="#5D6A66">
                {fmtAxe(v, format)}
              </text>
            </g>
          )
        })}
      {colonnes.map((c, i) => {
        const hauteurs = c.valeurs.map((v) => h(v ?? 0))
        const sommets = hauteurs.map((_, k) => H - b - hauteurs.slice(0, k + 1).reduce((s, x) => s + x, 0))
        const haut = sommets.at(-1) ?? H - b
        const x0 = g + i * larg + larg * 0.16
        const w = larg * 0.68
        return (
          <g key={c.cle}>
            <title>{`${c.titre ?? c.libelle} : ${series.length > 1 ? c.valeurs.map((v, k) => `${series[k]} ${fmtAxe(v ?? 0, format)}`).join(', ') : fmtAxe(c.valeurs[0] ?? 0, format)}`}</title>
            {hauteurs.map((hh, k) => {
              return (
                <rect
                  key={k}
                  x={x0}
                  y={sommets[k]}
                  width={w}
                  height={hh}
                  rx={series.length === 1 ? Math.min(7, w / 3) : 0}
                  fill={series.length === 1 && i === enAvant ? SAUGE_PROFOND : couleurs[k % couleurs.length]}
                />
              )
            })}
            {valeursAuDessus && c.valeurs[0] !== null ? (
              <text x={x0 + w / 2} y={haut - 5} textAnchor="middle" fontSize="11" fontWeight={600} fill="#24332F">
                {fmtAxe(totaux[i]!, format)}
              </text>
            ) : null}
            {i % pasEtiquettes === 0 ? (
              <text x={x0 + w / 2} y={H - 5} textAnchor="middle" fontSize="10.5" fill="#5D6A66">
                {c.libelle}
              </text>
            ) : null}
          </g>
        )
      })}
    </svg>
  )
}

export function Colonnes({
  colonnes,
  series = [''],
  format = 'nombre',
  hauteur = 230,
  valeursAuDessus = false,
  enAvant,
}: {
  colonnes: Colonne[]
  series?: string[]
  format?: Format
  hauteur?: number
  valeursAuDessus?: boolean
  /** Index de la colonne mise en avant (sauge profond), pour une série unique. */
  enAvant?: number
}) {
  const pas = (cible: number) => Math.max(1, Math.ceil(colonnes.length / cible))
  const commun = { colonnes, series, format, valeursAuDessus, enAvant }
  return (
    <>
      {series.length > 1 ? (
        <Legende items={series.map((s, k) => ({ libelle: s, couleur: PALETTE[k % PALETTE.length]!, carre: true }))} />
      ) : null}
      <DeuxTailles
        etroit={<SvgColonnes {...commun} L={340} H={200} pasEtiquettes={pas(6)} />}
        large={<SvgColonnes {...commun} L={colonnes.length <= 6 ? 440 : 900} H={hauteur} pasEtiquettes={pas(13)} />}
      />
    </>
  )
}

// ─── Barres horizontales ─────────────────────────────────────────────────────

export function Barres({ valeurs, unite, limite = 8 }: { valeurs: Valeur[]; unite?: string; limite?: number }) {
  if (valeurs.length === 0) return <Vide />
  const max = Math.max(...valeurs.map((v) => v.valeur), 1)
  return (
    <ul className="space-y-2">
      {valeurs.slice(0, limite).map((v, i) => (
        <li key={v.libelle} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-[0.8125rem]">
          <span className="truncate">{v.libelle}</span>
          <span className="h-3 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${(v.valeur / max) * 100}%`, opacity: Math.max(0.45, 1 - i * 0.08) }}
            />
          </span>
          <span className="chiffres min-w-[3rem] text-right font-semibold">
            {fmtNombre(v.valeur)}
            {unite ? <span className="font-normal text-muted-foreground"> {unite}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  )
}

// ─── Anneau ──────────────────────────────────────────────────────────────────

export function Anneau({ valeurs, centre, sousCentre }: { valeurs: Valeur[]; centre: string; sousCentre: string }) {
  const total = valeurs.reduce((s, v) => s + v.valeur, 0)
  if (total === 0) return <Vide />
  const R = 52
  const C = 2 * Math.PI * R
  const parts = valeurs.map((v) => (C * v.valeur) / total)
  const departs = parts.map((_, k) => parts.slice(0, k).reduce((s, p) => s + p, 0))
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="size-[8.75rem] shrink-0" role="img" aria-label="Répartition">
        <g transform="rotate(-90 70 70)">
          {valeurs.map((v, k) => (
            <circle
              key={v.libelle}
              cx={70}
              cy={70}
              r={R}
              fill="none"
              stroke={PALETTE[k % PALETTE.length]}
              strokeWidth={20}
              strokeDasharray={`${parts[k]} ${C}`}
              strokeDashoffset={-departs[k]!}
            />
          ))}
        </g>
        <text x={70} y={70} textAnchor="middle" fontSize="20" fontWeight={700} fill="#24332F" className="font-heading">
          {centre}
        </text>
        <text x={70} y={87} textAnchor="middle" fontSize="10" fill="#5D6A66">
          {sousCentre}
        </text>
      </svg>
      <ul className="space-y-1.5 text-[0.8125rem]">
        {valeurs.map((v, k) => (
          <li key={v.libelle} className="flex items-center gap-2">
            <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: PALETTE[k % PALETTE.length] }} />
            {v.libelle} — <b className="chiffres">{fmtPourcent(v.valeur / total)}</b>
            <span className="text-muted-foreground">({fmtNombre(v.valeur)})</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ─── Carte de chaleur ────────────────────────────────────────────────────────

/**
 * Jours en lignes, tranches de deux heures en colonnes. Une case calculée sur moins de `effectifMin`
 * rendez-vous (ou heures) reste grise : un taux tiré de deux rendez-vous ne dit rien.
 */
export function CarteChaleur({
  lignes,
  colonnes,
  cases,
  bornes,
  couleur = SABLE,
  effectifMin = 5,
  unite,
}: {
  lignes: readonly string[]
  colonnes: readonly string[]
  cases: Case[][]
  /** Taux qui donnent la couleur la plus claire et la plus foncée. */
  bornes: [number, number]
  couleur?: string
  effectifMin?: number
  unite: string
}) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16))
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-1 text-[0.75rem]">
        <thead>
          <tr>
            <th />
            {colonnes.map((c) => (
              <th key={c} scope="col" className="pb-1 font-medium whitespace-nowrap text-muted-foreground">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            <tr key={l}>
              <th scope="row" className="pr-1 text-left font-medium text-muted-foreground">
                {l}
              </th>
              {cases[i]!.map((c, j) => {
                const vide = c.valeur === null || c.effectif < effectifMin
                const k = vide ? 0 : Math.min(1, Math.max(0, (c.valeur! - bornes[0]) / (bornes[1] - bornes[0])))
                return (
                  <td
                    key={j}
                    title={vide ? `${l} ${colonnes[j]} : trop peu de données` : `${l} ${colonnes[j]} : ${fmtPourcent(c.valeur, 1)} (${c.effectif} ${unite})`}
                    className="chiffres h-8 min-w-[2.75rem] rounded-lg text-center font-semibold"
                    style={{
                      background: vide ? '#F1F6F4' : `rgba(${r},${g},${b},${0.1 + k * 0.85})`,
                      color: vide ? '#9AA7A3' : k > 0.55 ? '#fff' : '#24332F',
                    }}
                  >
                    {vide ? '—' : fmtPourcent(c.valeur, 0).replace(' %', '')}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[0.6875rem] text-muted-foreground">En %. Plus la case est foncée, plus le taux est élevé ; « — » : trop peu de données.</p>
    </div>
  )
}

// ─── Tableau ─────────────────────────────────────────────────────────────────

export function Tableau({
  entetes,
  lignes,
}: {
  entetes: { libelle: string; nombre?: boolean }[]
  lignes: { cle: string; cellules: React.ReactNode[] }[]
}) {
  if (lignes.length === 0) return <Vide />
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[0.8125rem]">
        <thead>
          <tr className="border-b border-border text-[0.75rem] text-muted-foreground">
            {entetes.map((e) => (
              <th key={e.libelle} scope="col" className={cn('px-1 py-2 font-semibold', e.nombre ? 'text-right' : 'text-left')}>
                {e.libelle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l) => (
            <tr key={l.cle} className="border-b border-[#edf2f0] last:border-0">
              {l.cellules.map((c, i) => (
                <td key={i} className={cn('px-1 py-2', entetes[i]?.nombre && 'chiffres text-right font-semibold whitespace-nowrap')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
