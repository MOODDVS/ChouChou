import type { APIRoute } from "astro";
import { CLIENT } from "../../config/client";
import crypto from "node:crypto";
import { supabaseAdmin } from "../../lib/db";
import { esc } from "../../lib/esc";
import { segretoUguale } from "../../lib/cronAuth";

export const prerender = false;

// /api/newsletter-unsubscribe?e=<email>&t=<token> — il link di ogni newsletter.
// Il token HMAC impedisce di disiscrivere indirizzi altrui a caso.
//
// ⚠️ AUDIT 3/11/2026: il GET NON disiscrive piu'. Gli antivirus delle caselle
// (Outlook, i filtri aziendali) aprono da soli ogni link di un'email per
// controllarlo: con la disiscrizione sul GET, una newsletter arrivata in un
// ufficio cancellava il cliente senza che lui avesse toccato niente.
//   - GET  → la pagina con il bottone «Confirmer» (un modulo POST);
//   - POST → disiscrive. E' anche il «one-click» dei programmi di posta
//            (RFC 8058, intestazione List-Unsubscribe-Post nella newsletter).

const SECRET = import.meta.env.SUPABASE_SERVICE_KEY ?? "lm-newsletter";

function token(email: string): string {
  return crypto.createHmac("sha256", SECRET).update(email.toLowerCase()).digest("hex").slice(0, 24);
}

/** Il token e' quello giusto? Confronto a tempo costante. */
function valido(email: string, t: string): boolean {
  return !!email && !!t && segretoUguale(t, token(email));
}

function pagina(titolo: string, testo: string, modulo = ""): Response {
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${titolo} — ${CLIENT.nome}</title>
  <!-- ⚠️ Niente Google Fonts qui, e non e' solo velocita'. Questa pagina la
       apre chi si CANCELLA da una newsletter: mandare il suo IP a Google nel
       momento esatto in cui chiede di non essere piu' tracciato sarebbe il
       posto peggiore per farlo. E' una pagina di due righe: i caratteri di
       sistema bastano, e arrivano senza nessuna richiesta di rete.
       Le altre pagine usano i font serviti dal dominio (vedi Fonts.astro),
       ma questa e' una stringa HTML in un'API e non puo' usare quel
       componente. -->
  <style>
    body { margin: 0; background: #231f20; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 1.5rem; }
    .box { max-width: 460px; }
    .claim { font-family: Georgia, "Times New Roman", serif; letter-spacing: 0.3em; text-transform: uppercase; font-size: 0.7rem; color: #dfab4e; margin: 0 0 1rem; }
    h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400; font-size: 1.8rem; margin: 0 0 0.8rem; }
    p { color: #b3aca6; line-height: 1.7; margin: 0 0 1.8rem; }
    a { display: inline-block; font-family: Georgia, "Times New Roman", serif; font-size: 0.85rem; font-weight: 700;
      letter-spacing: 0.16em; text-transform: uppercase; color: #fff; text-decoration: none;
      border: 2px solid rgba(255,255,255,0.9); padding: 12px 30px; transition: background .2s, color .2s; }
    a:hover, button:hover { background: #fff; color: #231f20; }
    button { font-family: Georgia, "Times New Roman", serif; font-size: 0.85rem; font-weight: 700; letter-spacing: 0.16em;
      text-transform: uppercase; color: #fff; background: transparent; border: 2px solid rgba(255,255,255,0.9);
      padding: 12px 30px; cursor: pointer; transition: background .2s, color .2s; }
  </style>
</head>
<body>
  <div class="box">
    <p class="claim">${CLIENT.nome} — ${CLIENT.claim}</p>
    <h1>${titolo}</h1>
    <p>${testo}</p>
    ${modulo || `<a href="/">Retour à l'accueil</a>`}
  </div>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const INVALIDO = (): Response => pagina("Lien invalide", "Ce lien de désinscription n'est pas valide ou a expiré.");

/** GET: chiede la conferma, non disiscrive (vedi sopra). */
export const GET: APIRoute = async ({ url }) => {
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const t = url.searchParams.get("t") ?? "";
  if (!valido(email, t)) return INVALIDO();
  const modulo = `<form method="post" action="/api/newsletter-unsubscribe">
      <input type="hidden" name="e" value="${esc(email)}" />
      <input type="hidden" name="t" value="${esc(t)}" />
      <button type="submit">Confirmer</button>
    </form>`;
  return pagina(
    "Se désinscrire ?",
    `L'adresse ${esc(email)} ne recevra plus notre newsletter.`,
    modulo,
  );
};

/** POST: il bottone della pagina, o il «one-click» del programma di posta. */
export const POST: APIRoute = async ({ url, request }) => {
  let email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  let t = url.searchParams.get("t") ?? "";
  try {
    const f = await request.formData();
    email = String(f.get("e") ?? email).trim().toLowerCase();
    t = String(f.get("t") ?? t);
  } catch { /* one-click senza modulo: valgono i parametri dell'indirizzo */ }
  if (!valido(email, t)) return INVALIDO();

  try {
    const { error } = await supabaseAdmin
      .from("newsletter_optout")
      .upsert({ email }, { onConflict: "email" });
    if (error) throw error;
  } catch {
    return pagina("Oups", "Une erreur est survenue. Réessayez dans un instant.");
  }

  return pagina(
    "Vous êtes désinscrit",
    `L'adresse ${esc(email)} ne recevra plus notre newsletter. À bientôt au restaurant !`
  );
};
