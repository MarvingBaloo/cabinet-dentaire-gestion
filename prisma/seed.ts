import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type RoleName, SiteCode } from '@prisma/client'
import { config as loadEnv } from 'dotenv'

import { amorcerModelesMessages } from '../src/server/db/amorcer-modeles-messages'

loadEnv({ path: '.env.local', quiet: true })

// Le seed écrit dans role / permission / role_permission, sur lesquelles le rôle
// applicatif n'a que SELECT (D4). Il tourne donc avec le rôle propriétaire, comme
// les migrations — et n'utilise pas le singleton de src/server/db.
const url = process.env.DIRECT_DATABASE_URL
if (!url) throw new Error('DIRECT_DATABASE_URL manquant : le seed doit tourner avec le rôle propriétaire.')

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

const ROLES: Record<RoleName, string> = {
  PRATICIEN: 'Chirurgien-dentiste. Soigne, consulte et modifie l’agenda.',
  SECRETAIRE: 'Secrétariat médical. Gère les rendez-vous et l’accueil.',
  ASSISTANTE: 'Assistant(e) dentaire. Assiste au fauteuil, suit le planning du jour.',
  ADMIN: 'Administration de l’application : comptes, postes, journal d’audit.',
}

// `utilisateur` n'a pas d'action `delete` : les comptes se désactivent (D9).
// Idem `patient` et `praticien`.
const PERMISSIONS = [
  { resource: 'utilisateur', action: 'read' },
  { resource: 'utilisateur', action: 'create' },
  { resource: 'utilisateur', action: 'update' },
  { resource: 'site', action: 'read' },
  { resource: 'site', action: 'update' },
  { resource: 'workstation', action: 'read' },
  { resource: 'workstation', action: 'create' },
  { resource: 'workstation', action: 'update' },
  { resource: 'workstation', action: 'delete' },
  { resource: 'session', action: 'read' },
  { resource: 'session', action: 'delete' }, // révocation
  { resource: 'audit', action: 'read' },

  // ─── Phase 2 : agenda ───
  // `agenda:delete` est l'annulation d'un rendez-vous. Le rendez-vous n'est pas
  // effacé — il passe au statut ANNULE, qui reste lisible et tracé.
  { resource: 'agenda', action: 'read' },
  { resource: 'agenda', action: 'create' },
  { resource: 'agenda', action: 'update' },
  { resource: 'agenda', action: 'delete' },
  // Valider ou refuser une DEMANDE d'annulation (D17, retournée le 2026-09-23).
  // Distincte d'`agenda:delete` : l'accueil garde le droit de DEMANDER une
  // annulation, mais seuls le rôle global et — instance par instance, dans le
  // service — le praticien du rendez-vous peuvent trancher la demande.
  { resource: 'agenda', action: 'valider' },
  { resource: 'patient', action: 'read' },
  { resource: 'patient', action: 'create' },
  { resource: 'patient', action: 'update' },
  // Rendre la réservation en ligne à un patient bloqué par trois manquements
  // (Q27 : « jusqu'à déblocage par un administrateur »). Distincte de
  // `patient:update` exprès : le cabinet a désigné un administrateur, pas
  // quiconque peut corriger une fiche.
  { resource: 'patient', action: 'debloquer' },
  { resource: 'praticien', action: 'read' },
  { resource: 'praticien', action: 'create' },
  { resource: 'praticien', action: 'update' },
  { resource: 'presence', action: 'read' },
  { resource: 'presence', action: 'create' },
  { resource: 'presence', action: 'update' },
  { resource: 'presence', action: 'delete' },
  // Note libre posée sur un jour d'un cabinet ; la portée par site (D5) est
  // appliquée dans la DAL, pas ici.
  { resource: 'note', action: 'read' },
  { resource: 'note', action: 'create' },
  { resource: 'note', action: 'update' },
  { resource: 'note', action: 'delete' },
  // Configuration du catalogue des motifs (D14). Réservée au rôle global : le
  // cabinet a désigné le « super-admin praticien » pour la configuration.
  { resource: 'motif', action: 'read' },
  { resource: 'motif', action: 'create' },
  { resource: 'motif', action: 'update' },
  // Modèles de messages envoyés aux patients (phase 4, lot 5a). Une seule
  // permission pour consulter ET modifier : cet écran n'a pas d'usage en
  // lecture seule qui justifierait de la scinder comme `motif:read` /
  // `motif:update`. Réservée au rôle global (ADMIN et, par D4, PRATICIEN) —
  // absente d'`AGENDA_SECRETARIAT` : ni la secrétaire ni l'assistante ne la
  // reçoivent.
  { resource: 'notifications', action: 'modeles' },
  // Statistiques du cabinet (D73). `read` : ses propres chiffres, pour chaque praticien. `cabinet` : ceux
  // d'un confrère ou de tout le cabinet, pour l'administrateur (le titulaire). Ni l'un ni l'autre au
  // secrétariat : l'activité d'un praticien ne le regarde pas.
  { resource: 'statistiques', action: 'read' },
  { resource: 'statistiques', action: 'cabinet' },
] as const

