import type { APIRoute } from "astro";
import { cacheOr } from "../../../lib/cache";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, leggiConfig } from "../../../lib/admin/sede";
import { fusoDi } from "../../../lib/fuso";
import { DateTime } from "luxon";

import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";
export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

// Scheda Google del ristorante per la tile dell'Accueil (livello 1: lettura).
// Place ID per-cliente (app_config), chiave Places di MOODD (env).
// Cache 30 min: la nota cambia lentamente e le chiamate Google si pagano.

const KEY = import.meta.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

interface Avis {
  auteur: string;
  /** Foto del profilo di chi ha scritto. ⚠️ La colonna `photo` esisteva gia'
   *  nella tabella sincronizzata e nessuno la leggeva: un volto accanto a una
   *  recensione dice in mezzo secondo se e' un cliente abituale o un passante,
   *  e una riga di sole lettere non lo dira' mai. */
  foto?: string;
  note: number;
  texte: string;
  quand: string;
  id?: string;          // review_id (solo se via Business Profile): serve per rispondere
  reply?: boolean;      // true = ha già una risposta del ristorante
  quand_iso?: string;   // data ISO (Business Profile) da formattare lato client
}

// Places API (New) restituisce 5 recensioni scelte da Google come "pertinenti"
// e NON sa ordinarle per data. L'unico endpoint che lo sa fare è Places API
// (Legacy) con reviews_sort=newest. Lo proviamo per primo; se il progetto
// Cloud non ha la Legacy attiva torniamo alle recensioni della New API.
async function avisPlusRecents(placeId: string): Promise<Avis[] | null> {
  try {
    const u = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    u.searchParams.set("place_id", placeId);
    u.searchParams.set("fields", "reviews");
    u.searchParams.set("reviews_sort", "newest");
    u.searchParams.set("language", "fr");
    u.searchParams.set("key", String(KEY));
    const res = await fetch(u.toString());
    if (!res.ok) return null;
    const j = (await res.json()) as {
      status?: string;
      result?: {
        reviews?: {
          author_name?: string;
          rating?: number;
          text?: string;
          relative_time_description?: string;
          time?: number;
          profile_photo_url?: string;
        }[];
      };
    };
    const brut = j.status === "OK" ? j.result?.reviews ?? [] : [];
    if (!brut.length) return null;
    return brut
      .slice()
      .sort((a2, b2) => Number(b2.time ?? 0) - Number(a2.time ?? 0))
      .slice(0, 5)
      .map((r) => ({
        auteur: r.author_name ?? "",
        foto: r.profile_photo_url ?? "",
        note: Number(r.rating ?? 0),
        texte: (r.text ?? "").slice(0, 1500),
        quand: r.relative_time_description ?? "",
      }));
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  // Il Place ID identifica UN'ATTIVITA' FISICA: tre pizzerie, tre Place ID.
  // `leggiConfig` prende quello della sede e ripiega su quello
  // dell'installazione (sede unica: identico a prima).
  const ambitoPI = await ambitoDiRichiesta(request, staff);
  const cfgPI = await leggiConfig(ambitoPI, ["google_place_id"]);
  const placeId = (cfgPI.valori.get("google_place_id") ?? "").trim();
  if (!placeId || !KEY) return json({ configured: false });

  try {
    const info = await cacheOr(
      "google:place:" + placeId,
      async () => {
        const res = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=fr`, {
          headers: {
            "X-Goog-Api-Key": KEY,
            "X-Goog-FieldMask": "displayName,rating,userRatingCount,googleMapsUri,reviews",
          },
        });
        if (!res.ok) throw new Error("google " + res.status);
        const j = (await res.json()) as {
          displayName?: { text?: string };
          rating?: number;
          userRatingCount?: number;
          googleMapsUri?: string;
          reviews?: {
            rating?: number;
            text?: { text?: string };
            originalText?: { text?: string };
            authorAttribution?: { displayName?: string; photoUri?: string };
            relativePublishTimeDescription?: string;
            publishTime?: string;
          }[];
        };
        // 5 avis max de toute façon ; le niveau 2 (Business Profile API)
        // permettra de tous les récupérer, et d'y répondre.
        const secondi = (v?: string) => (v ? Date.parse(v) || 0 : 0);
        const avisNew: Avis[] = (j.reviews ?? [])
          .slice()
          .sort((a2, b2) => secondi(b2.publishTime) - secondi(a2.publishTime))
          .slice(0, 5)
          .map((r) => ({
            auteur: r.authorAttribution?.displayName ?? "",
            foto: r.authorAttribution?.photoUri ?? "",
            note: Number(r.rating ?? 0),
            texte: (r.text?.text ?? r.originalText?.text ?? "").slice(0, 1500),
            quand: r.relativePublishTimeDescription ?? "",
          }));
        const avis = (await avisPlusRecents(placeId)) ?? avisNew;
        return {
          name: j.displayName?.text ?? "",
          rating: j.rating ?? null,
          reviews: j.userRatingCount ?? 0,
          maps_url: j.googleMapsUri ?? "",
          // L'elenco delle recensioni, non la scheda. ⚠️ L'indirizzo si
          // costruisce QUI: il Place ID e' una cosa del server (sta in
          // `app_config`, puo' cambiare per sede) e mandarlo al browser perche'
          // si cucini l'URL da solo vorrebbe dire che il giorno in cui Google
          // cambia questa pagina bisogna ricordarsi di guardare anche dentro
          // uno script dell'Accueil.
          reviews_url: `https://search.google.com/local/reviews?placeid=${encodeURIComponent(placeId)}`,
          avis,
        };
      },
      30 * 60_000
    );
    // Se il Business Profile è collegato, le recensioni sincronizzate (tabella
    // google_reviews) hanno l'id e lo stato "risposta" → le usiamo per la tile
    // così da poter mostrare il bottone «Rispondi». Lettura fresca (no cache):
    // dopo una risposta il bottone deve sparire subito. Fallback = avis Places.
    let avisOut = info.avis;
    // ⚠️ `undefined` e NON `0`: «nessuna recensione questo mese» e «non lo
    // sappiamo» sono due cose diverse. Senza il Business Profile collegato
    // Google da' cinque recensioni in tutto, e contarle direbbe «+2» a una
    // scheda che ne ha prese venti. Il numero esce solo se si puo' contare.
    let mois: number | undefined;
    try {
      // Le recensioni della tile sono quelle del PUNTO che si sta guardando.
      const ambitoG = await ambitoDiRichiesta(request, staff);
      const { data: gr } = await leggi("google_reviews", ambitoG,
        "review_id, author, photo, rating, comment, reply_comment, create_time")
        .order("create_time", { ascending: false })
        .limit(8);
      if (gr && gr.length) {
        // ⚠️ Il mese comincia nel fuso del LOCALE, non in quello del server:
        // una recensione lasciata alle 00:30 del primo a Bruxelles e' di
        // questo mese, e in UTC sarebbe ancora del precedente.
        const inizio = DateTime.now().setZone(await fusoDi(ambitoG)).startOf("month").toISO();
        // `head` + `count`: si chiede QUANTE, non quali. Portarsi in memoria
        // mille recensioni per contarle sarebbe la stessa risposta pagata a
        // peso.
        const { count } = await leggi("google_reviews", ambitoG, "review_id", { count: "exact", head: true })
          .gte("create_time", inizio ?? "");
        mois = Number(count ?? 0);
        const conTesto = gr.filter((r) => String(r.comment ?? "").trim());
        if (conTesto.length) {
          avisOut = conTesto.map((r) => ({
            auteur: String(r.author ?? ""),
            foto: String(r.photo ?? ""),
            note: Number(r.rating ?? 0),
            texte: String(r.comment ?? "").slice(0, 1500),
            quand: "",
            quand_iso: r.create_time ? String(r.create_time) : undefined,
            id: String(r.review_id),
            reply: !!r.reply_comment,
          }));
        }
      }
    } catch { /* tabella assente/non collegato: restano le recensioni Places */ }
    return json({ configured: true, ...info, avis: avisOut, mois });
  } catch {
    return json({ configured: true, error: await msg("err.googleDown") }, 200);
  }
};
