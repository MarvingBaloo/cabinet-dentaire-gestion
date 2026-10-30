// Jeu de démonstration : une équipe plausible, pas 300 comptes de test.
//
// Base SÉPARÉE de celle des tests. Les tests créent des centaines de comptes
// qu'ils ne peuvent pas supprimer — le journal d'audit y fait référence, et
// c'est voulu. Les faire cohabiter avec la démonstration rendait l'écran des
// comptes illisible.
//
// ⚠ Données entièrement FICTIVES. Aucun patient, aucune donnée de santé.
import { randomUUID } from 'node:crypto'

import { PrismaPg } from '@prisma/adapter-pg'
import {
  CanalNotification,
  type Prisma,
  PrismaClient,
  RoleName,
  SiteCode,
  StatutRendezVous,
  TypeIndisponibilite,
} from '@prisma/client'
import { config } from 'dotenv'

import {
  bornesDuJour,
  decalerJour,
  heureMinutesDepuisHHMM,
  instantCabinet,
  jourLocal,
  lundiDeSemaine,
} from '../src/lib/dates'
import { jourVersDateNote } from '../src/lib/notes-jour'
import { calculerFin, verifierCreneau } from '../src/server/domaine/agenda'
import { hashPassword } from '../src/server/auth/password'
import { plagesVouluesAvecFeries } from '../src/server/domaine/presences'

config({ path: '.env.local', quiet: true })

// Même profondeur que le portail public (`HORIZON_JOURS`,
// src/server/queries/public/creneaux.ts, Q3) — copiée ici plutôt
// qu'importée : ce fichier porte `server-only`, et ce script tourne SANS
// `tsx --conditions react-server` (contrairement à `worker-notifications.ts`).
// L'importer ferait échouer le seed à l'exécution, pas à la lecture.
const HORIZON_JOURS_DEMO = 62

const MOT_DE_PASSE = 'DemoCabinet2026'

// Un compte par rôle, nommé d'après son rôle (décidé par Marving le 2026-10-19) :
// en démonstration, on doit lire qui est connecté, pas deviner qui est
// « Camille ». Composition alignée sur les besoins du cabinet :
// deux praticiens la première année, dont un
// « super-admin praticien » qui configure l'application (Q4), et deux
// assistantes au démarrage (Q10).
//
// Le second praticien n'est pas un figurant : toute la phase 2 tourne autour de
// l'alternance entre les deux sites et de la règle « un seul site par jour ».
//
// Les numéros sont fictifs mais présents : sans numéro, le second facteur ne
// peut pas partir et le compte ne se connecte plus (D7, révisée). Sur les démos
// en ligne, ils sont remplacés par le vrai numéro de Marving, hors dépôt.
const PRATICIEN_ADMIN = 'praticien.administrateur@cabinet.demo'
const PRATICIEN = 'praticien@cabinet.demo'

const EQUIPE = [
  {
    prenom: 'Praticien',
    nom: 'Administrateur',
    email: PRATICIEN_ADMIN,
    roles: [RoleName.PRATICIEN, RoleName.ADMIN],
    mobile: '+590690000101',
    praticien: { titre: 'Chirurgien-dentiste', couleur: '#387a70' },
  },
  {
    prenom: 'Praticien',
    nom: 'Démo',
    email: PRATICIEN,
    roles: [RoleName.PRATICIEN],
    mobile: '+590690000102',
    praticien: { titre: 'Chirurgien-dentiste, implantologie', couleur: '#7c5cd6' },
  },
  {
    prenom: 'Secrétaire',
    nom: 'Démo',
    email: 'secretaire@cabinet.demo',
    roles: [RoleName.SECRETAIRE],
    mobile: '+590690000103',
  },
  {
    prenom: 'Assistante',
    nom: '1',
    email: 'assistante1@cabinet.demo',
    roles: [RoleName.ASSISTANTE],
    mobile: '+590690000104',
  },
  {
    prenom: 'Assistante',
    nom: '2',
    email: 'assistante2@cabinet.demo',
    roles: [RoleName.ASSISTANTE],
    mobile: '+590690000105',
  },
]

// Semaine type (compléments d'agenda, lot 1) : agenda fixe, mêmes jours
// chaque semaine (Q2), horizon de deux mois (Q3). Le praticien administrateur
// tient Marie-Galante du lundi au jeudi, le second praticien le vendredi et le
// samedi. Tout à Marie-Galante : la praticienne y exerce seule la première année
// (22/10), et la Guadeloupe est retirée de la démonstration comme elle le sera
// au cabinet (D74). Le vendredi garde sa fin à 16 h.
const SEMAINE_TYPE: Record<
  string,
  { jourSemaine: number; site: SiteCode; fauteuil: string; heureDebut: string; heureFin: string }[]
> = {
  [PRATICIEN_ADMIN]: [
    { jourSemaine: 1, site: SiteCode.MARIE_GALANTE, fauteuil: 'Fauteuil 1', heureDebut: '08:00', heureFin: '18:00' },
    { jourSemaine: 2, site: SiteCode.MARIE_GALANTE, fauteuil: 'Fauteuil 1', heureDebut: '08:00', heureFin: '18:00' },
    { jourSemaine: 3, site: SiteCode.MARIE_GALANTE, fauteuil: 'Fauteuil 1', heureDebut: '08:00', heureFin: '18:00' },
    { jourSemaine: 4, site: SiteCode.MARIE_GALANTE, fauteuil: 'Fauteuil 1', heureDebut: '08:00', heureFin: '18:00' },
  ],
  [PRATICIEN]: [
    { jourSemaine: 5, site: SiteCode.MARIE_GALANTE, fauteuil: 'Fauteuil 2', heureDebut: '08:00', heureFin: '16:00' },
    { jourSemaine: 6, site: SiteCode.MARIE_GALANTE, fauteuil: 'Fauteuil 2', heureDebut: '08:00', heureFin: '18:00' },
  ],
}

// Répartition alignée sur l'équipement réel : trois fauteuils à Marie-Galante,
// un en Guadeloupe. L'inverse était décrit jusqu'ici.
const POSTES = [
  { nom: 'PC Accueil Marie-Galante', site: SiteCode.MARIE_GALANTE },
  { nom: 'PC Salle 2', site: SiteCode.MARIE_GALANTE },
  { nom: 'PC Salle 3', site: SiteCode.MARIE_GALANTE },
  { nom: 'Portable praticien', site: SiteCode.MARIE_GALANTE },
  { nom: 'PC Guadeloupe', site: SiteCode.GUADELOUPE },
]

// Patients de démonstration : noms antillais et métropolitains inventés.
//
// ⚠ La démo tourne en production avec Brevo branché (D18) : un numéro
// attribuable recevrait de vrais rappels J-2 et H-3. Les numéros sont donc
// pris dans la tranche +33 6 39 98 xx xx, réservée à la fiction par l'ARCEP,
// sans e-mail, et chaque patient coupe ses rappels par préférence.
// Le premier est le « compte patient » de démonstration : son numéro ouvre l'espace
// patient du site (D23). Sur les démos en ligne, il porte le vrai numéro de Marving.
const PATIENTS_DEMO = [
  ['Patient', 'Démo'],
  ['Jean-Marc', 'Pelage'],
  ['Sylvie', 'Bavardin'],
  ['Dominique', 'Cassin'],
  ['Annick', 'Rosamont'],
  ['Mathieu', 'Lefèvre'],
  ['Josiane', 'Sainte-Rose'],
  ['Hervé', 'Gaudin'],
  ['Nathalie', 'Moutoussamy'],
  ['Claude', 'Bertrand'],
  ['Elodie', 'Vigneron'],
  ['Patrick', 'Nelson'],
  ['Lucie', 'Marcelin'],
  ['François', 'Tirolien'],
  ['Cécile', 'Morel'],
] as const