type PermKey = `${string}:${string}`
const key = (r: string, a: string): PermKey => `${r}:${a}`

// PRATICIEN n'a plus tous les droits depuis le 2026-10-19 : le cabinet compte deux
// praticiens, et ses réponses réservent la configuration au « super-admin
// praticien » (Q4) — le titulaire, qui cumule PRATICIEN + ADMIN (rôles cumulables,
// D4). Le praticien simple soigne et tient l'agenda comme le secrétariat, et
// tranche en plus les demandes d'annulation (`agenda:valider` ; le service la
// restreint à SES rendez-vous). Comptes, postes, journal, motifs, modèles de
// messages et déblocage des patients reviennent à l'administrateur.
//
// Le reste de la matrice suit le moindre privilège : on part de ce dont chaque
// rôle a besoin, pas de ce qu'il serait pratique de lui donner.
const TOUS = PERMISSIONS.map((p) => key(p.resource, p.action))

// Secrétariat et assistanat portent exactement les mêmes droits : le cabinet
// l'a demandé explicitement (« les assistants devraient avoir le même niveau
// d'accréditation et de rôle qu'une secrétaire »).
//
// `agenda:delete` — l'annulation — leur revient depuis que Q36 est tranchée
// (2026-09-17) : praticiens et secrétariat annulent. L'ambiguïté d'origine
// (« l'annulation ne peut être faite par les 3 ») est levée, et la règle ci-dessus
// fait le reste : l'assistante l'obtient parce qu'elle partage cette liste.
//
// ⚠ Retournée à nouveau le 2026-09-23 : `agenda:delete` ne prononce plus
// l'annulation pour ce rôle, elle la DEMANDE — la décision revient au praticien
// du rendez-vous, ou à un administrateur (`agenda:valider`, absent d'ici). La
// permission ne change pas de nom : c'est le service qui, sachant qui l'appelle,
// choisit entre annulation directe et demande.
//
// Ce qu'ils N'ONT PAS, et pourquoi :
//   - `patient:debloquer` — rendre la réservation en ligne à un patient bloqué.
//     Q27 dit « déblocage par un administrateur » : le secrétariat constate les
//     manquements, il ne lève pas la sanction qui en découle.
//   - `motif:create` / `motif:update` — la configuration du catalogue est
//     réservée au rôle global.
//   - `agenda:valider` — l'accueil DEMANDE une annulation, il ne la VALIDE plus
//     (D17, retournée le 2026-09-23). C'est tout le sens du retournement : sans
//     cette absence, la demande n'obligerait à rien.
//   - le surbooking d'urgence, qui n'est pas une permission mais une règle
//     métier portée par la couche domaine : seul le praticien y a droit (Q19).
//
// `presence:delete` — retirer un jour de la semaine type ou supprimer une
// exception (compléments d'agenda, lot 1) — leur revient au même titre que le
// reste de `presence:*` : Q4 est explicite, « praticien et secrétaire, mêmes
// droits que l'assistante ». Rien dans le cadrage ne distingue la suppression
// des trois autres gestes sur la présence ; la garde anti-orphelin (Q5) est de
// toute façon appliquée dans le service, pas conditionnée au rôle de qui
// l'actionne.
const AGENDA_SECRETARIAT: PermKey[] = [
  key('agenda', 'read'),
  key('agenda', 'create'),
  key('agenda', 'update'),
  key('agenda', 'delete'),
  key('patient', 'read'),
  key('patient', 'create'),
  key('patient', 'update'),
  key('praticien', 'read'),
  key('presence', 'read'),
  key('presence', 'create'),
  key('presence', 'update'),
  key('presence', 'delete'),
  key('note', 'read'),
  key('note', 'create'),
  key('note', 'update'),
  key('note', 'delete'),
  key('motif', 'read'),
]

