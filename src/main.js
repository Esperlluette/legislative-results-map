import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./style.css";
import { nuanceColor, nuanceLabel } from "./nuances.js";
import { renderPie, renderLegend } from "./pie.js";

const state = {
  election: "legislatives",
  tour: "tour2",
  geojsonLayer: null,
  featuresByCode: new Map(),
  bureauxCache: new Map(),
  hintDismissed: false,
};

const sidebarState = {
  code: null,
  nom: null,
  detail: null, // { legislatives: {tour1,tour2}, presidentielle: {tour1,tour2} } tel que renvoyé par bureaux/<code>.json
  bureaux: [],
  riskyBureaux: new Map(), // bureau -> inscrits dans l'autre élection, si numérotation suspecte
  filterText: "",
  sort: "numero",
  selectedIdx: null,
};

let selectionMarker = null;

const FRANCE_BOUNDS = [
  [41.2, -5.3],
  [51.2, 9.7],
];

const map = L.map("map", { preferCanvas: true }).setView([46.6, 2.3], 6);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
  attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  maxZoom: 19,
}).addTo(map);

function styleForFeature(feature) {
  const data = feature.properties[state.election]?.[state.tour];
  const color = data ? nuanceColor(data.leadingNuance) : "#dddddd";
  return {
    fillColor: color,
    color: "#555",
    weight: 0.3,
    fillOpacity: data ? 0.75 : 0.3,
  };
}

async function loadBureaux(code) {
  if (state.bureauxCache.has(code)) return state.bureauxCache.get(code);
  const res = await fetch(`${import.meta.env.BASE_URL}data/bureaux/${code}.json`);
  if (!res.ok) {
    state.bureauxCache.set(code, null);
    return null;
  }
  const data = await res.json();
  state.bureauxCache.set(code, data);
  return data;
}

function renderAggregateHtml(props) {
  const data = props[state.election]?.[state.tour];
  if (!data) {
    return `<div class="commune-popup"><h3>${props.nom}</h3><p>Pas de résultat disponible pour ce tour.</p></div>`;
  }
  return `
    <div class="commune-popup">
      <div class="meta">Vue d'ensemble — Participation : ${data.participation}% (${data.votants.toLocaleString("fr-FR")} / ${data.inscrits.toLocaleString("fr-FR")} inscrits)</div>
      <div class="pie-wrap">
        <div class="pie">${renderPie(data.results)}</div>
        <div class="pie-legend">${renderLegend(data.results)}</div>
      </div>
    </div>`;
}

function renderBureauPie(bv) {
  const location = bv.adresse
    ? `<div class="bureau-location">📍 ${bv.libelle ? bv.libelle + " — " : ""}${bv.adresse}</div>`
    : `<div class="bureau-location muted">Adresse non disponible pour ce bureau.</div>`;
  return `
    ${location}
    <div class="pie-wrap">
      <div class="pie">${renderPie(bv.results)}</div>
      <div class="pie-legend">${renderLegend(bv.results)}</div>
    </div>
    <div class="meta">Participation : ${bv.participation}% (${bv.votants.toLocaleString("fr-FR")} / ${bv.inscrits.toLocaleString("fr-FR")} inscrits)</div>`;
}

function abstentionPct(bv) {
  return bv.inscrits > 0 ? (bv.abstentions / bv.inscrits) * 100 : 0;
}

function compareBureaux(a, b, sort) {
  switch (sort) {
    case "abstention_desc":
      return abstentionPct(b) - abstentionPct(a);
    case "abstention_asc":
      return abstentionPct(a) - abstentionPct(b);
    case "participation_desc":
      return b.participation - a.participation;
    case "participation_asc":
      return a.participation - b.participation;
    case "inscrits_desc":
      return b.inscrits - a.inscrits;
    case "numero":
    default:
      return a.bureau.localeCompare(b.bureau, "fr", { numeric: true });
  }
}

function sidebarStatLabel(bv) {
  switch (sidebarState.sort) {
    case "participation_desc":
    case "participation_asc":
      return `${bv.participation}% part.`;
    case "inscrits_desc":
      return `${bv.inscrits.toLocaleString("fr-FR")} insc.`;
    default:
      return `${abstentionPct(bv).toFixed(1)}% abst.`;
  }
}

const ELECTION_KEYS = ["legislatives", "presidentielle"];
function otherElectionKey(key) {
  return ELECTION_KEYS.find((k) => k !== key);
}

