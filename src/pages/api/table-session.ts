import type { APIRoute } from "astro";
import { DateTime } from "luxon";
import { ambitoPubblicoChiesto, leggi, inserisci, aggiorna, type Ambito } from "../../lib/admin/sede";
import { opzioniTavolo } from "../../lib/ordiniOpzioni";
import { servizioInCorso } from "../../lib/ordiniRegole";
import { configGiornoEffettiva } from "../../lib/schedule";
import { fusoDi } from "../../lib/fuso";
import { normalizzaNome } from "../../lib/normalizzaNome";
import { registraCliente } from "../../lib/registraCliente";
import { emailReviewResa } from "../../lib/notifications";

/**
 * APRIRE (O RITROVARE) LA SESSIONE DI CHI ORDINA DAL LOCALE.
 *
 * POST { table?, people, name, email?, lang?, reservation_id? }
 *   → { reservation_id, table_id, table_label, service_key, ripresa }
 *
 * Il cliente inquadra il QR, dice come si chiama e in quanti sono: da qui
 * nasce una prenotazione gia' `seated`, e l'ordine che segue si attacca a lei.
 *
 * ⚠️ TRE LOCALI DIVERSI, UNA ROTTA SOLA:
 *   · ristorante con la mappa della sala → si scegle il tavolo, e il ticket
 *     dice «TAVOLO 7»;
 *   · bistrot senza numeri sui tavoli → si chiede solo il nome, e il ticket
 *     dice «MARC»: il cameriere cerca la persona, non il numero;
 *   · snack o chiosco, nessuno che porti → come sopra, piu' l'email «c'e'
 *     pronto», che li' e' l'unico modo di dirlo.
 * Il primo caso si riconosce DAI DATI (la sala ha dei tavoli?), il terzo da
 * un interruttore, perche' i due ultimi hanno gli stessi dati e vogliono il
 * contrario l'uno dell'altro. Vedi `opzioniTavolo`.
 *
 * ⚠️ NON PASSA DA `/api/reservation`, e non e' pigrizia. Quella rotta fa
 * capienza, fasce orarie e lista d'attesa — tutte domande sul FUTURO. Qui la
 * gente e' GIA' seduta: chiedere «c'e' posto?» a chi ha gia' il posto
 * vorrebbe dire rifiutare un cliente che e' dentro al locale perche' il
 * servizio della sera risulta pieno.
 *
 * ⚠️ IL SECONDO GIRO NON APRE UNA SECONDA SESSIONE. Col tavolo si riconosce
 * dal numero; senza, dal `reservation_id` che il browser si e' ricordato.
 * Senza questo, una famiglia che ordina il dolce dopo il primo giro
 * comparirebbe due volte nei coperti della sera.
 *
 * ⚠️ IL QR RESTA SUL TAVOLO ANCHE A LOCALE CHIUSO, e quello generico si puo'
 * inquadrare da una foto. Fuori servizio si rifiuta: un incasso vero con la
 * cucina spenta e' un ticket che non esce e nessuno che se ne accorge fino al
 * mattino dopo.
 */
export const prerender = false;

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/** Riga di prenotazione come la rilegge il secondo giro. */
interface ResaAperta {
  id: string;
  date: string;
  status: string;
  tables: string[] | null;
}

/** Programma la richiesta di recensione, identica alle prenotazioni normali.
 *  ⚠️ Si programma ADESSO (invio differito alle 11:30 di domani), non quando
 *  qualcuno chiude il tavolo: con un QR non lo chiude mai nessuno. */
async function programmaReview(
  r: { id: string; date: string; first_name: string; last_name: string; email: string; lang: string },
  ambito: Ambito,
): Promise<void> {
  try {
    const emailId = await emailReviewResa({
      ...r,
      location_id: ambito.modo === "sede" ? ambito.id : null,
    });
    if (!emailId) return;
    await aggiorna("reservations", ambito, { review_email_id: emailId }).eq("id", r.id);
  } catch {
    /* mai bloccante: l'ordine vale piu' di una recensione */
  }
}