const MATRIX: Record<RoleName, PermKey[]> = {
  ADMIN: TOUS,
  PRATICIEN: [
    key('utilisateur', 'read'),
    key('site', 'read'),
    ...AGENDA_SECRETARIAT,
    key('agenda', 'valider'),
    key('statistiques', 'read'),
  ],
  // Sans `utilisateur:read` (D67) : la liste du personnel, ses rôles et ses seconds facteurs manquants
  // ne regardent que l'administration.
  SECRETAIRE: [key('site', 'read'), ...AGENDA_SECRETARIAT],
  ASSISTANTE: [key('site', 'read'), ...AGENDA_SECRETARIAT],
}

// ⚠ Adresses à renseigner par le cabinet avant toute mise en service.
// Elles apparaîtront sur le portail public et dans les fichiers ICS (phase 3).
const SITES = [
  // `null` et non « À renseigner » : ce texte s'affichait au patient sur le
  // portail et serait parti dans le .ics de son agenda. Les écrans traitent le
  // cas absent ; ils ne peuvent pas deviner qu'une chaîne est un marqueur.
  { code: SiteCode.GUADELOUPE, nom: 'Cabinet de Guadeloupe', adresse: null },
  { code: SiteCode.MARIE_GALANTE, nom: 'Cabinet de Marie-Galante', adresse: null },
]

// Trois fauteuils à Marie-Galante, un en Guadeloupe : c'est l'équipement réel du
// cabinet, au même titre que les sites. Tous identiques et modulables pour tous
// les actes, chirurgie comprise — donc aucune contrainte motif ↔ fauteuil.
const FAUTEUILS = [
  { site: SiteCode.MARIE_GALANTE, nom: 'Fauteuil 1' },
  { site: SiteCode.MARIE_GALANTE, nom: 'Fauteuil 2' },
  { site: SiteCode.MARIE_GALANTE, nom: 'Fauteuil 3' },
  { site: SiteCode.GUADELOUPE, nom: 'Fauteuil 1' },
]

// ⚠ DURÉES — lire avant de s'en étonner.
//
// Les 30 minutes ci-dessous sont une amorce UNIFORME et délibérée, pas une
// estimation clinique. Le cabinet a fourni la liste des motifs sans les durées,
// et une durée d'acte médical ne s'invente pas : « pose d'implant » et « radio »
// n'ont manifestement pas la même, mais je n'ai aucune base pour trancher.
//
// Une valeur uniforme est préférable à une fausse précision : elle saute aux yeux
// et appelle la correction, là où des durées plausibles seraient validées d'un
// coup d'œil sans être vraiment lues.
//
// Ces durées ne servent d'ailleurs qu'à amorcer : celle qui fait foi est portée
// par le couple praticien × motif, chaque durée d'acte dépendant de son
// praticien (D14).
const DUREE_AMORCE = 30

