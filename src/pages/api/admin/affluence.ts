import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta } from "../../../lib/admin/sede";
import { contestoDiStaff, mostra } from "../../../lib/admin/permessi";
import { caricaAffluenza } from "../../../lib/admin/affluenza";
import { fusoDi } from "../../../lib/fuso";

export const prerender = false;

// GET /api/admin/affluence — l'abitudine di QUESTO giorno della settimana:
// media per ora dei coperti prenotati e degli ordini, sulle ultime settimane.
// La Accueil ci disegna le barre chiare sotto quelle di oggi.
//
// ⚠️ Conta solo quello che chi guarda puo' vedere (`mostra`): senza la pagina
// «Commandes» gli ordini non entrano nemmeno nella somma. Un grafico e' un
// dato come un altro — in forma di barra, ma lo stesso dato.
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const ambito = await ambitoDiRichiesta(request, staff);
  const ctx = await contestoDiStaff(staff);
  const oggi = DateTime.now().setZone(await fusoDi(ambito)).toISODate() ?? "";

  const dati = await caricaAffluenza(oggi, ambito, {
    resa: mostra(ctx, "reservations"),
    ordini: mostra(ctx, "orders"),
  });

  return new Response(JSON.stringify(dati), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
