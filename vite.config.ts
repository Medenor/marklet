import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  base: "./",
  // Port block 7880–7889 (x3 = frontend dev server). Set by `make dev` via VITE_PORT.
  server: { port: Number(process.env.VITE_PORT ?? 7883), strictPort: true },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    modulePreload: false,
    reportCompressedSize: true,
  },
});
