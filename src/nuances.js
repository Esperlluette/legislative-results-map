// Palette de couleurs par nuance politique officielle (Ministère de l'Intérieur,
// législatives 2024). Convention presse habituelle : dégradé gauche -> droite,
// couleur grise de repli pour toute nuance non reconnue.

export const NUANCE_COLORS = {
  EXG: "#8b0000", // Extrême gauche
  FI: "#d2001c", // La France insoumise
  COM: "#dd0000", // Parti communiste
  UG: "#e4392d", // Union de la gauche (NFP)
  SOC: "#ff8080", // Parti socialiste
  RDG: "#ff9999", // Radical de gauche
  DVG: "#f4a6a6", // Divers gauche
  VEC: "#00c000", // Écologiste
  REG: "#ffb400", // Régionaliste
  DIV: "#a9a9a9", // Divers
  DSV: "#a9a9a9", // Divers (variante)
  DVC: "#cbb677", // Divers centre
  ENS: "#ffcc00", // Ensemble (majorité présidentielle)
  MDM: "#f2d600", // Mouvement démocrate
  UDI: "#6699ff", // UDI
  HOR: "#00b0d6", // Horizons
  LR: "#0066cc", // Les Républicains
  DVD: "#7ea0d0", // Divers droite
  REC: "#5a2ca0", // Reconquête
  UXD: "#5b2f8c", // Union extrême droite
  RN: "#0d2c54", // Rassemblement National
  EXD: "#1a1a1a", // Extrême droite
};

export const NUANCE_LABELS = {
  EXG: "Extrême gauche",
  FI: "La France insoumise",
  COM: "Parti communiste",
  UG: "Union de la gauche (NFP)",
  SOC: "Parti socialiste",
  RDG: "Radical de gauche",
  DVG: "Divers gauche",
  VEC: "Écologiste",
  REG: "Régionaliste",
  DIV: "Divers",
  DSV: "Divers",
  DVC: "Divers centre",
  ENS: "Ensemble",
  MDM: "Mouvement démocrate",
  UDI: "UDI",
  HOR: "Horizons",
  LR: "Les Républicains",
  DVD: "Divers droite",
  REC: "Reconquête",
  UXD: "Union extrême droite",
  RN: "Rassemblement National",
  EXD: "Extrême droite",
};

const FALLBACK_COLOR = "#999999";

export function nuanceColor(nuance) {
  return NUANCE_COLORS[nuance] || FALLBACK_COLOR;
}

export function nuanceLabel(nuance) {
  return NUANCE_LABELS[nuance] || nuance || "Inconnu";
}
