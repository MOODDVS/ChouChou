import type { APIRoute } from "astro";
import { CLIENT } from "../../config/client";
import crypto from "node:crypto";
import { supabaseAdmin } from "../../lib/db";

export const prerender = false;

// GET /api/newsletter-unsubscribe?e=<email>&t=<token>
// Link presente in ogni newsletter: aggiunge l'email alla lista dei
// disiscritti e mostra una paginetta di conferma col brand.
// Il token HMAC impedisce di disiscrivere indirizzi altrui a caso.

const SECRET = import.meta.env.SUPABASE_SERVICE_KEY ?? "lm-newsletter";

function token(email: string): string {
  return crypto.createHmac("sha256", SECRET).update(email.toLowerCase()).digest("hex").slice(0, 24);
}

function pagina(titolo: string, testo: string): Response {
  const html = `<!doctype html>
<html lang="fr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="robots" content="noindex, nofollow" />
  <title>${titolo} — ${CLIENT.nome}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Marcellus&family=Nunito+Sans:wght@400;700&display=swap" />
  <style>
    body { margin: 0; background: #231f20; color: #fff; font-family: "Nunito Sans", sans-serif;
      min-height: 100vh; display: flex; align-items: center; justify-content: center; text-align: center; padding: 1.5rem; }
    .box { max-width: 460px; }
    .claim { font-family: "Marcellus", serif; letter-spacing: 0.3em; text-transform: uppercase; font-size: 0.7rem; color: #dfab4e; margin: 0 0 1rem; }
    h1 { font-family: "Marcellus", serif; font-weight: 400; font-size: 1.8rem; margin: 0 0 0.8rem; }
    p { color: #b3aca6; line-height: 1.7; margin: 0 0 1.8rem; }
    a { display: inline-block; font-family: "Marcellus", serif; font-size: 0.85rem; font-weight: 700;
      letter-spacing: 0.16em; text-transform: uppercase; color: #fff; text-decoration: none;
      border: 2px solid rgba(255,255,255,0.9); padding: 12px 30px; transition: background .2s, color .2s; }
    a:hover { background: #fff; color: #231f20; }
  </style>
</head>
<body>
  <div class="box">
    <p class="claim">${CLIENT.nome} — ${CLIENT.claim}</p>
    <h1>${titolo}</h1>
    <p>${testo}</p>
    <a href="/">Retour à l'accueil</a>
  </div>
</body>
</html>`;
  return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export const GET: APIRoute = async ({ url }) => {
  const email = (url.searchParams.get("e") ?? "").trim().toLowerCase();
  const t = url.searchParams.get("t") ?? "";

  if (!email || !t || t !== token(email)) {
    return pagina("Lien invalide", "Ce lien de désinscription n'est pas valide ou a expiré.");
  }

  try {
    await supabaseAdmin
      .from("newsletter_optout")
      .upsert({ email }, { onConflict: "email" });
  } catch {
    return pagina("Oups", "Une erreur est survenue. Réessayez dans un instant.");
  }

  return pagina(
    "Vous êtes désinscrit",
    `L'adresse ${email} ne recevra plus notre newsletter. À bientôt au restaurant !`
  );
};