// Heures candidates, essayées dans l'ordre ; un créneau refusé est décalé de
// 30 minutes dans la même plage.
const HEURES_DEMO = ['08:30', '09:15', '10:00', '11:00', '14:00', '15:15', '16:00']
const NOMBRE_RENDEZ_VOUS_DEMO = 15

async function main() {
  const base = process.env.DIRECT_DATABASE_URL
  if (!base) throw new Error('DIRECT_DATABASE_URL manquant')

  // La base de travail est acceptée aussi, pour `npm run db:remettre-a-neuf` (elle repart du même jeu que la démo).
  const url = process.env.DEMO_DATABASE_URL ?? base.replace(/\/[^/]+$/, '/cabinet_demo')
  if (!/\/(cabinet_demo|cabinet_dentaire)(\?.*)?$/.test(url)) {
    throw new Error(`Refus : ce script n'écrit que dans cabinet_demo ou cabinet_dentaire (reçu : ${url.split('/').pop()})`)
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })

  const sites = await prisma.site.findMany()
  if (sites.length === 0) {
    throw new Error('Référentiel absent : lancer d’abord le seed standard sur cette base.')
  }

  // `--historique` : l'agenda généré seul — deux ans d'historique pour les statistiques (D73) et six semaines à
  // venir. Pour les démos en ligne, dont les comptes portent le vrai numéro de Marving : le reste de ce script le
  // remettrait au numéro fictif, et plus aucun code de connexion n'arriverait.
  //
  // `--refaire` (avec `--historique`) : retire d'abord l'agenda généré la dernière fois — ses patients, leurs
  // rendez-vous, ses réservations en ligne — puis le repose. Ce qui a été créé à l'écran avec d'autres patients reste.
  if (process.argv.includes('--historique')) {
    const durees = await appliquerDureesDemo(prisma)
    if (durees > 0) console.log(`Durées des actes : ${durees} durée(s) passée(s) de 30 minutes à leur durée réelle.`)
    console.log(`Urgences : ${JSON.stringify(await reglerUrgencesDemo(prisma))}`)
    const refaire = process.argv.includes('--refaire')
    const bilan = await prisma.$transaction(
      async (tx) => {
        const retire = refaire ? await retirerAgendaGenere(tx) : null
        return { retire, pose: await poserAgenda(tx) }
      },
      { timeout: 600_000, maxWait: 30_000 },
    )
    if (bilan.retire) console.log(`Retiré : ${JSON.stringify(bilan.retire)}`)
    console.log(
      bilan.pose
        ? `Agenda : ${bilan.pose.passes} rendez-vous passés sur deux ans, ${bilan.pose.aVenir} à venir sur ${SEMAINES_A_VENIR} semaines.`
        : 'Agenda généré déjà présent : aucun ajout (--refaire pour le reposer).',
    )
    console.log(`Rétrocession : ${JSON.stringify(await reglerRetrocessionDemo(prisma))}`)
    console.log(`Chat : ${await poserChatDemo(prisma)}`)
    await prisma.$disconnect()
    return
  }

  const passwordHash = await hashPassword(MOT_DE_PASSE)
  const roles = await prisma.role.findMany()
  const idRole = new Map(roles.map((r) => [r.name, r.id]))
  const idSite = new Map(sites.map((s) => [s.code, s.id]))
  const idPraticienParEmail = new Map<string, string>()

  for (const membre of EQUIPE) {
    const utilisateur = await prisma.user.upsert({
      where: { email: membre.email },
      update: { passwordHash, actif: true, telephoneMobile: membre.mobile },
      create: {
        email: membre.email,
        nom: membre.nom,
        prenom: membre.prenom,
        passwordHash,
        telephoneMobile: membre.mobile,
        sites: { create: [...idSite.values()].map((siteId) => ({ siteId })) },
      },
      select: { id: true },
    })

    // Un compte praticien a besoin de sa fiche d'agenda : c'est elle qui le fait
    // apparaître dans les plannings, pas le rôle.
    if (membre.praticien) {
      const praticien = await prisma.praticien.upsert({
        where: { userId: utilisateur.id },
        update: { nom: membre.nom, prenom: membre.prenom, ...membre.praticien, actif: true },
        create: { userId: utilisateur.id, nom: membre.nom, prenom: membre.prenom, ...membre.praticien },
        select: { id: true },
      })
      idPraticienParEmail.set(membre.email, praticien.id)
    }

    // Réconciliation des rôles, comme le seed principal : un rôle retiré de
    // cette liste doit disparaître de la base.
    await prisma.userRole.deleteMany({ where: { userId: utilisateur.id } })
    for (const role of membre.roles) {
      await prisma.userRole.create({
        data: { userId: utilisateur.id, roleId: idRole.get(role)! },
      })
    }
  }

  for (const poste of POSTES) {
    await prisma.workstation.upsert({
      where: { nom: poste.nom },
      update: { siteId: idSite.get(poste.site)!, actif: true },
      create: {
        nom: poste.nom,
        // Secret inutilisable : ces postes servent à peupler l'écran, aucun
        // navigateur ne détient le cookie correspondant.
        secretHash: 'demo-non-utilisable',
        siteId: idSite.get(poste.site)!,
        lastSeenAt: new Date(),
      },
    })
  }

  // ── Semaine type et plages de présence (compléments d'agenda, lot 1) ──────
  //
  // Garde « table vide », comme fauteuils/motifs/motifs patient plus haut : un
  // seed qui reposerait la semaine type à chaque lancement écraserait ce que
  // le cabinet a réorganisé depuis l'écran.
  const semaineTypeExistante = await prisma.presenceHebdomadaire.count()
  let plagesCreees = 0
  if (semaineTypeExistante === 0) {
    const idFauteuil = new Map(
      (await prisma.fauteuil.findMany({ select: { id: true, nom: true, siteId: true } })).map((f) => [
        `${f.siteId}|${f.nom}`,
        f.id,
      ]),
    )

    const semaineTypeConnueParPraticien = new Map<
      string,
      { jourSemaine: number; siteId: string; fauteuilId: string; heureDebut: number; heureFin: number }[]
    >()

    for (const [email, lignes] of Object.entries(SEMAINE_TYPE)) {
      const praticienId = idPraticienParEmail.get(email)
      if (!praticienId) throw new Error(`Praticien introuvable pour ${email} : le seed des comptes a échoué.`)

      const connues = lignes.map((l) => {
        const siteId = idSite.get(l.site)!
        const fauteuilId = idFauteuil.get(`${siteId}|${l.fauteuil}`)
        if (!fauteuilId) throw new Error(`Fauteuil introuvable : ${l.fauteuil} (${l.site})`)
        return {
          jourSemaine: l.jourSemaine,
          siteId,
          fauteuilId,
          heureDebut: heureMinutesDepuisHHMM(l.heureDebut)!,
          heureFin: heureMinutesDepuisHHMM(l.heureFin)!,
        }
      })
      semaineTypeConnueParPraticien.set(praticienId, connues)

      for (const ligne of connues) {
        await prisma.presenceHebdomadaire.create({ data: { praticienId, ...ligne } })
        // Un fauteuil fixe par cabinet (27/10) : le premier jour de la semaine type dans ce cabinet le donne.
        await prisma.fauteuilPraticien.upsert({
          where: { praticienId_siteId: { praticienId, siteId: ligne.siteId } },
          create: { praticienId, siteId: ligne.siteId, fauteuilId: ligne.fauteuilId },
          update: {},
        })
      }
    }

    // Les `PlageDePresence` correspondantes, sur le même horizon que
    // l'application : réutilise le domaine PUR (`plagesVouluesAvecFeries`, aucun accès
    // base) qui sert aussi au service et au worker, pour ne jamais dupliquer
    // la règle de calcul.
    const horizonDebut = jourLocal(new Date())
    const horizon = { debut: horizonDebut, fin: decalerJour(horizonDebut, HORIZON_JOURS_DEMO) }

    for (const [praticienId, connues] of semaineTypeConnueParPraticien) {
      const voulues = plagesVouluesAvecFeries(connues, [], horizon)
      for (const p of voulues) {
        await prisma.plageDePresence.create({
          data: { praticienId, siteId: p.siteId, fauteuilId: p.fauteuilId, debut: p.debut, fin: p.fin },
        })
      }
      plagesCreees += voulues.length
    }
  }

  // ── La Guadeloupe, retirée (D74) ─────────────────────────────────────────
  //
  // Seulement à la première installation (aucun rendez-vous encore) : un seed relancé ne doit pas défaire ce que
  // l'administrateur a remis en activité depuis l'écran « Cabinets ».
  if ((await prisma.rendezVous.count()) === 0) {
    await prisma.site.update({ where: { code: SiteCode.GUADELOUPE }, data: { actif: false } })
  }

  const dureesAppliquees = await appliquerDureesDemo(prisma)
  const urgences = await reglerUrgencesDemo(prisma)

  // ── Rendez-vous de démonstration ────────────────────────────────────────
  //
  // Garde « table vide », comme le reste : un seed qui reposerait des
  // rendez-vous à chaque lancement ressusciterait ceux que le cabinet a
  // supprimés ou déplacés depuis l'écran.
  //
  // On part des `PlageDePresence` RÉELLES de la base : un rendez-vous n'est
  // jamais posé hors présence, et la règle « un praticien sur un seul site par
  // jour » est respectée par construction. Chaque créneau est de plus vérifié
  // par `verifierCreneau` (le domaine pur de `creerRendezVous`) ; aucune
  // présence n'est créée pour faire de la place.
  let rendezVousCrees = 0
  if ((await prisma.rendezVous.count()) === 0) {
    const aujourdHui = jourLocal(new Date())
    const lundi = lundiDeSemaine(aujourdHui)
    const fenetre = { debut: bornesDuJour(lundi).debut, fin: bornesDuJour(decalerJour(lundi, 13)).debut }

    const [plages, indisponibilites, motifsActifs, durees] = await Promise.all([
      prisma.plageDePresence.findMany({
        where: { debut: { gte: fenetre.debut }, fin: { lte: fenetre.fin } },
        orderBy: { debut: 'asc' },
      }),
      prisma.indisponibilite.findMany({
        where: { debut: { lt: fenetre.fin }, fin: { gt: fenetre.debut } },
        select: { type: true, praticienId: true, siteId: true, debut: true, fin: true },
      }),
      prisma.motifConsultation.findMany({
        where: { actif: true, estUrgence: false },
        orderBy: [{ ordre: 'asc' }, { libelle: 'asc' }],
        select: { id: true, dureeIndicative: true },
      }),
      prisma.praticienMotif.findMany({ select: { praticienId: true, motifId: true, dureeMinutes: true } }),
    ])

    // Un couple (praticien, jour) par plage ; les jours sans plage sont sautés.
    const jourParPraticien = new Map<string, Map<string, typeof plages>>()
    for (const p of plages) {
      const jour = jourLocal(p.debut)
      const parJour = jourParPraticien.get(p.praticienId) ?? new Map()
      parJour.set(jour, [...(parJour.get(jour) ?? []), p])
      jourParPraticien.set(p.praticienId, parJour)
    }
    const couples = [...jourParPraticien.entries()]
      .flatMap(([praticienId, parJour]) => [...parJour.entries()].map(([jour, p]) => ({ praticienId, jour, plages: p })))
      .sort((a, b) => a.jour.localeCompare(b.jour) || a.praticienId.localeCompare(b.praticienId))

    // Durée d'un acte : celle du praticien (D14) ; à défaut de toute durée
    // renseignée pour lui, on pose celles des premiers motifs actifs.
    const motifsDe = (praticienId: string) => {
      const siens = durees.filter((d) => d.praticienId === praticienId)
      return siens.length > 0
        ? siens.map((d) => ({ motifId: d.motifId, duree: d.dureeMinutes, existe: true }))
        : motifsActifs.slice(0, 4).map((m) => ({ motifId: m.id, duree: m.dureeIndicative ?? 30, existe: false }))
    }

    const occupes: { id: string; praticienId: string; fauteuilId: string; debut: Date; fin: Date; compteDansLOccupation: boolean }[] = []
    const poses: { jour: string; praticienId: string; siteId: string; fauteuilId: string; motifId: string; duree: number; debut: Date; fin: Date; motifExiste: boolean }[] = []

    if (couples.length > 0) {
      for (let i = 0; poses.length < NOMBRE_RENDEZ_VOUS_DEMO && i < NOMBRE_RENDEZ_VOUS_DEMO * 4; i++) {
        const couple = couples[i % couples.length]!
        const motifs = motifsDe(couple.praticienId)
        if (motifs.length === 0) break
        const motif = motifs[i % motifs.length]!
        const base = HEURES_DEMO[Math.floor(i / couples.length) % HEURES_DEMO.length]!
        const debutBase = heureMinutesDepuisHHMM(base)!

        for (let essai = 0; essai < 6; essai++) {
          const minutes = debutBase + essai * 30
          const debut = instantCabinet(couple.jour, `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`)
          if (!debut) break
          const fin = calculerFin(debut, motif.duree)
          const siteId = couple.plages[0]!.siteId
          const verdict = verifierCreneau(
            { praticienId: couple.praticienId, siteId, debut, fin, motifEstUrgence: false, surbooking: false },
            {
              presences: couple.plages.map((p) => ({ praticienId: p.praticienId, siteId: p.siteId, fauteuilId: p.fauteuilId, debut: p.debut, fin: p.fin })),
              indisponibilites,
              rendezVous: occupes,
            },
          )
          if (!verdict.ok) continue
          occupes.push({ id: `demo-${poses.length}`, praticienId: couple.praticienId, fauteuilId: verdict.fauteuilId, debut, fin, compteDansLOccupation: true })
          poses.push({ jour: couple.jour, praticienId: couple.praticienId, siteId, fauteuilId: verdict.fauteuilId, motifId: motif.motifId, duree: motif.duree, debut, fin, motifExiste: motif.existe })
          break
        }
      }
    }

    // Statuts. Jamais A_CONFIRMER dans le passé : le marquage « absent » à
    // 20 minutes (D50) le transformerait aussitôt. Un seul ANNULE, et les
    // A_CONFIRMER seulement après aujourd'hui.
    const passes = ['TERMINE', 'EN_CAISSE', 'ABSENT'] as const
    let nPasse = 0
    let nFutur = 0
    let annuleDonne = false
    poses.sort((a, b) => a.debut.getTime() - b.debut.getTime())
    const statuts = poses.map((r) => {
      if (r.jour < aujourdHui) return StatutRendezVous[passes[nPasse++ % passes.length]!]
      const futur = nFutur++
      if (r.jour === aujourdHui) return StatutRendezVous.CONFIRME
      if (!annuleDonne && futur >= 3) {
        annuleDonne = true
        return StatutRendezVous.ANNULE
      }
      return futur % 3 === 1 ? StatutRendezVous.A_CONFIRMER : StatutRendezVous.CONFIRME
    })

    let numero = 0
    for (const [i, r] of poses.entries()) {
      if (!r.motifExiste) {
        await prisma.praticienMotif.upsert({
          where: { praticienId_motifId: { praticienId: r.praticienId, motifId: r.motifId } },
          update: {},
          create: { praticienId: r.praticienId, motifId: r.motifId, dureeMinutes: r.duree },
        })
      }
      const [prenom, nom] = PATIENTS_DEMO[i % PATIENTS_DEMO.length]!
      const telephone = `+3363998${String(1200 + ++numero).padStart(4, '0')}`
      const patient = await prisma.patient.create({
        data: { prenom, nom, telephone, profilComplet: true },
        select: { id: true },
      })
      await prisma.preferenceNotification.upsert({
        where: { canal_destinataire: { canal: CanalNotification.SMS, destinataire: telephone } },
        update: { rappels: false, nonEssentiels: false },
        create: { canal: CanalNotification.SMS, destinataire: telephone, rappels: false, nonEssentiels: false },
      })
      await prisma.rendezVous.create({
        data: {
          patientId: patient.id,
          praticienId: r.praticienId,
          siteId: r.siteId,
          fauteuilId: r.fauteuilId,
          motifId: r.motifId,
          debut: r.debut,
          fin: r.fin,
          statut: statuts[i]!,
        },
      })
      rendezVousCrees++
    }
  }

  // Tout ou rien : une contrainte de l'agenda qui refuserait une ligne ne laisse pas un historique à moitié posé.
  const agenda = await prisma.$transaction((tx) => poserAgenda(tx), { timeout: 600_000, maxWait: 30_000 })

  let notesCreees = 0
  if ((await prisma.noteJour.count()) === 0) {
    const emailAuteur = (EQUIPE.find((m) => (m.roles as RoleName[]).includes(RoleName.SECRETAIRE)) ?? EQUIPE[0]!).email
    const auteur = await prisma.user.findUniqueOrThrow({ where: { email: emailAuteur }, select: { id: true } })
    const lundiNotes = lundiDeSemaine(jourLocal(new Date()))
    const notes = [
      { decalage: 3, site: SiteCode.MARIE_GALANTE, texte: 'Rappeler le labo pour la couronne de M. Martin' },
      { decalage: 4, site: SiteCode.MARIE_GALANTE, texte: 'Prothésiste à 12h : prévoir les empreintes' },
      { decalage: 7, site: SiteCode.MARIE_GALANTE, texte: 'Livraison de gants et compresses dans la matinée' },
      { decalage: 10, site: SiteCode.MARIE_GALANTE, texte: 'Fauteuil 2 : passage du technicien à 14h' },
    ]
    for (const n of notes) {
      await prisma.noteJour.create({
        data: {
          siteId: idSite.get(n.site)!,
          jour: jourVersDateNote(decalerJour(lundiNotes, n.decalage)),
          texte: n.texte,
          auteurId: auteur.id,
        },
      })
      notesCreees++
    }
  }

  const praticiens = EQUIPE.filter((m) => m.praticien).length
  console.log(
    `Démo : ${EQUIPE.length} comptes (dont ${praticiens} praticiens avec fiche d'agenda), ` +
      `${POSTES.length} postes.`,
  )
  console.log(
    semaineTypeExistante === 0
      ? `Semaine type créée pour ${Object.keys(SEMAINE_TYPE).length} praticien(s), ${plagesCreees} présence(s) générée(s) sur ${HORIZON_JOURS_DEMO} jours.`
      : 'Semaine type déjà en place.',
  )
  console.log(
    rendezVousCrees > 0
      ? `${rendezVousCrees} rendez-vous fictifs créés (semaine en cours et suivante), rappels SMS coupés pour leurs patients.`
      : 'Rendez-vous déjà présents : aucun ajout (ou aucune présence dans la fenêtre).',
  )
  console.log(
    notesCreees > 0 ? `${notesCreees} notes du jour fictives créées.` : 'Notes du jour déjà présentes : aucun ajout.',
  )
  console.log(`Urgences : ${JSON.stringify(urgences)}`)
  if (dureesAppliquees > 0) console.log(`Durées des actes : ${dureesAppliquees} durée(s) passée(s) de 30 minutes à leur durée réelle.`)
  console.log(
    agenda
      ? `Agenda : ${agenda.passes} rendez-vous passés sur deux ans (statistiques), ${agenda.aVenir} à venir sur ${SEMAINES_A_VENIR} semaines.`
      : 'Agenda généré déjà présent : aucun ajout.',
  )
  console.log(`Rétrocession : ${JSON.stringify(await reglerRetrocessionDemo(prisma))}`)
  console.log(`Chat : ${await poserChatDemo(prisma)}`)
  console.log(`Mot de passe commun : ${MOT_DE_PASSE}`)
  await prisma.$disconnect()
}