// La numérotation des bureaux de vote n'est pas garantie stable d'une élection à
// l'autre (redécoupages) : le même numéro peut désigner un lieu différent. On le
// détecte en comparant le nombre d'inscrits du même numéro de bureau dans l'autre
// élection disponible — un écart important (x2) est un signal fiable de bureau
// différent, sans avoir besoin de connaître les vraies géométries.
function computeRiskyBureaux(bureaux) {
  const risky = new Map(); // bureau -> inscrits de l'autre élection
  const otherKey = otherElectionKey(state.election);
  const otherElection = sidebarState.detail?.[otherKey];
  if (!otherElection) return risky;

  const otherBureaux = otherElection.tour2 || otherElection.tour1;
  if (!otherBureaux) return risky;
  const otherByNumero = new Map(otherBureaux.map((bv) => [bv.bureau, bv]));

  for (const bv of bureaux) {
    const other = otherByNumero.get(bv.bureau);
    if (!other || bv.inscrits === 0 || other.inscrits === 0) continue;
    const ratio = bv.inscrits / other.inscrits;
    if (ratio > 2 || ratio < 0.5) risky.set(bv.bureau, other.inscrits);
  }
  return risky;
}

function sidebarRowHtml(bv, idx) {
  const top = bv.results[0];
  const color = top ? nuanceColor(top.nuance) : "#ccc";
  const selected = sidebarState.selectedIdx === idx ? " selected" : "";
  const otherInscrits = sidebarState.riskyBureaux.get(bv.bureau);
  const warning = otherInscrits
    ? `<span class="row-warn" title="Ce numéro de bureau a ${bv.inscrits.toLocaleString("fr-FR")} inscrits ici contre ${otherInscrits.toLocaleString("fr-FR")} pour la même numérotation dans l'autre élection — probablement un découpage différent, pas le même lieu.">⚠️</span>`
    : "";
  return `
    <li class="bureau-row${selected}" data-idx="${idx}">
      <span class="row-dot" style="background:${color}"></span>
      <div class="row-text">
        <div class="row-title">N°${bv.bureau}${bv.libelle ? " — " + bv.libelle : ""} ${warning}</div>
        <div class="row-sub">${bv.adresse || "Adresse inconnue"}</div>
      </div>
      <div class="row-stat">${sidebarStatLabel(bv)}</div>
    </li>`;
}

function renderSidebarList() {
  const listEl = document.getElementById("sidebar-list");
  const countEl = document.getElementById("sidebar-count");
  const bureaux = sidebarState.bureaux;

  if (!bureaux.length) {
    listEl.innerHTML = "";
    countEl.textContent =
      state.tour === "tour2"
        ? "Pas de second tour ici (candidat élu dès le 1er tour, ou aucun bureau détaillé)."
        : "Aucun bureau de vote trouvé pour cette élection.";
    document.getElementById("sidebar-warning").classList.add("hidden");
    return;
  }

  const q = sidebarState.filterText.trim().toLowerCase();
  let rows = bureaux.map((bv, idx) => ({ bv, idx }));
  if (q) {
    rows = rows.filter(({ bv }) => `${bv.bureau} ${bv.libelle || ""} ${bv.adresse || ""}`.toLowerCase().includes(q));
  }
  rows.sort((a, b) => compareBureaux(a.bv, b.bv, sidebarState.sort));

  countEl.textContent = `${rows.length} bureau${rows.length > 1 ? "x" : ""} de vote${q ? " (filtré)" : ""}`;
  listEl.innerHTML = rows.map(({ bv, idx }) => sidebarRowHtml(bv, idx)).join("");

  listEl.querySelectorAll(".bureau-row").forEach((el) => {
    el.addEventListener("click", () => selectBureau(+el.dataset.idx));
  });

  renderSidebarWarning();
}

function renderSidebarWarning() {
  const warnEl = document.getElementById("sidebar-warning");
  const n = sidebarState.riskyBureaux.size;
  if (n === 0) {
    warnEl.classList.add("hidden");
    warnEl.innerHTML = "";
    return;
  }
  warnEl.classList.remove("hidden");
  warnEl.innerHTML = `⚠️ ${n} bureau${n > 1 ? "x" : ""} marqué${n > 1 ? "s" : ""} ⚠️ : le nombre d'inscrits sous ce numéro diffère fortement entre les deux élections — la numérotation des bureaux a probablement changé, ne pas supposer qu'il s'agit du même lieu.`;
}

