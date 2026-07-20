// Agrège les CSV bruts (par bureau de vote, 1er et 2e tour) par commune, pour
// chaque élection configurée (législatives 2024, présidentielle 2022), fusionne
// les résultats dans communes.geojson (pour le choroplèthe) et écrit un fichier
// détaillé par commune dans public/data/bureaux/<code_insee>.json (chargé à la
// demande côté client).

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(import.meta.dirname, "..");
const RAW_DIR = path.join(ROOT, "data", "raw");
const OUT_DIR = path.join(ROOT, "public", "data");
const BUREAUX_DIR = path.join(OUT_DIR, "bureaux");

// Parseur CSV minimal gérant les champs entre guillemets (avec ou sans quotes,
// les deux formats sont utilisés selon le fichier) et les guillemets échappés ("").
function parseCsvLine(line, delimiter = ";") {
  const fields = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      fields.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur);
  return fields;
}

function parseFrNumber(str) {
  if (!str) return 0;
  return parseInt(str.replace(/\s/g, ""), 10) || 0;
}

function titleCase(str) {
  return (str || "")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])\p{L}/gu, (m) => m.toUpperCase());
}

// Charge les adresses des lieux de vote (INSEE) et les indexe par
// "<code_commune_election>_<bureau_padded>" (colonne id_brut_miom), qui correspond
// directement au code commune + code BV utilisés dans les CSV de résultats.
async function loadAddresses() {
  const filePath = path.join(RAW_DIR, "bv-adresses.csv");
  const buf = await readFile(filePath);
  const lines = buf.toString("utf8").split("\n").filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0], ",");
  const iLibelle = header.indexOf("libelle_reu");
  const iNumVoie = header.indexOf("num_voie_reu");
  const iVoie = header.indexOf("voie_reu");
  const iCp = header.indexOf("cp_reu");
  const iCommune = header.indexOf("commune_reu");
  const iKey = header.indexOf("id_brut_miom");

  const map = new Map();
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li], ",");
    const key = cols[iKey]?.trim();
    if (!key) continue;
    const numVoie = cols[iNumVoie]?.trim();
    const voie = titleCase(cols[iVoie]);
    const cp = cols[iCp]?.trim() || "";
    const communeReu = titleCase(cols[iCommune]);
    const libelle = titleCase(cols[iLibelle]);
    const street = [numVoie, voie].filter(Boolean).join(" ");
    // cp "00000" / commune vide sont des défauts du fichier source INSEE — dans ce
    // cas on complète avec le vrai nom de commune (connu par ailleurs, via les
    // résultats électoraux) plutôt qu'un faux code postal.
    map.set(key, { libelle, street, cp: cp && cp !== "00000" ? cp : "", communeReu });
  }
  return map;
}

// Charge les coordonnées géocodées (data/raw/bv-coords.csv, généré par
// scripts/geocode_addresses.mjs) et les indexe par id_brut_miom. Ne garde que les
// résultats de géocodage suffisamment fiables (result_score >= 0.4) pour éviter de
// placer un point au mauvais endroit.
async function loadCoords() {
  const filePath = path.join(RAW_DIR, "bv-coords.csv");
  if (!existsSync(filePath)) {
    console.log("  (pas de data/raw/bv-coords.csv — lance `npm run geocode` pour activer les points sur la carte)");
    return new Map();
  }
  const buf = await readFile(filePath);
  const lines = buf.toString("utf8").split("\n").filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0], ",");
  const iKey = header.indexOf("id_brut_miom");
  const iLon = header.indexOf("longitude");
  const iLat = header.indexOf("latitude");
  const iScore = header.indexOf("result_score");

  const map = new Map();
  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li], ",");
    const key = cols[iKey]?.trim();
    const lon = parseFloat(cols[iLon]);
    const lat = parseFloat(cols[iLat]);
    const score = parseFloat(cols[iScore]);
    if (!key || Number.isNaN(lon) || Number.isNaN(lat) || score < 0.4) continue;
    map.set(key, { lat, lon });
  }
  return map;
}