// ── Agenda généré : deux ans d'historique (D73) et six semaines à venir ──────────
//
// Deux ans de rendez-vous passés, inventés mais crédibles, pour que l'écran « Statistiques » ait quelque chose
// à montrer : un creux en août, plus d'urgences l'été, plus d'absences le lundi matin et aux détartrages, des
// réservations en ligne qui montent, une activité en légère hausse d'une année sur l'autre. Tirage pseudo-
// aléatoire à graine fixe : deux bases peuplées le même jour montrent les mêmes tendances.
//
// Et, depuis le 24/10, les six semaines qui viennent (« le jeu de test est trop sur une période déjà passée ») :
// un agenda plein les jours proches, qui se vide à mesure qu'on s'éloigne, « À confirmer » ou « Confirmé »
// — donc à glisser —, quelques annulations demandées ; aujourd'hui, ce qui est passé est terminé, le patient
// en cours est au fauteuil, le suivant en salle d'attente. Les congés et fermetures sont respectés.
//
// Garde : rien n'est posé si le premier patient de l'historique existe déjà (`--refaire` retire d'abord l'agenda
// généré). Les rendez-vous déjà là (posés à l'écran, ceux de la démonstration) sont contournés ; les présences
// sont créées à partir de la semaine type, sauf là où il y en a déjà.

