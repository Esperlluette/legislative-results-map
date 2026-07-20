# polmap — Carte des résultats des législatives 2024

Carte interactive de France (choroplèthe par commune) affichant les résultats
officiels des élections législatives 2024 (1er et 2e tour). Au clic sur une
commune : camembert des résultats agrégés, participation, et une sidebar
listant tous les bureaux de vote de la commune — triable par abstention,
participation ou nombre d'inscrits, filtrable par adresse/école/numéro. La
sélection d'un bureau place un point sur la carte à son adresse géocodée.

Cet outil ne calcule aucun score de priorité — il affiche uniquement les
chiffres officiels. Les décisions restent humaines.

## Sources de données

- Résultats officiels par bureau de vote (Ministère de l'Intérieur, via data.gouv.fr) :
  - [1er tour](https://www.data.gouv.fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-1er-tour)
  - [2e tour](https://www.data.gouv.fr/datasets/elections-legislatives-des-30-juin-et-7-juillet-2024-resultats-definitifs-du-2nd-tour)
- Contours des communes : [gregoiredavid/france-geojson](https://github.com/gregoiredavid/france-geojson) (`communes-version-simplifiee.geojson`)
- Adresses des lieux de vote : [Bureaux de vote et adresses de leurs électeurs](https://www.data.gouv.fr/datasets/bureaux-de-vote-et-adresses-de-leurs-electeurs) (INSEE, Répertoire Électoral Unique, extraction 2022) — permet d'afficher le nom du lieu et l'adresse de chaque bureau plutôt qu'un simple numéro. Extraction 2022, donc possibles écarts mineurs avec la numérotation 2024 (~9% des communes sans adresse trouvée).
- Coordonnées GPS des bureaux : géocodage des adresses ci-dessus via l'[API Adresse officielle](https://api-adresse.data.gouv.fr/) (Base Adresse Nationale, gratuite, sans clé) — permet de placer un point sur la carte pour le bureau sélectionné (~95% des adresses géocodées avec un score de confiance suffisant).

**Limite connue** : il n'existe pas de contours géographiques officiels des
bureaux de vote au niveau national. Le zoom cartographique le plus fin avec
des polygones est donc la commune ; le point affiché pour un bureau de vote
est une position ponctuelle géocodée (approximative selon la précision de
l'adresse), pas un polygone officiel. Quelques communes de la CSV (territoires
d'outre-mer, fusions de communes) n'ont pas de polygone correspondant dans le
geojson simplifié et n'apparaissent donc pas sur la carte.

## Installation

```bash
npm install
npm run fetch-data     # télécharge les CSV bruts + geojson dans data/raw/ (~76 Mo)
npm run geocode         # géocode les adresses des bureaux (~5 min, mis en cache)
npm run process-data   # génère public/data/communes.geojson + public/data/bureaux/*.json
npm run dev             # lance le serveur de dev sur http://localhost:5173
```

`npm run geocode` peut être sauté (le point sur la carte sera simplement
absent pour les bureaux non géocodés) mais est recommandé.

Pour rafraîchir les données (nouvelle élection, correctifs), supprimer
`data/raw/` puis relancer `npm run fetch-data && npm run geocode && npm run process-data`.

## Build de production

```bash
npm run build      # génère dist/
npm run preview    # sert le build localement
```

`dist/` est un site 100% statique (aucun backend) — déployable sur n'importe
quel hébergeur de fichiers statiques.

## Structure

```
scripts/
  fetch_data.mjs        # télécharge les données brutes
  geocode_addresses.mjs # géocode les adresses des bureaux via l'API Adresse
  process_data.mjs      # agrège par commune + écrit le détail par bureau de vote
src/
  main.js             # carte Leaflet, choroplèthe, interactions
  pie.js              # camembert SVG (sans dépendance)
  nuances.js          # couleurs/labels par nuance politique
public/data/          # généré par process_data.mjs (non versionné)
```
