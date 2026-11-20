/**
 * L'abbonamento del ristorante — le regole pure (si provano senza rete).
 * Il lavoro sta in `licenza.ts`; la storia completa e' scritta li'.
 */

export type StatoLicenza = "attivo" | "avviso" | "sospeso";
export interface Licenza { stato: StatoLicenza; link: string }

/** La risposta dell'admin, ripulita: uno stato che non si conosce vale «attivo», un link non https non esiste. */
export function regolaLicenza(dati: unknown): Licenza {
  const d = (dati ?? {}) as { stato?: unknown; link?: unknown };
  const stato: StatoLicenza = d.stato === "avviso" || d.stato === "sospeso" ? d.stato : "attivo";
  let link = "";
  try {
    const u = new URL(String(d.link ?? ""));
    if (u.protocol === "https:") link = u.href;
  } catch {
    link = "";
  }
  return { stato, link };
}

/**
 * Le API pubbliche che si fermano da sospeso: quelle che prendono un ordine,
 * una prenotazione o aprono un tavolo. Solo in scrittura: il menu, gli orari
 * e gli slot si leggono come sempre.
 */
export const PUBBLICHE_FERMATE = new Set([
  "/api/checkout",
  "/api/reservation",
  "/api/table-session",
  "/api/table-tab",
  "/api/table-call",
]);

/** Mai fermati: un pagamento gia' fatto, i job, la scheda per MOODD. */
export function maiFermato(percorso: string): boolean {
  return percorso === "/api/stripe-webhook" || percorso.startsWith("/api/cron/") || percorso.startsWith("/api/restohub/");
}

/** Cosa fare di una richiesta da sospeso. */
export function decisioneSospeso(percorso: string, metodo: string): "passa" | "ordini" | "admin-pagina" | "admin-api" {
  if (maiFermato(percorso)) return "passa";
  if (PUBBLICHE_FERMATE.has(percorso) && metodo !== "GET" && metodo !== "HEAD") return "ordini";
  if (percorso.startsWith("/api/admin/")) return "admin-api";
  const p = percorso.replace(/\/$/, "");
  if ((p === "/admin" || p.startsWith("/admin/")) && p !== "/admin/login" && p !== "/admin/reset-password") return "admin-pagina";
  return "passa";
}

const TESTI = {
  fr: {
    ordini: "Les commandes et réservations en ligne sont momentanément indisponibles. Merci de contacter le restaurant.",
    titolo: "Accès suspendu",
    corpo: "L'accès à l'administration est suspendu. Pour le rétablir, contactez MOODD.",
    paga: "Régler maintenant",
    avviso: "Paiement en retard : l'accès sera bientôt suspendu.",
  },
  it: {
    ordini: "Gli ordini e le prenotazioni online sono momentaneamente non disponibili. Contattate il ristorante.",
    titolo: "Accesso sospeso",
    corpo: "L'accesso all'amministrazione è sospeso. Per riattivarlo, contattate MOODD.",
    paga: "Paga adesso",
    avviso: "Pagamento in ritardo: l'accesso verrà presto sospeso.",
  },
  en: {
    ordini: "Online orders and bookings are temporarily unavailable. Please contact the restaurant.",
    titolo: "Access suspended",
    corpo: "Access to the administration is suspended. To restore it, please contact MOODD.",
    paga: "Pay now",
    avviso: "Payment overdue: access will be suspended soon.",
  },
  nl: {
    ordini: "Online bestellingen en reservaties zijn tijdelijk niet beschikbaar. Neem contact op met het restaurant.",
    titolo: "Toegang opgeschort",
    corpo: "De toegang tot de administratie is opgeschort. Neem contact op met MOODD om ze te herstellen.",
    paga: "Nu betalen",
    avviso: "Betaling achterstallig: de toegang wordt binnenkort opgeschort.",
  },
  es: {
    ordini: "Los pedidos y reservas en línea no están disponibles por el momento. Contacte con el restaurante.",
    titolo: "Acceso suspendido",
    corpo: "El acceso a la administración está suspendido. Para restablecerlo, contacte con MOODD.",
    paga: "Pagar ahora",
    avviso: "Pago atrasado: el acceso se suspenderá pronto.",
  },
} as const;
export type LinguaLicenza = keyof typeof TESTI;

export function testiLicenza(lingua: string): (typeof TESTI)[LinguaLicenza] {
  const l = String(lingua ?? "").slice(0, 2).toLowerCase();
  return l in TESTI ? TESTI[l as LinguaLicenza] : TESTI.fr;
}

/** La lingua di una richiesta pubblica, da Accept-Language (fr se niente). */
export function linguaDaHeader(accept: string | null): string {
  const l = String(accept ?? "").slice(0, 2).toLowerCase();
  return l in TESTI ? l : "fr";
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** La pagina dell'admin sospeso: autonoma, senza script, senza risorse esterne. */
export function paginaSospesa(nome: string, lingua: string, link: string): string {
  const t = testiLicenza(lingua);
  const bottone = link
    ? `<a class="paga" href="${esc(link)}" target="_blank" rel="noopener noreferrer">${esc(t.paga)}</a>`
    : "";
  return `<!doctype html><html lang="${esc(lingua.slice(0, 2) || "fr")}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${esc(t.titolo)} — ${esc(nome)}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#112F34;color:#112F34;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;padding:20px}
  .box{background:#fff;border-radius:18px;padding:36px 32px;max-width:440px;text-align:center}
  h1{font-size:22px;margin:0 0 6px}
  .nome{color:#4E6569;font-size:14px;margin:0 0 18px}
  p{line-height:1.55;margin:0 0 22px}
  .paga{display:inline-block;background:#C25349;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:12px}
  .esci{display:block;margin-top:18px;color:#4E6569;font-size:13px}
</style></head><body><div class="box"><h1>${esc(t.titolo)}</h1><p class="nome">${esc(nome)}</p><p>${esc(t.corpo)}</p>${bottone}<a class="esci" href="/admin/login">← login</a></div></body></html>`;
}
