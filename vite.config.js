import { defineConfig } from "vite";

// Chemins relatifs : le site fonctionne aussi bien servi à la racine d'un domaine
// que sous un sous-chemin (ex. GitHub Pages : https://<user>.github.io/<repo>/).
export default defineConfig({
  base: "./",
});
