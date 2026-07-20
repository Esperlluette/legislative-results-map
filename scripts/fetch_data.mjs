// Télécharge les données brutes nécessaires : résultats législatives 2024 par bureau
// de vote (1er et 2e tour) depuis data.gouv.fr, et les contours des communes depuis
// gregoiredavid/france-geojson. Les fichiers sont volumineux (~20-40 Mo chacun) et
// stockés dans data/raw/ (non versionné).

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const RAW_DIR = path.join(import.meta.dirname, "..", "data", "raw");

const SOURCES = [
  {
    name: "tour1-bureaux.csv",
    url: "https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour/20240710-171445/resultats-definitifs-par-bureau-de-vote.csv",
  },
  {
    name: "tour2-bureaux.csv",
    url: "https://static.data.gouv.fr/resources/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour/20240710-170658/resultats-definitifs-par-bureau-de-vote.csv",
  },
  {
    name: "communes.geojson",
    url: "https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/communes-version-simplifiee.geojson",
  },
  {
    // Adresses des lieux de vote (INSEE, Répertoire Électoral Unique, 2022).
    // Permet d'afficher une adresse lisible plutôt qu'un simple numéro de bureau.
    name: "bv-adresses.csv",
    url: "https://static.data.gouv.fr/resources/bureaux-de-vote-et-adresses-de-leurs-electeurs/20230626-135808/table-bv-reu.csv",
  },
  {
    name: "presidentielle-tour1.csv",
    url: "https://static.data.gouv.fr/resources/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-1er-tour/20220414-152542/resultats-par-niveau-burvot-t1-france-entiere.txt",
  },
  {
    name: "presidentielle-tour2.csv",
    url: "https://static.data.gouv.fr/resources/election-presidentielle-des-10-et-24-avril-2022-resultats-definitifs-du-2nd-tour/20220428-142237/resultats-par-niveau-burvot-t2-france-entiere.txt",
  },
];

async function download(name, url) {
  const dest = path.join(RAW_DIR, name);
  if (existsSync(dest)) {
    console.log(`[skip] ${name} déjà présent (supprimer data/raw/${name} pour re-télécharger)`);
    return;
  }
  console.log(`[fetch] ${name} depuis ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Échec du téléchargement de ${url} : HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`[ok] ${name} (${(buf.length / 1024 / 1024).toFixed(1)} Mo)`);
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  for (const { name, url } of SOURCES) {
    await download(name, url);
  }
  console.log("Terminé. Lance maintenant `npm run process-data`.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
