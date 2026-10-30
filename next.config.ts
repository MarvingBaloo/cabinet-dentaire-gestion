import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `next dev` ajoute sinon un bloc en anglais à la fin de notre CLAUDE.md, à
  // chaque lancement. Son contenu utile est repris dans le CLAUDE.md, en français.
  agentRules: false,
  // Les parcours Playwright lancent leur propre `next dev` sur la base de test : un dossier de construction à
  // part, sinon Next refuse de démarrer à côté du serveur de développement déjà ouvert (« Another next dev
  // server is already running »).
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
  // Sortie autonome : l'image ne contient que le serveur et les modules
  // réellement tracés, au lieu de tout node_modules. Sur un hébergeur HDS
  // facturé au stockage et à la bande passante, la différence est réelle.
  // Pas sur Vercel (VERCEL=1 à la construction) : son adaptateur attend la sortie
  // ordinaire et échoue sur `next-server.js.nft.json` absent.
  ...(process.env.VERCEL ? {} : { output: 'standalone' as const }),
};

export default nextConfig;
