import { DateTime } from "luxon";
import { caricaResaGiorno } from "./caricaResaGiorno";
import { caricaToday } from "./caricaToday";
import { leggi, type Ambito } from "./sede";
import { pagineConsentite } from "./permessiRegole";
import { puo, type ContestoPermessi } from "./permessi";
import { fusoDi } from "../fuso";

// Pre-carica lato server (SSR, Fase 2) le 5 isole principali della Accueil,
// nella STESSA forma restituita dai rispettivi endpoint /api/admin/*:
//   - orders      → { orders: [...] }      (come GET /api/admin/orders)
//   - resa        → caricaResaGiorno(oggi)  (come GET /api/admin/reservations?date=)
//   - today       → { config }             (come GET /api/admin/today)
//   - menu        → { items: [...] }        (come GET /api/admin/menu)
//   - categories  → { categories: [...] }   (come GET /api/admin/categories)
// Le statistiche restano lato client (3 chiamate), quindi NON sono qui.
//
// ⚠️ «NELLA STESSA FORMA» VALE ANCHE PER I PERMESSI. Dal 21/09/2026 le API
// sotto /api/admin/ rispondono 403 a chi non ha quella pagina, e questo
// pre-caricamento deve dire la stessa cosa: un'isola che l'API rifiuterebbe
// qui non si legge e non si manda. Prima si leggeva e si mandava sempre, e
// il risultato era che un utente senza la pagina «Commandes» — che quindi la
// tile non la vedeva nemmeno — trovava nel sorgente della pagina nome, email
// e telefono dei clienti del giorno. Nessun errore, nessun log: bastava
// guardare il sorgente.
//
// Le due strade devono concordare anche quando rifiutano. Lato client
// `fakeRes` rende `ok: false` per un'isola assente, esattamente come farebbe
// un 403: cosi' il ramo SSR e il ramo senza SSR si comportano uguale.

const MENU_SELECT =
  "id, category, category_order, sort_order, name, description_fr, description_en, image_url, allergens, price_cents, available, orderable, discount_type, discount_value, discount_scope, is_bestseller, is_vegan, is_spicy, is_suggestion, is_seasonal";
// La tile Menu della Accueil elenca anche i piatti ESAURITI, quindi qui serve
// `sold_out`. E' una colonna arrivata con una migrazione: su un cliente che non
// l'ha ancora lanciata la query fallirebbe INTERA e la home resterebbe senza
// dati. Quindi si prova con, e si ripiega senza.
const MENU_SELECT_HOME = MENU_SELECT + ", sold_out";

function menuOrdinato(sel: string, ambito: Ambito) {
  return leggi("menu_items", ambito, sel)
    .order("category_order", { ascending: true })
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
}

async function caricaMenuHome(ambito: Ambito): Promise<{ data: unknown[] | null }> {
  const res = await menuOrdinato(MENU_SELECT_HOME, ambito);
  if (!res.error) return { data: res.data as unknown[] | null };
  return { data: (await menuOrdinato(MENU_SELECT, ambito)).data as unknown[] | null };
}
const ORDERS_SELECT =
  "id, status, pickup_time, customer_name, customer_email, customer_phone, items, total_cents, lang, created_at";

export async function caricaHomeData(ambito: Ambito, ctx: ContestoPermessi) {
  const oggi = DateTime.now().setZone(await fusoDi(ambito));
  const oggiKey = oggi.toISODate() ?? "";
  const soglia = oggi.minus({ days: 7 }).startOf("day").toISO();

  // ⚠️ Le isole vietate non si leggono nemmeno. Togliere i dati solo dalla
  // risposta basterebbe a chiudere la falla, ma lascerebbe il server a
  // interrogare il database per righe che butta via — e la prossima persona
  // che tocca questa funzione non avrebbe modo di accorgersi che quel `.data`
  // non doveva uscire di qui.
  const vedeOrdini = puo(ctx, "orders");
  const vedeResa = puo(ctx, "reservations");
  const vedeMenu = puo(ctx, "menu");

  const [ordersRes, resa, todayCfg, menuRes, catsRes, itemsCount] = await Promise.all([
    vedeOrdini
      ? leggi("orders", ambito, ORDERS_SELECT)
          .in("status", ["paid", "done", "cancelled"])
          .gte("pickup_time", soglia)
          .order("pickup_time", { ascending: true })
      : null,
    vedeResa ? caricaResaGiorno(oggiKey, ambito) : null,
    // `today` non ha pagina: e' lo stato della cucina, e la home ne ha
    // bisogno sempre (vedi PAGINA_APERTA in permessiRegole).
    caricaToday(ambito),
    vedeMenu ? caricaMenuHome(ambito) : null,
    // ⚠️ `leggi` anche qui, non `supabaseAdmin.from`. Le sezioni del menu
    // sono del MARCHIO, quindi il filtro non c'e' e il risultato e' identico:
    // il punto e' che si vede a colpo d'occhio che la decisione e' stata
    // presa, invece di dover andare a controllare la classificazione. Una
    // lettura nuda accanto a cinque filtrate sembra una dimenticanza, e un
    // giorno qualcuno la "sistema" nel verso sbagliato.
    vedeMenu
      ? leggi("menu_categories", ambito, "id, name, sort_order, kind")
          .order("sort_order", { ascending: true })
          .order("name", { ascending: true })
      : null,
    vedeMenu ? leggi("menu_items", ambito, "category") : null,
  ]);

  // Categorie con conteggio piatti (come /api/admin/categories)
  const conteggi = new Map<string, number>();
  for (const r of itemsCount?.data ?? []) {
    conteggi.set(r.category, (conteggi.get(r.category) ?? 0) + 1);
  }
  const categories = (catsRes?.data ?? []).map((c) => ({
    ...c,
    count: conteggi.get(c.name) ?? 0,
  }));

  return {
    ...(vedeOrdini ? { orders: { orders: ordersRes?.data ?? [] } } : {}),
    ...(vedeResa ? { resa } : {}),
    today: todayCfg,
    ...(vedeMenu ? { menu: { items: menuRes?.data ?? [] }, categories: { categories } } : {}),
    // Le pagine di chi guarda: servono al client per non chiedere le
    // statistiche quando riceverebbe tre 403. Non e' un segreto — sono i
    // permessi di chi sta leggendo la pagina.
    pagine: pagineConsentite(ctx),
  };
}