/** Il tavolo chiesto: per id (QR stampato per quel tavolo) o per nome (QR
 *  generico, numero scelto a mano).
 *  ⚠️ Il nome si confronta senza maiuscole e senza spazi ai bordi: sul
 *  cartoncino c'e' «7», nel piano sala puo' esserci «7 » o «Table 7». */
async function trovaTavolo(chiesto: string, ambito: Ambito) {
  const { data } = await leggi("restaurant_tables", ambito, "id, name, zone, seats");
  const tutti = (data ?? []) as unknown as { id: string; name: string; zone: string; seats: number }[];
  const q = chiesto.trim().toLowerCase();
  return (
    tutti.find((t) => t.id === chiesto) ??
    tutti.find((t) => String(t.name ?? "").trim().toLowerCase() === q) ??
    null
  );
}

export const POST: APIRoute = async ({ request }) => {
  const ambito = await ambitoPubblicoChiesto(request);

  let body: {
    table?: unknown; people?: unknown; name?: unknown;
    email?: unknown; lang?: unknown; reservation_id?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return json({ error: "requete invalide" }, 400);
  }

  /* ⚠️ COM'E' FATTA QUESTA SALA, prima di tutto il resto: l'interruttore, i
     tavoli e l'avviso. Un locale di solo asporto non ha tavoli, e la rotta non
     deve nemmeno andare a vedere se il tavolo esiste — risponderebbe «table
     inconnue», cioe' «sbaglia numero», a chi invece non ha mai acceso la
     sala. */
  const opz = await opzioniTavolo(ambito);
  if (!opz.attivo) return json({ error: "commande a table non activee" }, 403);

  const nome = normalizzaNome(body.name);
  if (nome.length < 2) return json({ error: "nom manquant" }, 400);
  const people = Math.round(Number(body.people));
  if (!Number.isFinite(people) || people < 1 || people > 100) {
    return json({ error: "nombre de personnes invalide" }, 400);
  }
  const chiesto = String(body.table ?? "").trim();
  /* ⚠️ IL TAVOLO SI CHIEDE SOLO SE ESISTE. Un bistrot senza numeri sui tavoli
     non ha niente da far scegliere, e pretendere un numero vorrebbe dire un
     modulo che non si puo' compilare. Dove i tavoli ci sono, invece, e'
     obbligatorio: e' l'unico dato che dice dove portare il piatto. */
  if (opz.conTavoli && !chiesto) return json({ error: "table manquante" }, 400);
  const lang = String(body.lang ?? "fr").slice(0, 5) || "fr";
  /* ⚠️ L'EMAIL E' FACOLTATIVA, TRANNE QUANDO E' L'UNICO MODO DI AVVISARE.
     Dove nessuno porta il piatto (snack, chiosco) l'email e' il solo canale
     verso il cliente — un push al cliente non esiste, `push.ts` suona sui
     telefoni del ristoratore — e senza di lei quella persona fisserebbe il
     bancone senza sapere niente. Dove invece c'e' chi serve, resta una scelta:
     pretenderla perderebbe ordini, e chi la lascia riceve la ricevuta. */
  const email = String(body.email ?? "").trim().toLowerCase();
  if (opz.avvisa && !email) return json({ error: "email requise" }, 400);

  // ---- Si puo' ordinare adesso? ----
  const fuso = await fusoDi(ambito);
  const adesso = DateTime.now();
  const ora = adesso.setZone(fuso);
  const cfg = await configGiornoEffettiva(adesso, ambito);
  const servizio = servizioInCorso(cfg, ora.toFormat("HH:mm"));
  if (!servizio) return json({ error: "service ferme" }, 409);

  let tavolo: { id: string; name: string; zone: string } | null = null;
  if (opz.conTavoli) {
    tavolo = await trovaTavolo(chiesto, ambito);
    if (!tavolo) return json({ error: "table inconnue" }, 404);
  }

  const oggi = ora.toFormat("yyyy-MM-dd");

  // ---- Il secondo giro ritrova la stessa sessione ----
  const { data: aperte } = await leggi("reservations", ambito, "id, date, status, tables")
    .eq("date", oggi)
    .eq("status", "seated");
  const seduti = (aperte ?? []) as unknown as ResaAperta[];
  /* ⚠️ DUE CHIAVI, perche' i dati disponibili sono diversi. Col tavolo si
     riconosce dal numero, che e' un fatto. Senza tavoli l'unica chiave e' il
     `reservation_id` che il browser si e' ricordato: si crede solo dopo aver
     verificato che quella prenotazione e' di OGGI e ancora aperta, e il piu'
     che ne puo' venire e' un ordine attaccato al conto di qualcun altro —
     pagato da chi ordina, quindi un numero di coperti sbagliato, non un
     incasso perso. */
  const chiestaResa = String(body.reservation_id ?? "").trim();
  const gia = opz.conTavoli
    ? seduti.find((r) => Array.isArray(r.tables) && tavolo !== null && r.tables.includes(tavolo.id))
    : chiestaResa
      ? seduti.find((r) => String(r.id) === chiestaResa)
      : undefined;
  if (gia) {
    return json({
      reservation_id: String(gia.id),
      table_id: tavolo?.id ?? null,
      table_label: tavolo?.name ?? "",
      service_key: servizio,
      ripresa: true,
    });
  }

  /* ⚠️ `last_name` e `phone` sono `not null` e al tavolo non si chiedono:
     chiedere cognome e telefono a chi e' seduto a tre metri e' attrito per un
     dato che non serve a nessuno. Stringa vuota, mai NULL.
     ⚠️ `seated_at` va messo: `table_minutes` conta da li', e senza il piano
     sala vedrebbe un tavolo arrivato all'ora di apertura.
     ⚠️ `source: "qr"` e' il valore che la #74 ha aggiunto ESATTAMENTE per il
     QR sui tavoli. */
  const riga = {
    date: oggi,
    heure: ora.toFormat("HH:mm"),
    service_key: servizio,
    people,
    zone: tavolo?.zone ?? null,
    first_name: nome,
    last_name: "",
    phone: "",
    email,
    lang,
    status: "seated",
    seated_at: ora.toISO(),
    /* ⚠️ Un array VUOTO, non `null`, quando la sala non ha tavoli: il piano
       sala e i conteggi fanno `Array.isArray(...)`, e un `null` li farebbe
       passare dal ramo «colonna non lanciata» invece che da «nessun tavolo
       assegnato». */
    tables: tavolo ? [tavolo.id] : [],
  };
  /* ⚠️ Ripiego sul `source` come in `/api/reservation`: un'installazione che
     non ha ancora passato la #74 ha il `check` vecchio, e 'qr' le farebbe
     fallire l'inserimento. Un canale sbagliato nelle statistiche e' un
     fastidio; un tavolo che non riesce a ordinare e' un cliente perso. */
  let ins = await inserisci("reservations", ambito, { ...riga, source: "qr" })
    .select("id")
    .single();
  if (ins.error && String(ins.error.message ?? "").includes("source")) {
    ins = await inserisci("reservations", ambito, riga).select("id").single();
  }
  if (ins.error || !ins.data) {
    // ⚠️ Il motivo vero nei log: un `not null` o un `check` sconosciuto qui
    // vorrebbe dire che NESSUNO puo' piu' ordinare dal locale, e dal telefono
    // del cliente si leggerebbe solo «impossibile».
    console.error("[tavolo] creazione prenotazione fallita:", ins.error);
    return json({ error: "impossible d'ouvrir la table" }, 500);
  }
  const reservationId = String((ins.data as { id?: unknown }).id ?? "");

  if (email) {
    // Il cliente entra in rubrica: e' il primo dei due motivi per cui l'email
    // si chiede. Mai bloccante.
    void registraCliente({ name: nome, email, phone: null, lang });
    void programmaReview(
      { id: reservationId, date: oggi, first_name: nome, last_name: "", email, lang },
      ambito,
    );
  }

  return json({
    reservation_id: reservationId,
    table_id: tavolo?.id ?? null,
    table_label: tavolo?.name ?? "",
    service_key: servizio,
    ripresa: false,
  });
};