const ANNEES_HISTORIQUE = 2
const SEMAINES_A_VENIR = 6
const NOMBRE_PATIENTS_HISTORIQUE = 1100
const PATIENTELE_INITIALE = 450
// Le premier patient du vivier : sa présence dit que l'historique est déjà posé.
const TELEPHONE_PREMIER_PATIENT_HISTORIQUE = '+33639983000'

const PRENOMS = ['Marie', 'Jean', 'Josiane', 'Patrick', 'Nathalie', 'Hervé', 'Sylvie', 'Christophe', 'Myriam', 'Thierry', 'Corinne', 'Didier', 'Sandrine', 'Frantz', 'Murielle', 'Ludovic', 'Gisèle', 'Rudy', 'Line', 'Kévin', 'Laetitia', 'Steeve', 'Maëlys', 'Enzo', 'Inès', 'Noah', 'Léa', 'Lucas', 'Chloé', 'Nathan']
const NOMS = ['Bavardin', 'Pelage', 'Cassin', 'Rosamont', 'Sainte-Rose', 'Gaudin', 'Moutoussamy', 'Bertrand', 'Vigneron', 'Nelson', 'Marcelin', 'Tirolien', 'Jabot', 'Coco', 'Lubin', 'Troupé', 'Bellance', 'Romney', 'Ramassamy', 'Désir', 'Larose', 'Bourgeois', 'Calvaire', 'Hilaire', 'Zami', 'Ferdinand', 'Agathe', 'Pierre-Louis', 'Saint-Eloi', 'Anjou']