function clearMarker() {
  if (selectionMarker) {
    map.removeLayer(selectionMarker);
    selectionMarker = null;
  }
}

function placeMarker(bv) {
  clearMarker();
  if (bv.lat == null || bv.lon == null) return;
  selectionMarker = L.circleMarker([bv.lat, bv.lon], {
    radius: 9,
    weight: 3,
    color: "#fff",
    fillColor: "#1a1a2e",
    fillOpacity: 1,
  }).addTo(map);
  selectionMarker.bindTooltip(`Bureau ${bv.bureau}${bv.libelle ? " — " + bv.libelle : ""}`, {
    direction: "top",
    className: "commune-tooltip",
  });
  const targetZoom = Math.max(map.getZoom(), 16);
  map.flyTo([bv.lat, bv.lon], targetZoom, { duration: 0.6 });
}

function showBureauDetail(bv) {
  const panel = document.getElementById("sidebar-selection");
  if (!bv) {
    panel.innerHTML = "";
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="commune-popup">
      <div class="selection-header">
        <strong>Bureau ${bv.bureau}</strong>
        <button type="button" class="selection-close" id="selection-close">✕</button>
      </div>
      ${renderBureauPie(bv)}
    </div>`;
  document.getElementById("selection-close").addEventListener("click", () => {
    sidebarState.selectedIdx = null;
    clearMarker();
    showBureauDetail(null);
    renderSidebarList();
  });
}

function selectBureau(idx) {
  sidebarState.selectedIdx = idx;
  const bv = sidebarState.bureaux[idx];
  renderSidebarList();
  showBureauDetail(bv);
  placeMarker(bv);
}

async function refreshSidebarBureaux() {
  const bureaux = sidebarState.detail?.[state.election]?.[state.tour];
  sidebarState.bureaux = bureaux || [];
  sidebarState.riskyBureaux = computeRiskyBureaux(sidebarState.bureaux);
  renderSidebarList();
}

async function openSidebarForCommune(props) {
  dismissHint();
  sidebarState.code = props.code;
  sidebarState.nom = props.nom;
  sidebarState.selectedIdx = null;
  sidebarState.filterText = "";
  document.getElementById("sidebar-filter").value = "";
  clearMarker();
  showBureauDetail(null);

  document.getElementById("sidebar").classList.remove("hidden");
  document.getElementById("sidebar-title").textContent = props.nom;
  document.getElementById("sidebar-aggregate").innerHTML = renderAggregateHtml(props);
  document.getElementById("sidebar-list").innerHTML = `<li class="sidebar-loading">Chargement des bureaux de vote…</li>`;
  document.getElementById("sidebar-count").textContent = "";
  document.getElementById("sidebar-warning").classList.add("hidden");

  const detail = await loadBureaux(props.code);
  if (sidebarState.code !== props.code) return; // une autre commune a été ouverte entre-temps
  sidebarState.detail = detail;
  await refreshSidebarBureaux();
}

function closeSidebar() {
  document.getElementById("sidebar").classList.add("hidden");
  sidebarState.code = null;
  clearMarker();
}

function tooltipHtml(feature) {
  const data = feature.properties[state.election]?.[state.tour];
  const top = data?.results?.[0];
  if (!top) return `<strong>${feature.properties.nom}</strong><br>Pas de résultat`;
  const total = data.results.reduce((s, r) => s + r.voix, 0);
  const pct = total > 0 ? ((top.voix / total) * 100).toFixed(1) : "0.0";
  return `<strong>${feature.properties.nom}</strong><br>${nuanceLabel(top.nuance)} — ${pct}%`;
}

function dismissHint() {
  if (state.hintDismissed) return;
  state.hintDismissed = true;
  document.getElementById("hint")?.classList.add("hidden");
}

function onEachFeature(feature, layer) {
  state.featuresByCode.set(feature.properties.code, { feature, layer });

  layer.bindTooltip(() => tooltipHtml(feature), {
    sticky: true,
    direction: "top",
    className: "commune-tooltip",
  });

  layer.on("mouseover", () => {
    layer.setStyle({ weight: 2, color: "#111" });
    layer.bringToFront();
  });
  layer.on("mouseout", () => {
    state.geojsonLayer.resetStyle(layer);
  });

  layer.on("click", () => {
    openSidebarForCommune(feature.properties);
  });
}

async function init() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/communes.geojson`);
  const geojson = await res.json();

  state.geojsonLayer = L.geoJSON(geojson, {
    style: styleForFeature,
    onEachFeature,
  }).addTo(map);

  setupElectionControl();
  setupTourControl();
  setupSearch(geojson.features);
  setupLegend();
  setupResetView();
  setupSidebar();

  document.getElementById("loading")?.classList.add("hidden");
  setTimeout(() => {
    if (!state.hintDismissed) document.getElementById("hint")?.classList.add("hidden");
  }, 6000);
}

