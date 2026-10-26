/**
 * LE MISURE DELLE IMMAGINI DEL SITO (27/10/2026).
 *
 * L'admin salva base e altezza accanto all'immagine (`site_hero_1__wh`), e
 * il sito pubblico non deve piu' scaricare ogni foto per sapere che forma ha.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { chiaveMisure, leggiMisure, scriviMisure, separaSiteImages } from "../src/lib/siteImagesRegole.ts";

test("la chiave delle misure e il formato «LxA»", () => {
  assert.equal(chiaveMisure("site_hero_1"), "site_hero_1__wh");
  assert.deepEqual(leggiMisure("1200x800"), { w: 1200, h: 800 });
  assert.deepEqual(leggiMisure(" 800x1200 "), { w: 800, h: 1200 });
  for (const v of ["", "1200", "0x800", "1200x0", "12x", "x8", "1200×800", "-1x5", "99999x1", "https://x/y.jpg", null, undefined]) {
    assert.equal(leggiMisure(v), null, String(v));
  }
  assert.equal(scriviMisure(1200, 800), "1200x800");
  assert.equal(scriviMisure(0, 800), null);
  assert.equal(scriviMisure(NaN, 800), null);
});

test("siteImages resta di soli indirizzi: le misure escono a parte", () => {
  const { urls, misure } = separaSiteImages([
    { key: "site_hero_1", value: "https://x.supabase.co/a.webp" },
    { key: "site_hero_1__wh", value: "1200x800" },
    { key: "site_gallery_1", value: "https://x.supabase.co/b.webp" },
    { key: "site_gallery_1__wh", value: "rotto" },
    { key: "site_gallery_2", value: "" },
    { key: "site_gallery_2__wh", value: "500x500" }, // orfana: niente immagine
  ]);
  assert.deepEqual(urls, { site_hero_1: "https://x.supabase.co/a.webp", site_gallery_1: "https://x.supabase.co/b.webp" });
  assert.ok(!Object.values(urls).some((u) => /^\d+x\d+$/.test(u)), "una misura e' finita tra gli indirizzi");
  assert.deepEqual(misure, { site_hero_1: { w: 1200, h: 800 } });
});

test("l'API salva le misure con l'immagine e le toglie quando cambia o si ripristina", () => {
  const A = readFileSync("src/pages/api/admin/site-images.ts", "utf8");
  // Senza misure valide si CANCELLANO: la foto nuova non eredita la forma della vecchia.
  assert.match(A, /\.delete\(\)\.eq\("key", k\)/);
  assert.match(A, /const m = url \? leggiMisure\(body\.wh\) : null;/);
  assert.match(A, /await salvaMisure\(key, wh\);/);
  // La rimisura delle foto vecchie si attacca solo se l'immagine e' ancora quella.
  assert.match(A, /if \(String\(\(ora as[^)]*\)\?\.value \?\? ""\)\.trim\(\) !== url\) return json\(\{ ok: true, saltato: true \}\);/);
});

test("l'admin misura al momento della scelta e rimisura chi non ha misure", () => {
  const P = readFileSync("src/pages/admin/assets.astro", "utf8");
  assert.match(P, /function misuraImmagine\(url: string\)/);
  assert.match(P, /const wh = url \? await misuraImmagine\(url\) : null;/);
  assert.match(P, /solo_misure: true/);
  const L = readFileSync("src/lib/siteImages.ts", "utf8");
  assert.match(L, /return \(await leggiTutto\(\)\)\.urls;/);
  assert.match(L, /export async function siteImageMisure\(\)/);
  assert.match(L, /export async function siteFoto\(key: string\)/);
});