// Couleurs par famille d'acte : c'est ce qui rend une journée lisible d'un coup
// d'œil. Choix de présentation, pas de règle métier.
const TEINTES = {
  consultation: '#387a70',
  soin: '#0e9594',
  prothese: '#7c5cd6',
  chirurgie: '#c2410c',
  parodontologie: '#15803d',
  esthetique: '#be185d',
  examen: '#64748b',
  urgence: '#dc2626',
} as const

// Les 25 motifs relevés au cadrage. Données d'amorce : le cabinet les modifie,
// en ajoute et en désactive depuis l'application (D14).
const MOTIFS: { libelle: string; couleur: string; estUrgence?: boolean }[] = [
  { libelle: 'Première consultation dentaire', couleur: TEINTES.consultation },
  { libelle: 'Contrôle annuel et/ou détartrage', couleur: TEINTES.consultation },
  { libelle: 'Bilan bucco-dentaire', couleur: TEINTES.consultation },
  { libelle: 'Urgence', couleur: TEINTES.urgence, estUrgence: true },
  { libelle: 'Radio', couleur: TEINTES.examen },
  { libelle: 'Soins dentaires', couleur: TEINTES.soin },
  { libelle: 'Détartrage', couleur: TEINTES.soin },
  { libelle: 'TT carie / onlay', couleur: TEINTES.soin },
  { libelle: 'Dévitalisation', couleur: TEINTES.soin },
  { libelle: 'Empreinte', couleur: TEINTES.prothese },
  { libelle: 'Essayage', couleur: TEINTES.prothese },
  { libelle: 'Pose onlay', couleur: TEINTES.prothese },
  { libelle: 'Pose couronne', couleur: TEINTES.prothese },
  { libelle: 'Dépose bridge', couleur: TEINTES.prothese },
  { libelle: 'Préparation prothèse amovible', couleur: TEINTES.prothese },
  { libelle: 'Empreinte prothèse amovible', couleur: TEINTES.prothese },
  { libelle: 'Essayage prothèse amovible', couleur: TEINTES.prothese },
  { libelle: 'Pose appareil', couleur: TEINTES.prothese },
  { libelle: 'Première consultation d’implantologie', couleur: TEINTES.chirurgie },
  { libelle: 'Pose d’implant dentaire', couleur: TEINTES.chirurgie },
  { libelle: 'Activation d’implant', couleur: TEINTES.chirurgie },
  { libelle: 'Première consultation de parodontologie', couleur: TEINTES.parodontologie },
  { libelle: 'Consultation de suivi de parodontologie', couleur: TEINTES.parodontologie },
  { libelle: 'Première consultation pour aligneurs invisibles', couleur: TEINTES.esthetique },
  { libelle: 'Blanchiment des dents', couleur: TEINTES.esthetique },
]

// Ce que le PATIENT choisit sur le portail public — pas le vocabulaire du
// praticien. Deux niveaux : une entrée est soit un menu, soit un choix final qui
// pointe vers un motif d'agenda, d'où viennent la durée et les règles.
//
// AMORCE, pas référentiel. Comme le catalogue des motifs, cette liste n'est
// écrite que si la table est vide : le cabinet la remanie ensuite depuis
// l'application, et un seed ne doit pas lui reprendre ce qu'il a changé.
//
// ⚠ `motif: null` = entrée que le portail ne proposera PAS tant qu'un motif
// d'agenda ne lui est pas rattaché. C'est volontaire : deviner à quel acte
// correspond « Consultation » reviendrait à inventer une règle du cabinet.
type EntreePatient = {
  libelle: string
  aide?: string
  motif: string | null
  enfants?: { libelle: string; motif: string | null }[]
}

