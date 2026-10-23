/**
 * LA LINGUA DEL CAMERIERE — un cookie del telefono, o la lingua dell'admin.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { readFileSync } from "node:fs";
import { linguaDalCookie, COOKIE_LINGUA_PALMARE } from "../src/lib/admin/linguaPalmareRegole.ts";

test("la lingua scelta dal cameriere si legge dal cookie", () => {
  assert.equal(linguaDalCookie(`${COOKIE_LINGUA_PALMARE}=en`), "en");
  assert.equal(linguaDalCookie(`mdd_at=xyz; ${COOKIE_LINGUA_PALMARE}=IT; altro=1`), "it");
  assert.equal(linguaDalCookie(`${COOKIE_LINGUA_PALMARE}=de`), null, "una lingua che l'admin non ha");
  assert.equal(linguaDalCookie(""), null);
  assert.equal(linguaDalCookie(null), null);
});

test("pagine e API del palmare parlano la lingua del cameriere", () => {
  for (const f of ["src/pages/admin/salle.astro", "src/pages/admin/salle/table.astro", "src/pages/admin/salle/order.astro"]) {
    assert.match(readFileSync(f, "utf8"), /const lang = await linguaPalmare\(Astro\.request\);/, f);
  }
  for (const f of ["src/pages/api/admin/salle-seat.ts", "src/pages/api/admin/salle-tab.ts", "src/pages/api/admin/salle-order.ts"]) {
    assert.match(readFileSync(f, "utf8"), /adminT\(await linguaPalmare\(request\)\)/, f);
  }
});
