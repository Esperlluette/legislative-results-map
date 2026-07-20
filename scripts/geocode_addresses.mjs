// Géocode les adresses des bureaux de vote (data/raw/bv-adresses.csv) via l'API
// Adresse officielle (Base Adresse Nationale, data.gouv.fr), pour pouvoir placer
// un point sur la carte pour chaque bureau. Résultat mis en cache dans
// data/raw/bv-coords.csv (~5 minutes pour ~69 000 adresses, à ne lancer qu'une fois).

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const RAW_DIR = path.join(import.meta.dirname, "..", "data", "raw");
const SRC = path.join(RAW_DIR, "bv-adresses.csv");
const DEST = path.join(RAW_DIR, "bv-coords.csv");
const BAN_URL = "https://api-adresse.data.gouv.fr/search/csv/";

async function main() {
  if (existsSync(DEST)) {
    console.log(`[skip] ${DEST} existe déjà (supprimer le fichier pour re-géocoder)`);
    return;
  }
  if (!existsSync(SRC)) {
    throw new Error(`${SRC} introuvable — lance d'abord npm run fetch-data`);
  }

  console.log("[geocode] Envoi des adresses à l'API Adresse (data.gouv.fr)...");
  const buf = await readFile(SRC);
  const form = new FormData();
  form.append("data", new Blob([buf], { type: "text/csv" }), "bv-adresses.csv");
  for (const col of ["num_voie_reu", "voie_reu", "cp_reu", "commune_reu"]) {
    form.append("columns", col);
  }
  // Contraint la recherche au bon code INSEE : certaines lignes ont un code postal
  // "00000" et une commune vide (défaut du fichier source), ce qui sans cette
  // contrainte fait matcher l'adresse dans une tout autre ville de France portant
  // une rue au nom identique (ex. "Rue Claude Monet" à Arras géocodée à Rouen).
  form.append("citycode", "code_commune");

  const res = await fetch(BAN_URL, { method: "POST", body: form });
  if (!res.ok) {
    throw new Error(`Échec du géocodage : HTTP ${res.status}`);
  }
  const csv = await res.text();
  await writeFile(DEST, csv);
  console.log(`[ok] Coordonnées écrites dans ${DEST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