const MOTIFS_PATIENT: EntreePatient[] = [
  {
    libelle: 'Urgence',
    aide: 'Douleur, dent cassée, gonflement.',
    // Un seul acte en face : pas de sous-liste, le patient va droit aux créneaux.
    motif: 'Urgence',
  },
  {
    libelle: 'Première consultation',
    aide: 'Vous venez au cabinet pour la première fois, ou pour un traitement nouveau.',
    motif: null,
    enfants: [
      { libelle: 'Une dent', motif: 'Première consultation dentaire' },
      { libelle: 'Les gencives', motif: 'Première consultation de parodontologie' },
      { libelle: 'Un implant', motif: 'Première consultation d’implantologie' },
      { libelle: 'Aligneurs invisibles', motif: 'Première consultation pour aligneurs invisibles' },
    ],
  },
  {
    libelle: 'Consultation',
    aide: 'Vous êtes déjà venu(e) au cabinet.',
    motif: null,
    enfants: [
      { libelle: 'Contrôle annuel ou détartrage', motif: 'Contrôle annuel et/ou détartrage' },
      { libelle: 'Bilan bucco-dentaire', motif: 'Bilan bucco-dentaire' },
      { libelle: 'Une dent', motif: 'Soins dentaires' },
      { libelle: 'Blanchiment des dents', motif: 'Blanchiment des dents' },
    ],
  },
  {
    libelle: 'Consultation de suivi',
    aide: 'Vous êtes suivi(e) au cabinet pour un traitement en cours.',
    motif: null,
    enfants: [
      { libelle: 'Les gencives', motif: 'Consultation de suivi de parodontologie' },
      // ⚠ Muets : le cabinet n'a nommé qu'un acte de suivi. Le portail ne
      // propose pas une entrée sans acte, donc sans durée.
      { libelle: 'Un implant', motif: null },
      { libelle: 'Aligneurs invisibles', motif: null },
      { libelle: 'Une prothèse', motif: null },
    ],
  },
]