function setupSidebar() {
  document.getElementById("sidebar-close").addEventListener("click", closeSidebar);
  document.getElementById("sidebar-filter").addEventListener("input", (e) => {
    sidebarState.filterText = e.target.value;
    renderSidebarList();
  });
  document.getElementById("sidebar-sort").addEventListener("change", (e) => {
    sidebarState.sort = e.target.value;
    renderSidebarList();
  });
}

function setupResetView() {
  document.getElementById("reset-view").addEventListener("click", () => {
    map.fitBounds(FRANCE_BOUNDS);
    closeSidebar();
  });
}

function refreshAfterSelectionChange() {
  state.geojsonLayer.setStyle(styleForFeature);

  if (sidebarState.code) {
    sidebarState.selectedIdx = null;
    clearMarker();
    showBureauDetail(null);
    const entry = state.featuresByCode.get(sidebarState.code);
    if (entry) document.getElementById("sidebar-aggregate").innerHTML = renderAggregateHtml(entry.feature.properties);
    refreshSidebarBureaux();
  }
}

function setupTourControl() {
  const select = document.getElementById("tour-select");
  select.value = state.tour;
  select.addEventListener("change", () => {
    state.tour = select.value;
    refreshAfterSelectionChange();
  });
}

function setupElectionControl() {
  const select = document.getElementById("election-select");
  select.value = state.election;
  select.addEventListener("change", () => {
    state.election = select.value;
    refreshAfterSelectionChange();
  });
}

function deptFromCode(code) {
  if (code.startsWith("97") || code.startsWith("98")) return code.slice(0, 3);
  return code.slice(0, 2);
}

// Classe les résultats : correspondance exacte d'abord, puis "commence par",
// puis "contient" — sinon "Arras" se retrouvait noyé après "Barras", "Sarras"...
function rankMatch(nomLower, q) {
  if (nomLower === q) return 0;
  if (nomLower.startsWith(q)) return 1;
  return 2;
}

function setupSearch(features) {
  const input = document.getElementById("search-input");
  const resultsEl = document.getElementById("search-results");

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    resultsEl.innerHTML = "";
    if (q.length < 2) return;

    const matches = features
      .filter((f) => f.properties.nom.toLowerCase().includes(q))
      .sort((a, b) => {
        const nomA = a.properties.nom.toLowerCase();
        const nomB = b.properties.nom.toLowerCase();
        const rankDiff = rankMatch(nomA, q) - rankMatch(nomB, q);
        if (rankDiff !== 0) return rankDiff;
        return nomA.localeCompare(nomB, "fr");
      })
      .slice(0, 8);

    for (const f of matches) {
      const div = document.createElement("div");
      div.textContent = `${f.properties.nom} (${deptFromCode(f.properties.code)})`;
      div.addEventListener("click", () => {
        const entry = state.featuresByCode.get(f.properties.code);
        if (!entry) return;
        const bounds = entry.layer.getBounds();
        map.fitBounds(bounds, { maxZoom: 14 });
        entry.layer.fire("click");
        resultsEl.innerHTML = "";
        input.value = f.properties.nom;
      });
      resultsEl.appendChild(div);
    }
  });
}

function setupLegend() {
  const legendCodes = ["EXG", "UG", "SOC", "VEC", "ENS", "UDI", "LR", "REC", "RN", "DIV"];
  const el = document.getElementById("legend");
  // Repliée par défaut sur mobile pour ne pas manger la carte, dépliée sur desktop.
  const openByDefault = window.matchMedia("(min-width: 641px)").matches;
  el.innerHTML = `
    <details class="legend-details"${openByDefault ? " open" : ""}>
      <summary>Nuance en tête</summary>
      <div class="legend-body">
        ${legendCodes
          .map(
            (n) =>
              `<div class="legend-row"><span class="legend-swatch" style="background:${nuanceColor(n)}"></span>${nuanceLabel(n)}</div>`
          )
          .join("")}
        <div class="legend-hint">Touchez une commune pour ouvrir la liste des bureaux, triable par abstention, participation…</div>
      </div>
    </details>`;
}

init();
