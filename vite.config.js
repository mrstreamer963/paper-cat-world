import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  // GitHub Pages publishes project sites below the repository name.
  // Keep the development server at / so local URLs stay convenient.
  base: command === "build" ? "/paper-cat-world/" : "/",
}));