// Législatives 2024 : CSV UTF-8, code commune INSEE déjà complet, nuance politique
// fournie par le Ministère de l'Intérieur, blocs candidat numérotés dans le header.
async function parseLegislativesCsv(filePath) {
  const buf = await readFile(filePath);
  const text = buf.toString("utf8");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);

  const idx = (name) => header.indexOf(name);
  const iDept = idx("Code département");
  const iCommune = idx("Code commune");
  const iCommuneLabel = idx("Libellé commune");
  const iBV = idx("Code BV");
  const iInscrits = idx("Inscrits");
  const iVotants = idx("Votants");
  const iAbstentions = idx("Abstentions");
  const iExprimes = idx("Exprimés");
  const iBlancs = idx("Blancs");
  const iNuls = idx("Nuls");

  // Détecte dynamiquement les blocs "candidat N" (nombre variable selon les tours).
  const candidateBlocks = [];
  for (let n = 1; ; n++) {
    const iNuance = idx(`Nuance candidat ${n}`);
    if (iNuance === -1) break;
    candidateBlocks.push({
      nuance: iNuance,
      nom: idx(`Nom candidat ${n}`),
      prenom: idx(`Prénom candidat ${n}`),
      voix: idx(`Voix ${n}`),
      elu: idx(`Elu ${n}`),
    });
  }

  const byCommune = new Map();

  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    if (cols.length < header.length - 5) continue; // ligne incomplète/vide en fin de fichier
    const codeCommune = cols[iCommune]?.trim();
    if (!codeCommune) continue;

    const results = [];
    for (const block of candidateBlocks) {
      const nuance = cols[block.nuance]?.trim();
      if (!nuance) continue;
      results.push({
        nuance,
        nom: cols[block.nom]?.trim() || "",
        prenom: cols[block.prenom]?.trim() || "",
        voix: parseFrNumber(cols[block.voix]),
        elu: (cols[block.elu]?.trim() || "") !== "",
      });
    }

    // Le code BV n'est pas zéro-préfixé dans le fichier du 1er tour ("1", "2"...)
    // contrairement au 2nd tour et à la base d'adresses ("0001", "0002"...) — on
    // uniformise sur 4 chiffres pour que la jointure avec les adresses fonctionne.
    const bureauEntry = {
      bureau: (cols[iBV]?.trim() || "").padStart(4, "0"),
      inscrits: parseFrNumber(cols[iInscrits]),
      votants: parseFrNumber(cols[iVotants]),
      abstentions: parseFrNumber(cols[iAbstentions]),
      exprimes: parseFrNumber(cols[iExprimes]),
      blancs: parseFrNumber(cols[iBlancs]),
      nuls: parseFrNumber(cols[iNuls]),
      results,
    };

    if (!byCommune.has(codeCommune)) {
      byCommune.set(codeCommune, {
        communeLabel: cols[iCommuneLabel]?.trim() || "",
        dept: cols[iDept]?.trim() || "",
        bureaux: [],
      });
    }
    byCommune.get(codeCommune).bureaux.push(bureauEntry);
  }

  return byCommune;
}

// Présidentielle 2022 : CSV Latin-1, code commune éclaté en "Code du département" +
// "Code de la commune" (à recomposer), pas de colonne nuance (juste nom/prénom du
// candidat — on la déduit via NUANCE_BY_CANDIDATE), blocs candidat non numérotés
// dans le header (répétition des mêmes noms de colonnes).
const NUANCE_BY_CANDIDATE = {
  ARTHAUD: "EXG",
  ROUSSEL: "COM",
  MACRON: "ENS",
  LASSALLE: "DIV",
  "LE PEN": "RN",
  ZEMMOUR: "REC",
  MÉLENCHON: "FI",
  HIDALGO: "SOC",
  JADOT: "VEC",
  PÉCRESSE: "LR",
  POUTOU: "EXG",
  "DUPONT-AIGNAN": "DVD",
};

