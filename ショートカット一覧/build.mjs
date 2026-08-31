import { cpSync, mkdirSync, copyFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
copyFileSync("index.html", "dist/index.html");
copyFileSync("manifest.webmanifest", "dist/manifest.webmanifest");
copyFileSync("app-icon-192.png", "dist/app-icon-192.png");
copyFileSync("app-icon-512.png", "dist/app-icon-512.png");
copyFileSync("pwa-install.js", "dist/pwa-install.js");
cpSync("assets", "dist/assets", { recursive: true });
