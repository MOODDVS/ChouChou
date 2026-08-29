// Dati strutturati Schema.org "Restaurant" (SEO locale) costruiti dai dati
// LIVE dell'admin: nome/telefono/email/indirizzo (Réglages → Général), orari
// (settings) e social. Cache 5 min. Read-only, non tocca il motore.
import { supabaseAdmin } from "./db";
import { datiRistorante } from "./ristorante";
import { linksSocial } from "./links";
import { cacheOr } from "./cache";

// index = day_of_week nel DB (0 = dimanche)
const SCHEMA_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function hhmm(t: unknown): string {
  return t ? String(t).slice(0, 5) : "";
}

async function orariSpec(): Promise<Array<Record<string, string>>> {
  try {
    const { data } = await supabaseAdmin
      .from("settings")
      .select("day_of_week, lunch_active, lunch_open, lunch_close, dinner_active, dinner_open, dinner_close");
    if (!data) return [];
    const specs: Array<Record<string, string>> = [];
    for (const r of data as any[]) {
      const day = SCHEMA_DAYS[Number(r.day_of_week)];
      if (!day) continue;
      if (r.lunch_active && r.lunch_open && r.lunch_close) {
        specs.push({ "@type": "OpeningHoursSpecification", dayOfWeek: day, opens: hhmm(r.lunch_open), closes: hhmm(r.lunch_close) });
      }
      if (r.dinner_active && r.dinner_open && r.dinner_close) {
        specs.push({ "@type": "OpeningHoursSpecification", dayOfWeek: day, opens: hhmm(r.dinner_open), closes: hhmm(r.dinner_close) });
      }
    }
    return specs;
  } catch {
    return [];
  }
}

function parseIndirizzo(indirizzo: string): { street: string; postalCode: string; locality: string } {
  const idx = indirizzo.indexOf(",");
  const street = (idx >= 0 ? indirizzo.slice(0, idx) : indirizzo).trim();
  const rest = idx >= 0 ? indirizzo.slice(idx + 1).trim() : "";
  const m = rest.match(/^(\d{4,6})\s+(.+)$/);
  return { street, postalCode: m ? m[1] : "", locality: m ? m[2] : rest };
}

/** JSON-LD "Restaurant" (stringa pronta per <script type="application/ld+json">). */
export async function restaurantJsonLd(siteUrl: string, lang: string): Promise<string> {
  return cacheOr(
    "seo:jsonld:" + lang,
    async () => {
      const base = siteUrl.replace(/\/$/, "");
      const dati = await datiRistorante();
      const social = await linksSocial();
      const hours = await orariSpec();
      const a = parseIndirizzo(dati.indirizzo);
      const en = lang === "en";

      const jsonld: Record<string, unknown> = {
        "@context": "https://schema.org",
        "@type": "Restaurant",
        "@id": base + "/#restaurant",
        name: dati.nome,
        url: base + (en ? "/en" : "/"),
        image: base + "/slideshow/slide-01.webp",
        telephone: dati.tel,
        email: dati.email,
        priceRange: "€€",
        servesCuisine: en ? ["French", "Contemporary", "Homemade"] : ["Française", "Créative", "Fait maison"],
        acceptsReservations: true,
        hasMenu: base + (en ? "/en/menu" : "/menu"),
        address: {
          "@type": "PostalAddress",
          streetAddress: a.street,
          postalCode: a.postalCode,
          addressLocality: a.locality,
          addressRegion: en ? "Walloon Brabant" : "Brabant wallon",
          addressCountry: "BE",
        },
        areaServed: a.locality || (en ? "Walloon Brabant" : "Brabant wallon"),
      };
      if (hours.length) jsonld.openingHoursSpecification = hours;
      if (social.length) jsonld.sameAs = social.map((s) => s.url);

      return JSON.stringify(jsonld);
    },
    300_000
  );
}