// Poids de chaque motif (par libellé ; 0,8 pour les autres) et sa saison : coefficient par mois (1 = janvier).
const POIDS_MOTIF: Record<string, { poids: number; saison?: Partial<Record<number, number>> }> = {
  'Contrôle annuel et/ou détartrage': { poids: 18, saison: { 1: 1.3, 9: 1.6, 10: 1.3, 7: 0.7, 8: 0.6 } },
  'Soins dentaires': { poids: 16 },
  'TT carie / onlay': { poids: 10 },
  Détartrage: { poids: 8, saison: { 9: 1.4, 12: 0.7 } },
  Urgence: { poids: 7, saison: { 7: 2.2, 8: 2.4, 12: 1.5, 1: 1.2 } },
  Dévitalisation: { poids: 6 },
  'Première consultation dentaire': { poids: 5, saison: { 9: 1.4 } },
  Radio: { poids: 4 },
  'Bilan bucco-dentaire': { poids: 3 },
  Empreinte: { poids: 3 },
  Essayage: { poids: 3 },
  'Pose couronne': { poids: 3 },
  'Pose onlay': { poids: 2 },
  'Pose d’implant dentaire': { poids: 1.5 },
  'Première consultation d’implantologie': { poids: 1.5 },
  'Blanchiment des dents': { poids: 1.5, saison: { 5: 1.8, 6: 1.8, 12: 1.6 } },
}

// Durée de chaque acte (24/10 : « tu n'as fait que des rdv de 30 mn »). Les motifs arrivent tous à 30 minutes,
// au cabinet de régler les siennes (D14) : la démonstration les règle comme lui, et seulement là où personne n'y a
// encore touché.
const DUREES_DEMO: Record<string, number> = {
  Urgence: 15,
  Radio: 15,
  Essayage: 15,
  'Essayage prothèse amovible': 15,
  'Première consultation dentaire': 30,
  'Contrôle annuel et/ou détartrage': 30,
  Détartrage: 30,
  Empreinte: 30,
  'Empreinte prothèse amovible': 30,
  'Pose appareil': 30,
  'Activation d’implant': 30,
  'Première consultation d’implantologie': 30,
  'Consultation de suivi de parodontologie': 30,
  'Première consultation pour aligneurs invisibles': 30,
  'Bilan bucco-dentaire': 45,
  'Soins dentaires': 45,
  'TT carie / onlay': 45,
  'Pose onlay': 45,
  'Pose couronne': 45,
  'Dépose bridge': 45,
  'Préparation prothèse amovible': 45,
  'Première consultation de parodontologie': 45,
  'Blanchiment des dents': 60,
  Dévitalisation: 75,
  'Pose d’implant dentaire': 90,
}
const DUREE_AMORCE = 30

// La rétrocession de démonstration (D81, 28/10) : des prix plausibles, inventés, pour chaque soin ; 60 % pour
// le praticien de démonstration (pas le titulaire) ; le montant des rendez-vous déjà passés en caisse ; et les mois
// passés marqués versés, le mois en cours restant à verser. Rien de ce que le cabinet a réglé à l'écran n'est
// écrasé : seulement ce qui est encore vide.
const PRIX_DEMO: Record<string, number> = {
  Urgence: 40,
  Radio: 25,
  Essayage: 30,
  'Essayage prothèse amovible': 30,
  'Première consultation dentaire': 30,
  'Contrôle annuel et/ou détartrage': 60,
  Détartrage: 60,
  Empreinte: 50,
  'Empreinte prothèse amovible': 50,
  'Pose appareil': 300,
  'Activation d’implant': 150,
  'Première consultation d’implantologie': 50,
  'Consultation de suivi de parodontologie': 50,
  'Première consultation pour aligneurs invisibles': 50,
  'Bilan bucco-dentaire': 60,
  'Soins dentaires': 70,
  'TT carie / onlay': 90,
  'Pose onlay': 450,
  'Pose couronne': 500,
  'Dépose bridge': 120,
  'Préparation prothèse amovible': 100,
  'Première consultation de parodontologie': 60,
  'Blanchiment des dents': 350,
  Dévitalisation: 120,
  'Pose d’implant dentaire': 1200,
}
const PART_DEMO = 60

// Le chat interne (D82) : la scène de la maquette, une fois — la secrétaire écrit au praticien en citant un de ses
// prochains rendez-vous, il répond ; le titulaire lui a laissé un message qu'elle n'a pas lu. Rien si elle existe déjà.
async function poserChatDemo(prisma: PrismaClient) {
  const [secretaire, praticien, titulaire] = await Promise.all(
    ['secretaire@cabinet.demo', PRATICIEN, PRATICIEN_ADMIN].map((email) =>
      prisma.user.findUnique({ where: { email }, select: { id: true, praticien: { select: { id: true } } } }),
    ),
  )
  if (!secretaire || !praticien || !titulaire) return 'comptes de démonstration absents'
  const paire = (a: string, b: string) => (a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a })
  if (await prisma.conversationChat.findUnique({ where: { userAId_userBId: paire(secretaire.id, praticien.id) } })) {
    return 'déjà posé'
  }
  const rdv = praticien.praticien
    ? await prisma.rendezVous.findFirst({
        where: {
          praticienId: praticien.praticien.id,
          debut: { gte: new Date() },
          statut: { in: [StatutRendezVous.CONFIRME, StatutRendezVous.A_CONFIRMER] },
        },
        orderBy: { debut: 'asc' },
        select: { id: true, patientId: true, patient: { select: { prenom: true, nom: true } } },
      })
    : null
  const il = (minutes: number) => new Date(Date.now() - minutes * 60_000)
  const qui = rdv ? `${rdv.patient.prenom} ${rdv.patient.nom}` : 'Mme Dupont'
  await prisma.conversationChat.create({
    data: {
      ...paire(secretaire.id, praticien.id),
      dernierMessageLe: il(40),
      messages: {
        create: [
          {
            auteurId: secretaire.id,
            texte: `${qui} demande si elle peut venir 10 minutes plus tard.`,
            patientId: rdv?.patientId ?? null,
            rendezVousId: rdv?.id ?? null,
            envoyeLe: il(45),
            luLe: il(43),
          },
          {
            auteurId: praticien.id,
            texte: 'Oui, je la décale. Je n’ai personne après.',
            envoyeLe: il(42),
            luLe: il(41),
          },
          { auteurId: secretaire.id, texte: 'Parfait, je la préviens.', envoyeLe: il(40), luLe: il(39) },
        ],
      },
    },
  })
  await prisma.conversationChat.create({
    data: {
      ...paire(secretaire.id, titulaire.id),
      dernierMessageLe: il(15),
      messages: {
        create: [
          {
            auteurId: titulaire.id,
            texte: 'Pensez à rappeler le laboratoire pour la couronne de cet après-midi.',
            envoyeLe: il(15),
          },
        ],
      },
    },
  })
  return 'deux conversations posées'
}