async function parsePresidentielleCsv(filePath, { isSecondRound }) {
  const buf = await readFile(filePath);
  const text = buf.toString("latin1");
  const lines = text.split("\n").filter((l) => l.trim().length > 0);
  const header = parseCsvLine(lines[0]);

  const idx = (name) => header.indexOf(name);
  const iDept = idx("Code du département");
  const iCommuneShort = idx("Code de la commune");
  const iCommuneLabel = idx("Libellé de la commune");
  const iBV = idx("Code du b.vote");
  const iInscrits = idx("Inscrits");
  const iVotants = idx("Votants");
  const iAbstentions = idx("Abstentions");
  const iExprimes = idx("Exprimés");
  const iBlancs = idx("Blancs");
  const iNuls = idx("Nuls");

  // Le header ne liste les colonnes candidat ("N°Panneau;Sexe;Nom;Prénom;Voix;...")
  // qu'UNE seule fois, alors que chaque ligne de données répète ce bloc de 7
  // colonnes une fois par candidat (12 fois au 1er tour, 2 au 2nd). On calcule donc
  // le nombre de blocs à partir de la longueur réelle d'une ligne de données plutôt
  // que du header.
  const blockStart = idx("N°Panneau");
  const blockWidth = 7; // N°Panneau, Sexe, Nom, Prénom, Voix, % Voix/Ins, % Voix/Exp
  const firstDataCols = parseCsvLine(lines[1]);
  const nomIndices = [];
  for (let n = 0; blockStart + n * blockWidth + 2 < firstDataCols.length; n++) {
    nomIndices.push(blockStart + n * blockWidth + 2); // "Nom" est le 3e champ du bloc
  }

  const byCommune = new Map();

  for (let li = 1; li < lines.length; li++) {
    const cols = parseCsvLine(lines[li]);
    if (cols.length < header.length - 5) continue;
    const dept = cols[iDept]?.trim();
    const communeShort = cols[iCommuneShort]?.trim();
    if (!dept || !communeShort) continue;
    const codeCommune = dept + communeShort.padStart(3, "0");

    const results = [];
    for (const nomIdx of nomIndices) {
      const nom = cols[nomIdx]?.trim();
      if (!nom) continue;
      const nuance = NUANCE_BY_CANDIDATE[nom.toUpperCase()] || null;
      results.push({
        nuance,
        nom,
        prenom: cols[nomIdx + 1]?.trim() || "",
        voix: parseFrNumber(cols[nomIdx + 2]),
        // Pas de colonne "élu" par bureau pour la présidentielle (le résultat se
        // joue au niveau national) — on marque le vainqueur officiel du 2nd tour.
        elu: isSecondRound && nom.toUpperCase() === "MACRON",
      });
    }

    const bureauEntry = {
      bureau: (cols[iBV]?.trim() || "").padStart(4, "0"),
      inscrits: parseFrNumber(cols[iInscrits]),
      votants: parseFrNumber(cols[iVotants]),
      abstentions: parseFrNumber(cols[iAbstentions]),
      exprimes: parseFrNumber(cols[iExprimes]),
      blancs: parseFrNumber(cols[iBlancs]),
      nuls: parseFrNumber(cols[iNuls]),
      results,
    };

    if (!byCommune.has(codeCommune)) {
      byCommune.set(codeCommune, {
        communeLabel: cols[iCommuneLabel]?.trim() || "",
        dept,
        bureaux: [],
      });
    }
    byCommune.get(codeCommune).bureaux.push(bureauEntry);
  }

  return byCommune;
}

function aggregateCommune(bureaux) {
  const totals = { inscrits: 0, votants: 0, abstentions: 0, exprimes: 0, blancs: 0, nuls: 0 };
  const nuanceVoix = new Map();
  const nuanceElu = new Map();

  for (const bv of bureaux) {
    totals.inscrits += bv.inscrits;
    totals.votants += bv.votants;
    totals.abstentions += bv.abstentions;
    totals.exprimes += bv.exprimes;
    totals.blancs += bv.blancs;
    totals.nuls += bv.nuls;
    for (const r of bv.results) {
      nuanceVoix.set(r.nuance, (nuanceVoix.get(r.nuance) || 0) + r.voix);
      if (r.elu) nuanceElu.set(r.nuance, true);
    }
  }

  const results = [...nuanceVoix.entries()]
    .map(([nuance, voix]) => ({
      nuance,
      voix,
      pct: totals.exprimes > 0 ? +((voix / totals.exprimes) * 100).toFixed(2) : 0,
      elu: nuanceElu.has(nuance),
    }))
    .sort((a, b) => b.voix - a.voix);

  return {
    inscrits: totals.inscrits,
    votants: totals.votants,
    abstentions: totals.abstentions,
    exprimes: totals.exprimes,
    blancs: totals.blancs,
    nuls: totals.nuls,
    participation: totals.inscrits > 0 ? +((totals.votants / totals.inscrits) * 100).toFixed(2) : 0,
    leadingNuance: results[0]?.nuance ?? null,
    results,
  };
}

function bvSummary(bv) {
  const participation = bv.inscrits > 0 ? +((bv.votants / bv.inscrits) * 100).toFixed(2) : 0;
  const results = bv.results
    .map((r) => ({ ...r, pct: bv.exprimes > 0 ? +((r.voix / bv.exprimes) * 100).toFixed(2) : 0 }))
    .sort((a, b) => b.voix - a.voix);
  return { participation, results };
}