async function main() {
  for (const [name, description] of Object.entries(ROLES) as [RoleName, string][]) {
    await prisma.role.upsert({
      where: { name },
      update: { description },
      create: { name, description },
    })
  }

  for (const p of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: p.resource, action: p.action } },
      update: {},
      create: { resource: p.resource, action: p.action },
    })
  }

  const roles = await prisma.role.findMany()
  const permissions = await prisma.permission.findMany()
  const permId = new Map(permissions.map((p) => [key(p.resource, p.action), p.id]))

  for (const role of roles) {
    const wanted = MATRIX[role.name].map((k) => {
      const id = permId.get(k)
      if (!id) throw new Error(`Permission ${k} absente : matrice et référentiel ont divergé.`)
      return id
    })

    // Réconciliation plutôt qu'ajout : un droit retiré de la matrice doit
    // disparaître de la base. Un seed qui ne fait qu'ajouter laisse traîner
    // des permissions révoquées, et le moindre privilège devient décoratif.
    await prisma.rolePermission.deleteMany({
      where: { roleId: role.id, permissionId: { notIn: wanted } },
    })
    for (const permissionId of wanted) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId } },
        update: {},
        create: { roleId: role.id, permissionId },
      })
    }
  }

  for (const site of SITES) {
    await prisma.site.upsert({
      where: { code: site.code },
      update: { nom: site.nom },        // l'adresse n'est pas écrasée une fois saisie
      create: site,
    })
  }

  const sitesEnBase = await prisma.site.findMany()
  const siteId = new Map(sitesEnBase.map((s) => [s.code, s.id]))

  // ⚠ AMORÇAGE DE PREMIÈRE INSTALLATION — et non un référentiel réconcilié.
  //
  // La matrice de droits se réconcilie : un droit retiré doit disparaître, sinon
  // le moindre privilège devient décoratif. Fauteuils et motifs sont l'inverse :
  // ils appartiennent au cabinet, qui les renomme, les ajuste et en ajoute depuis
  // l'application (D14).
  //
  // D'où la condition « table vide » plutôt qu'un upsert par libellé. Un upsert
  // s'appuierait sur le nom — précisément ce que le cabinet peut changer : après
  // un renommage de « Radio » en « Radio panoramique », le seed suivant recrée
  // « Radio » et le catalogue se retrouve avec un doublon. Constaté, puis corrigé
  // ainsi : une fois la table peuplée, le seed n'y touche plus jamais.
  const fauteuilsExistants = await prisma.fauteuil.count()
  if (fauteuilsExistants === 0) {
    for (const f of FAUTEUILS) {
      const id = siteId.get(f.site)
      if (!id) throw new Error(`Site ${f.site} absent : le seed des sites a échoué.`)
      await prisma.fauteuil.create({ data: { siteId: id, nom: f.nom } })
    }
  }

  const motifsExistants = await prisma.motifConsultation.count()
  if (motifsExistants === 0) {
    for (const [index, m] of MOTIFS.entries()) {
      await prisma.motifConsultation.create({
        data: {
          libelle: m.libelle,
          dureeIndicative: DUREE_AMORCE,
          couleur: m.couleur,
          estUrgence: m.estUrgence ?? false,
          ordre: (index + 1) * 10,       // pas de 10 : laisse intercaler sans renuméroter
        },
      })
    }
  }

  const motifsPatientExistants = await prisma.motifPatient.count()
  if (motifsPatientExistants === 0) {
    const parLibelle = new Map(
      (await prisma.motifConsultation.findMany({ select: { id: true, libelle: true } })).map(
        (m) => [m.libelle, m.id],
      ),
    )
    const motifId = (libelle: string | null) => {
      if (!libelle) return null
      const id = parLibelle.get(libelle)
      // Une correspondance ratée passerait inaperçue et donnerait une entrée
      // muette sur le portail : mieux vaut que le seed s'arrête.
      if (!id) throw new Error(`Motif d'agenda introuvable : ${libelle}`)
      return id
    }

    for (const [index, e] of MOTIFS_PATIENT.entries()) {
      const parent = await prisma.motifPatient.create({
        data: {
          libelle: e.libelle,
          aide: e.aide ?? null,
          motifId: motifId(e.motif),
          ordre: (index + 1) * 10,
        },
        select: { id: true },
      })

      for (const [rang, enfant] of (e.enfants ?? []).entries()) {
        await prisma.motifPatient.create({
          data: {
            libelle: enfant.libelle,
            motifId: motifId(enfant.motif),
            parentId: parent.id,
            ordre: (rang + 1) * 10,
          },
        })
      }
    }
  }

  // ⚠ PAS le même principe que fauteuils/motifs/motifs patient ci-dessus.
  // Ceux-là se gardent derrière « la table est vide » parce que leur seule clé
  // est un libellé que le cabinet peut renommer — un upsert par libellé
  // recréerait l'ancien nom à côté du nouveau (constaté, voir le commentaire
  // plus haut). `ModeleMessage` a une clé stable et déjà unique en base
  // (`type`, `canal`) : `skipDuplicates` suffit seul, à CHAQUE seed, sans
  // condition de table vide — un modèle déjà en base (semé ou modifié par le
  // cabinet) n'est JAMAIS touché, et un type modélisable ajouté par une phase
  // future serait semé au prochain seed sans rien devoir d'autre.
  //
  // Cette table n'est de toute façon qu'un CACHE d'édition : une ligne absente
  // ici ne prive personne de rien, `rendreMessage` retombe sur le même défaut
  // du code (`src/lib/modeles-messages.ts`). La semer rend seulement le défaut
  // visible et modifiable dès l'écran, sans attendre une première édition.
  const modelesMessagesCrees = await amorcerModelesMessages(prisma)

  const detail = [
    `${roles.length} rôles`,
    `${permissions.length} permissions`,
    `${SITES.length} sites`,
    fauteuilsExistants === 0 ? `${FAUTEUILS.length} fauteuils créés` : 'fauteuils déjà en place',
    motifsExistants === 0 ? `${MOTIFS.length} motifs créés` : 'catalogue déjà en place',
    motifsPatientExistants === 0
      ? `${MOTIFS_PATIENT.length} entrées patient créées`
      : 'liste patient déjà en place',
    modelesMessagesCrees > 0
      ? `${modelesMessagesCrees} modèle(s) de message créé(s)`
      : 'modèles de messages déjà en place',
  ]
  console.log(`Seed : ${detail.join(', ')}.`)
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
