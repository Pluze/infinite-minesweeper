import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      crypto: "src/empty.ts",
    },
  },
});