// Chaque élection ajoutée ici est automatiquement fusionnée dans communes.geojson
// (props.<key>.tour1/tour2) et dans public/data/bureaux/<code>.json.
const ELECTIONS = [
  {
    key: "legislatives",
    label: "Législatives 2024",
    tour1File: "tour1-bureaux.csv",
    tour2File: "tour2-bureaux.csv",
    parse: (filePath) => parseLegislativesCsv(filePath),
  },
  {
    key: "presidentielle",
    label: "Présidentielle 2022",
    tour1File: "presidentielle-tour1.csv",
    tour2File: "presidentielle-tour2.csv",
    parse: (filePath, isSecondRound) => parsePresidentielleCsv(filePath, { isSecondRound }),
  },
];

async function main() {
  console.log("[1/5] Lecture des CSV bruts...");
  for (const election of ELECTIONS) {
    election.tour1 = await election.parse(path.join(RAW_DIR, election.tour1File), false);
    election.tour2 = await election.parse(path.join(RAW_DIR, election.tour2File), true);
    console.log(`  ${election.label} — tour1: ${election.tour1.size} communes | tour2: ${election.tour2.size} communes`);
  }

  console.log("[2/5] Chargement du geojson des communes...");
  const geojson = JSON.parse(await readFile(path.join(RAW_DIR, "communes.geojson"), "utf8"));

  console.log("[3/5] Chargement des adresses et coordonnées des lieux de vote...");
  const addresses = await loadAddresses();
  const coords = await loadCoords();
  console.log(`  ${addresses.size} adresses indexées, ${coords.size} géocodées`);

  console.log("[4/5] Fusion des résultats agrégés dans le geojson...");
  let matched = 0;
  for (const feature of geojson.features) {
    const code = feature.properties.code;
    const props = { code, nom: feature.properties.nom };
    let hasAny = false;

    for (const election of ELECTIONS) {
      const c1 = election.tour1.get(code);
      const c2 = election.tour2.get(code);
      if (!c1 && !c2) continue;
      props[election.key] = {};
      if (c1) props[election.key].tour1 = aggregateCommune(c1.bureaux);
      if (c2) props[election.key].tour2 = aggregateCommune(c2.bureaux);
      hasAny = true;
    }
    if (hasAny) matched++;

    feature.properties = props;
  }
  console.log(`  ${matched}/${geojson.features.length} communes avec au moins un résultat`);

  await mkdir(OUT_DIR, { recursive: true });
  await writeFile(path.join(OUT_DIR, "communes.geojson"), JSON.stringify(geojson));

  console.log("[5/5] Écriture du détail par bureau de vote (public/data/bureaux/)...");
  await rm(BUREAUX_DIR, { recursive: true, force: true });
  await mkdir(BUREAUX_DIR, { recursive: true });

  const withAddress = (code, communeLabel) => (bv) => {
    const key = `${code}_${bv.bureau}`;
    const addr = addresses.get(key);
    const geo = coords.get(key);
    let adresse = null;
    if (addr) {
      // Complète avec le vrai nom de commune (issu des résultats électoraux, fiable)
      // quand le code postal source est absent/invalide, plutôt qu'un faux code postal.
      const cityPart = addr.cp ? `${addr.cp} ${addr.communeReu}`.trim() : communeLabel;
      adresse = [addr.street, cityPart].filter(Boolean).join(", ");
    }
    return {
      ...bv,
      ...bvSummary(bv),
      libelle: addr?.libelle || null,
      adresse: adresse || null,
      lat: geo?.lat ?? null,
      lon: geo?.lon ?? null,
    };
  };

  const allCodes = new Set();
  for (const election of ELECTIONS) {
    for (const code of election.tour1.keys()) allCodes.add(code);
    for (const code of election.tour2.keys()) allCodes.add(code);
  }

  let written = 0;
  let withAddr = 0;
  for (const code of allCodes) {
    const detail = { code, nom: "" };
    let anyAddr = false;

    for (const election of ELECTIONS) {
      const c1 = election.tour1.get(code);
      const c2 = election.tour2.get(code);
      if (!c1 && !c2) continue;
      const communeLabel = c1?.communeLabel || c2?.communeLabel || "";
      if (!detail.nom) detail.nom = communeLabel;
      const t1 = c1 ? c1.bureaux.map(withAddress(code, communeLabel)) : null;
      const t2 = c2 ? c2.bureaux.map(withAddress(code, communeLabel)) : null;
      if (t1?.some((b) => b.adresse) || t2?.some((b) => b.adresse)) anyAddr = true;
      detail[election.key] = { tour1: t1, tour2: t2 };
    }

    if (anyAddr) withAddr++;
    await writeFile(path.join(BUREAUX_DIR, `${code}.json`), JSON.stringify(detail));
    written++;
  }
  console.log(`  ${written} fichiers écrits (${withAddr} communes avec au moins une adresse)`);

  console.log("Terminé.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