async function reglerRetrocessionDemo(prisma: PrismaClient) {
  let prix = 0
  for (const [libelle, euros] of Object.entries(PRIX_DEMO)) {
    prix += (await prisma.motifConsultation.updateMany({ where: { libelle, prixCentimes: null }, data: { prixCentimes: euros * 100 } })).count
  }
  const parts = (
    await prisma.praticien.updateMany({
      // Le seul compte praticien de démonstration : un praticien créé à l'écran n'a pas de part tant qu'on ne la règle pas.
      where: { partRetrocession: null, user: { email: 'praticien@cabinet.demo' } },
      data: { partRetrocession: PART_DEMO },
    })
  ).count

  const sansMontant = await prisma.rendezVous.findMany({
    where: { statut: StatutRendezVous.EN_CAISSE, montantCentimes: null },
    select: { id: true, fin: true, motif: { select: { prixCentimes: true } } },
  })
  for (const r of sansMontant) {
    await prisma.rendezVous.update({ where: { id: r.id }, data: { montantCentimes: r.motif.prixCentimes, encaisseLe: r.fin } })
  }

  const admin = await prisma.user.findFirst({ where: { roles: { some: { role: { name: RoleName.ADMIN } } } }, select: { id: true } })
  let versements = 0
  if (admin) {
    const courant = jourLocal(new Date()).slice(0, 7)
    const praticiens = await prisma.praticien.findMany({ where: { partRetrocession: { not: null } }, select: { id: true, partRetrocession: true } })
    for (const p of praticiens) {
      const encaisses = await prisma.rendezVous.findMany({
        where: { praticienId: p.id, statut: StatutRendezVous.EN_CAISSE, montantCentimes: { not: null }, encaisseLe: { not: null } },
        select: { montantCentimes: true, encaisseLe: true },
      })
      const parMois = new Map<string, number>()
      for (const e of encaisses) {
        const mois = jourLocal(e.encaisseLe!).slice(0, 7)
        if (mois < courant) parMois.set(mois, (parMois.get(mois) ?? 0) + e.montantCentimes!)
      }
      for (const [mois, total] of parMois) {
        const [a, m] = mois.split('-').map(Number) as [number, number]
        const verseLe = new Date(Date.UTC(m === 12 ? a + 1 : a, m === 12 ? 0 : m, 2, 15))
        const cree = await prisma.versementRetrocession.createMany({
          data: [{ praticienId: p.id, mois, montantCentimes: Math.round((total * p.partRetrocession!) / 100), verseLe, verseParId: admin.id }],
          skipDuplicates: true,
        })
        versements += cree.count
      }
    }
  }
  return { prix, parts, montants: sansMontant.length, versements }
}

/** Les durées de `DUREES_DEMO`, sur les motifs et les durées par praticien encore à l'amorce de 30 minutes. */
async function appliquerDureesDemo(prisma: PrismaClient): Promise<number> {
  let n = 0
  for (const [libelle, duree] of Object.entries(DUREES_DEMO)) {
    if (duree === DUREE_AMORCE) continue
    const motifs = await prisma.motifConsultation.findMany({ where: { libelle }, select: { id: true } })
    const ids = motifs.map((m) => m.id)
    n += (await prisma.motifConsultation.updateMany({ where: { id: { in: ids }, dureeIndicative: DUREE_AMORCE }, data: { dureeIndicative: duree } })).count
    n += (await prisma.praticienMotif.updateMany({ where: { motifId: { in: ids }, dureeMinutes: DUREE_AMORCE }, data: { dureeMinutes: duree } })).count
  }
  return n
}

// Les urgences du cabinet (25/10, demandé par Marving pour l'assistant des urgences, D77) : les deux praticiens
// prennent le motif « Urgence », et 7 h 30 – 9 h leur est gardé du lundi au jeudi et le samedi à Marie-Galante
// (réponse Q17 de la praticienne). Gardé sur l'horizon de réservation, jour par jour, là où rien n'est encore posé.
const JOURS_URGENCE = [1, 2, 3, 4, 6]

async function reglerUrgencesDemo(prisma: PrismaClient) {
  const urgence = await prisma.motifConsultation.findFirst({
    where: { estUrgence: true, actif: true },
    orderBy: { ordre: 'asc' },
    select: { id: true, dureeIndicative: true },
  })
  const site = await prisma.site.findUnique({ where: { code: SiteCode.MARIE_GALANTE }, select: { id: true } })
  if (!urgence || !site) return { praticiens: 0, creneauxGardes: 0 }

  let praticiens = 0
  for (const p of await prisma.praticien.findMany({ where: { actif: true }, select: { id: true } })) {
    const lien = await prisma.praticienMotif.findUnique({ where: { praticienId_motifId: { praticienId: p.id, motifId: urgence.id } } })
    if (lien) continue
    await prisma.praticienMotif.create({ data: { praticienId: p.id, motifId: urgence.id, dureeMinutes: urgence.dureeIndicative ?? DUREE_AMORCE } })
    praticiens++
  }

  let creneauxGardes = 0
  const aujourdHui = jourLocal(new Date())
  for (let i = 0; i <= HORIZON_JOURS_DEMO; i++) {
    const jour = decalerJour(aujourdHui, i)
    if (!JOURS_URGENCE.includes(new Date(`${jour}T12:00:00Z`).getUTCDay())) continue
    const debut = instantCabinet(jour, '07:30')!
    const fin = instantCabinet(jour, '09:00')!
    const deja = await prisma.indisponibilite.count({
      where: { type: TypeIndisponibilite.RESERVE_URGENCE, siteId: site.id, debut: { lt: fin }, fin: { gt: debut } },
    })
    if (deja) continue
    await prisma.indisponibilite.create({
      data: { type: TypeIndisponibilite.RESERVE_URGENCE, siteId: site.id, debut, fin, motif: 'Créneau d’urgence' },
    })
    creneauxGardes++
  }
  return { praticiens, creneauxGardes }
}

const TELEPHONE_DERNIER_PATIENT_HISTORIQUE = `+3363998${3000 + NOMBRE_PATIENTS_HISTORIQUE - 1}`

/** Retire l'agenda généré la dernière fois : ses patients (numéros réservés), leurs rendez-vous et ce qui s'y rattache. */
async function retirerAgendaGenere(prisma: Prisma.TransactionClient) {
  const telephone = { gte: TELEPHONE_PREMIER_PATIENT_HISTORIQUE, lte: TELEPHONE_DERNIER_PATIENT_HISTORIQUE }
  const patients = (await prisma.patient.findMany({ where: { telephone }, select: { id: true } })).map((p) => p.id)
  const rendezVous = { patientId: { in: patients } }
  return {
    notifications: (await prisma.notification.deleteMany({ where: { rendezVous } })).count,
    reservationsEnLigne: (await prisma.reservationPublique.deleteMany({ where: { codeHash: 'demo-historique' } })).count,
    rendezVous: (await prisma.rendezVous.deleteMany({ where: rendezVous })).count,
    inscriptionsListeAttente: (await prisma.inscriptionListeAttente.deleteMany({ where: { telephone } })).count,
    patients: (await prisma.patient.deleteMany({ where: { id: { in: patients } } })).count,
  }
}

// Remplissage des journées selon le mois : août à moitié vide, décembre et juillet plus légers.
const REMPLISSAGE_MOIS: Record<number, number> = { 1: 0.84, 2: 0.86, 3: 0.92, 4: 0.86, 5: 0.84, 6: 0.86, 7: 0.7, 8: 0.45, 9: 0.92, 10: 0.9, 11: 0.87, 12: 0.72 }

function graine(n: number) {
  let a = n >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function poserAgenda(prisma: Prisma.TransactionClient): Promise<{ passes: number; aVenir: number } | null> {
  const maintenant = new Date()
  const aujourdHui = jourLocal(maintenant)
  const finHistorique = decalerJour(aujourdHui, -1)
  const debutHistorique = decalerJour(finHistorique, -365 * ANNEES_HISTORIQUE)
  const finAVenir = decalerJour(aujourdHui, 7 * SEMAINES_A_VENIR)

  if (await prisma.patient.count({ where: { telephone: TELEPHONE_PREMIER_PATIENT_HISTORIQUE } })) return null

  const fenetre = { gte: bornesDuJour(debutHistorique).debut, lt: bornesDuJour(decalerJour(finAVenir, 1)).debut }
  const [semaineType, plagesExistantes, motifs, durees, praticiens, dejaPris, indisponibilites, secretaire] = await Promise.all([
    prisma.presenceHebdomadaire.findMany(),
    prisma.plageDePresence.findMany({ where: { debut: fenetre } }),
    prisma.motifConsultation.findMany({ where: { actif: true } }),
    prisma.praticienMotif.findMany({ select: { praticienId: true, motifId: true, dureeMinutes: true } }),
    prisma.praticien.findMany({ where: { actif: true }, select: { id: true, titre: true } }),
    // Rendez-vous déjà posés dans ces journées (créés à l'écran) : l'agenda généré les contourne.
    prisma.rendezVous.findMany({
      where: { debut: fenetre, statut: { notIn: [StatutRendezVous.ANNULE, StatutRendezVous.ABSENT] } },
      select: { praticienId: true, fauteuilId: true, debut: true, fin: true },
    }),
    prisma.indisponibilite.findMany({
      where: { debut: { lt: fenetre.lt }, fin: { gt: bornesDuJour(aujourdHui).debut } },
      select: { praticienId: true, siteId: true, debut: true, fin: true },
    }),
    // Qui a demandé les annulations en attente : la secrétaire, comme au cabinet.
    prisma.user.findUnique({ where: { email: 'secretaire@cabinet.demo' }, select: { id: true } }),
  ])
  if (semaineType.length === 0 || motifs.length === 0) return null

  // Présences des journées passées : la semaine type, jours fériés retirés, là où rien n'existe encore.
  const dejaPresent = new Set(plagesExistantes.map((p) => `${p.praticienId}|${jourLocal(p.debut)}`))
  const plages: { praticienId: string; siteId: string; fauteuilId: string; debut: Date; fin: Date }[] = [...plagesExistantes]
  for (const praticien of praticiens) {
    const lignes = semaineType.filter((l) => l.praticienId === praticien.id)
    const voulues = plagesVouluesAvecFeries(lignes, [], { debut: debutHistorique, fin: finAVenir })
    const nouvelles = voulues
      .filter((v) => !dejaPresent.has(`${praticien.id}|${v.jour}`))
      .map((v) => ({ praticienId: praticien.id, siteId: v.siteId, fauteuilId: v.fauteuilId, debut: v.debut, fin: v.fin }))
    if (nouvelles.length) await prisma.plageDePresence.createMany({ data: nouvelles })
    plages.push(...nouvelles)
  }

  const alea = graine(Number(aujourdHui.replaceAll('-', '')))
  const tirer = <T,>(liste: { valeur: T; poids: number }[]): T => {
    const total = liste.reduce((s, x) => s + x.poids, 0)
    let r = alea() * total
    for (const x of liste) if ((r -= x.poids) <= 0) return x.valeur
    return liste.at(-1)!.valeur
  }

  // Patients : un vivier, dont une part revient régulièrement.
  const patients = Array.from({ length: NOMBRE_PATIENTS_HISTORIQUE }, (_, i) => {
    const age = tirer([
      { valeur: [3, 11], poids: 14 },
      { valeur: [12, 17], poids: 11 },
      { valeur: [18, 39], poids: 30 },
      { valeur: [40, 59], poids: 27 },
      { valeur: [60, 88], poids: 18 },
    ])
    const annee = Number(aujourdHui.slice(0, 4)) - (age[0]! + Math.floor(alea() * (age[1]! - age[0]! + 1)))
    return {
      id: randomUUID(),
      prenom: PRENOMS[i % PRENOMS.length]!,
      nom: NOMS[Math.floor(i / PRENOMS.length) % NOMS.length]!,
      // Tranche +33 6 39 98 réservée à la fiction par l'ARCEP, comme les autres patients de démonstration.
      telephone: `+3363998${String(3000 + i).padStart(4, '0')}`,
      dateNaissance: alea() < 0.92 ? new Date(`${annee}-${String(1 + Math.floor(alea() * 12)).padStart(2, '0')}-${String(1 + Math.floor(alea() * 28)).padStart(2, '0')}`) : null,
      profilComplet: true,
    }
  })
  // Une patientèle déjà là au début de l'historique (fiches plus anciennes), puis quelques nouveaux chaque
  // semaine, dont la fiche naît à leur premier rendez-vous ; à chaque arrivée, un ancien cesse de venir.
  const creeLe = new Map<string, Date>(
    patients.slice(0, PATIENTELE_INITIALE).map((p) => [p.id, new Date(bornesDuJour(debutHistorique).debut.getTime() - alea() * 3 * 365 * 86_400_000)]),
  )
  let prochainNouveau = PATIENTELE_INITIALE
  const reguliers: string[] = patients.slice(0, PATIENTELE_INITIALE).map((p) => p.id)
  const patientSuivant = (prisLe: Date) => {
    if (alea() < 0.075 && prochainNouveau < patients.length) {
      const id = patients[prochainNouveau++]!.id
      creeLe.set(id, prisLe)
      if (alea() < 0.8) reguliers.splice(Math.floor(alea() * reguliers.length), 1)
      reguliers.push(id)
      return id
    }
    return reguliers[Math.floor(alea() * reguliers.length)]!
  }

  const dureeDe = (praticienId: string, motif: (typeof motifs)[number]) =>
    durees.find((d) => d.praticienId === praticienId && d.motifId === motif.id)?.dureeMinutes ?? motif.dureeIndicative ?? 30

  const rendezVous: (Prisma.RendezVousCreateManyInput & { id: string })[] = []
  const enLigne: { rendezVousId: string; motifId: string; praticienId: string; siteId: string; debut: Date; fin: Date; createdAt: Date; patient: (typeof patients)[number] }[] = []
  const annulesPourListe: { motifId: string; siteId: string; praticienId: string; debut: Date; fin: Date; le: Date }[] = []

  const totalJours = 365 * ANNEES_HISTORIQUE
  const parPatient = new Map<string, (typeof patients)[number]>(patients.map((p) => [p.id, p]))
  plages.sort((a, b) => a.debut.getTime() - b.debut.getTime())

  let aVenir = 0
  for (const plage of plages) {
    const jour = jourLocal(plage.debut)
    if (jour < debutHistorique || jour > finAVenir) continue
    const mois = Number(jour.slice(5, 7))
    const anciennete = Math.max(0, (new Date(`${finHistorique}T12:00:00Z`).getTime() - new Date(`${jour}T12:00:00Z`).getTime()) / 86_400_000 / totalJours)
    // Jours à venir : l'agenda se remplit à mesure que la date approche, plein la semaine qui vient, au tiers dans six semaines.
    const dans = (new Date(`${jour}T12:00:00Z`).getTime() - new Date(`${aujourdHui}T12:00:00Z`).getTime()) / 86_400_000
    const coefAVenir = dans > 0 ? Math.max(0.3, 1 - 0.016 * dans) : 1
    const indexSemaine = new Date(`${jour}T12:00:00Z`).getUTCDay()
    const implantologue = praticiens.find((p) => p.id === plage.praticienId)?.titre.includes('implant')

    const candidats = motifs.map((m) => {
      const regle = POIDS_MOTIF[m.libelle]
      let poids = (regle?.poids ?? 0.8) * (regle?.saison?.[mois] ?? 1)
      if (implantologue && /implant/i.test(m.libelle)) poids *= 3
      return { valeur: m, poids }
    })

    // La semaine type de démonstration n'a pas de pause : l'heure du midi reste ouverte, mais peu demandée.
    const midi = instantCabinet(jour, '12:00')!.getTime()
    const reprise = instantCabinet(jour, '14:00')!.getTime()
    let t = plage.debut.getTime()
    while (t < plage.fin.getTime()) {
      const motif = tirer(candidats)
      const duree = dureeDe(plage.praticienId, motif)
      const fin = t + duree * 60_000
      const pris =
        dejaPris.some(
          (r) => (r.praticienId === plage.praticienId || r.fauteuilId === plage.fauteuilId) && r.debut.getTime() < fin && r.fin.getTime() > t,
        ) ||
        // Congé du praticien, fermeture du cabinet (ou des deux) : rien n'y est posé.
        indisponibilites.some(
          (i) =>
            (i.praticienId === null || i.praticienId === plage.praticienId) &&
            (i.siteId === null || i.siteId === plage.siteId) &&
            i.debut.getTime() < fin &&
            i.fin.getTime() > t,
        )
      if (pris || fin > plage.fin.getTime()) {
        t += 15 * 60_000
        continue
      }
      // Une activité qui croît d'environ 6 % par an : les journées anciennes sont un peu moins remplies.
      const coefMidi = t >= midi && t < reprise ? 0.3 : 1
      if (alea() > REMPLISSAGE_MOIS[mois]! * coefMidi * coefAVenir * (1 - 0.06 * anciennete * ANNEES_HISTORIQUE)) {
        t = fin
        continue
      }

      const debut = new Date(t)
      const heure = (t - bornesDuJour(jour).debut.getTime()) / 3_600_000
      let pAbsent = 0.05 + 0.015 * anciennete
      if (indexSemaine === 1 && heure < 12) pAbsent += 0.07
      if (/détartrage/i.test(motif.libelle)) pAbsent += 0.04
      if (heure >= 16) pAbsent += 0.02
      if (mois === 8 || mois === 12) pAbsent += 0.02
      if (motif.estUrgence) pAbsent = 0.01
      const tirage = alea()
      const passe = fin <= maintenant.getTime()
      let statut: StatutRendezVous =
        tirage < pAbsent
          ? StatutRendezVous.ABSENT
          : tirage < pAbsent + 0.07
            ? StatutRendezVous.ANNULE
            : alea() < 0.9
              ? StatutRendezVous.TERMINE
              : StatutRendezVous.EN_CAISSE
      let annulationDemandee = false
      if (!passe) {
        // À venir : confirmé la plupart du temps dans les deux jours, plus souvent à confirmer au-delà ; aujourd'hui,
        // le patient en cours est au fauteuil et le suivant (moins d'une demi-heure) en salle d'attente.
        const tirageAVenir = alea()
        if (debut.getTime() <= maintenant.getTime()) statut = StatutRendezVous.AU_FAUTEUIL
        else if (jour === aujourdHui && debut.getTime() - maintenant.getTime() < 30 * 60_000) statut = StatutRendezVous.SALLE_ATTENTE
        else if (tirageAVenir < 0.03) statut = StatutRendezVous.ANNULE
        else {
          statut = alea() < (dans <= 2 ? 0.85 : 0.35) ? StatutRendezVous.CONFIRME : StatutRendezVous.A_CONFIRMER
          annulationDemandee = dans > 0 && tirageAVenir < 0.05 && secretaire !== null
        }
      }

      // Prise du rendez-vous : le jour même pour une urgence, sinon quelques jours à six semaines avant — jamais après
      // aujourd'hui.
      const avance = motif.estUrgence ? alea() * 0.4 : 2 + Math.floor(alea() ** 1.6 * 45)
      const createdAt = new Date(
        Math.min(
          maintenant.getTime() - alea() * 3_600_000,
          Math.max(debut.getTime() - avance * 86_400_000 - alea() * 4 * 3_600_000, debut.getTime() - 60 * 86_400_000),
        ),
      )
      const partEnLigne = 0.4 - 0.28 * anciennete
      const id = randomUUID()
      const patientId = patientSuivant(createdAt)
      rendezVous.push({
        id,
        patientId,
        praticienId: plage.praticienId,
        siteId: plage.siteId,
        fauteuilId: plage.fauteuilId,
        motifId: motif.id,
        debut,
        fin: new Date(fin),
        ...(annulationDemandee
          ? {
              statut: StatutRendezVous.ANNULATION_DEMANDEE,
              statutAvantAnnulation: statut,
              annulationDemandeeParId: secretaire!.id,
              annulationDemandeeLe: new Date(maintenant.getTime() - alea() * 86_400_000),
            }
          : { statut }),
        surbooking: false,
        manquementCompte: passe && (statut === StatutRendezVous.ABSENT || (statut === StatutRendezVous.ANNULE && alea() < 0.45)),
        createdAt,
      })
      if (!passe) aVenir++
      if (passe && !motif.estUrgence && alea() < partEnLigne) {
        enLigne.push({ rendezVousId: id, motifId: motif.id, praticienId: plage.praticienId, siteId: plage.siteId, debut, fin: new Date(fin), createdAt, patient: parPatient.get(patientId)! })
      }
      if (passe && statut === StatutRendezVous.ANNULE && alea() < 0.5) {
        annulesPourListe.push({ motifId: motif.id, siteId: plage.siteId, praticienId: plage.praticienId, debut, fin: new Date(fin), le: new Date(debut.getTime() - (1 + alea() * 3) * 86_400_000) })
      }
      t = fin
    }
  }

  const utilises = patients.filter((p) => creeLe.has(p.id))
  await prisma.patient.createMany({ data: utilises.map((p) => ({ ...p, createdAt: creeLe.get(p.id)! })) })
  await prisma.preferenceNotification.createMany({
    data: utilises.map((p) => ({ canal: CanalNotification.SMS, destinataire: p.telephone, rappels: false, nonEssentiels: false })),
    skipDuplicates: true,
  })
  for (let i = 0; i < rendezVous.length; i += 1000) {
    await prisma.rendezVous.createMany({ data: rendezVous.slice(i, i + 1000) })
  }
  for (let i = 0; i < enLigne.length; i += 1000) {
    await prisma.reservationPublique.createMany({
      data: enLigne.slice(i, i + 1000).map((r) => ({
        motifId: r.motifId,
        praticienId: r.praticienId,
        siteId: r.siteId,
        debut: r.debut,
        fin: r.fin,
        nom: r.patient.nom,
        prenom: r.patient.prenom,
        telephone: r.patient.telephone,
        codeHash: 'demo-historique',
        expiresAt: r.createdAt,
        ipAddress: '127.0.0.1',
        rendezVousId: r.rendezVousId,
        createdAt: r.createdAt,
      })),
    })
  }
  // Des créneaux annulés proposés à la liste d'attente, pour l'onglet « Prise de rendez-vous ».
  for (const a of annulesPourListe) {
    await prisma.inscriptionListeAttente.create({
      data: {
        telephone: utilises[Math.floor(alea() * utilises.length)]!.telephone,
        motifId: a.motifId,
        siteId: a.siteId,
        createdAt: new Date(a.le.getTime() - 10 * 86_400_000),
        expiresAt: a.debut,
        envois: {
          create: {
            creneauDebut: a.debut,
            creneauFin: a.fin,
            praticienId: a.praticienId,
            siteId: a.siteId,
            motifId: a.motifId,
            statut: 'ENVOYE',
            envoyeLe: a.le,
            createdAt: a.le,
          },
        },
      },
    })
  }
  return { passes: rendezVous.length - aVenir, aVenir }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
