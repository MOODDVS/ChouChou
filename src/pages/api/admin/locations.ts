import type { APIRoute } from "astro";
import { supabaseAdmin } from "../../../lib/db";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { isSuperUser } from "../../../lib/admin/superAdmin";
import { scordaSedi, scordaSegreti, scriviConfig, leggiConfig, ambitoDiRiga, CHIAVI_SEGRETE, segretoDAmbiente } from "../../../lib/admin/sede";
import { CHIAVI_STAMPA, accesoStampa, leggiDestinazioni, CHIAVE_DESTINAZIONI, type Destinazione } from "../../../lib/stampaRegole";
import { salvaConfigStampa } from "../../../lib/stampaConfig";
import { cifra, cifraturaPronta } from "../../../lib/segreti";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT } from "../../../i18n/admin";

export const prerender = false;

// SEDI (multi-sede) — riservato al SUPER ADMIN MOODD.
//
// GET    → { multi, locations: [...], secrets: { <id>: { stripe_secret_key: bool, … } } }
//          ⚠️ dei segreti si dice SOLO se ci sono. Il valore non esce mai da qui.
// POST   → crea una sede { name, slug, … }
// PATCH  → { id, ...campi }                 modifica la scheda
//          { storico_sede }                 assegna lo storico orfano a una sede
//          { id, place_id }                 Place ID Google della sede
//          { id, printer_id, print_auto }   la stampante dei ticket della sede
//          { id, secret_key, secret_value } scrive un segreto (sola scrittura)
// DELETE ?id= → elimina (il client manda POST + X-Method-Override)
//
// Le sedi NON si cancellano se hanno dati collegati: `on delete restrict`
// nella migrazione #73. E' voluto — cancellare una sede con i suoi ordini
// dentro non e' un'operazione, e' una perdita.

/** Gli unici segreti che questa API accetta. Una chiave sconosciuta non e'
 *  un caso da ignorare: e' un errore, e va detto.
 *
 *  ⚠️ L'elenco NON e' scritto qui: e' lo stesso che `sede.ts` usa per sapere
 *  su quale variabile d'ambiente ripiegare. Due elenchi separati vorrebbero
 *  dire una chiave che si scrive e che nessuno rilegge mai. */
const SEGRETI: readonly string[] = CHIAVI_SEGRETE;

// `locations` e' l'IDENTITA' della sede e basta. Indirizzo, telefono, email,
// ragione sociale, IVA e scheda Google NON stanno qui: sono dati del
// ristoratore, si scrivono da Réglages → Général e da Intégrations, e vivono
// in `location_config` con le stesse chiavi che quelle pagine usano gia'.
const SELECT = "id, name, slug, image_url, sort_order, active, created_at";

const RE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Messaggi d'errore nella lingua dell'admin.
 *  La lingua e' globale (app_config.admin_lang) e il server la conosce gia'
 *  dalla cache di adminBoot: nessuna query in piu'. Senza questo, un admin
 *  in italiano riceveva un toast in francese — non un guasto, ma il genere
 *  di cosa che fa sembrare l'applicazione di qualcun altro. */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

/** Traduce l'errore di Postgres in qualcosa di utile, e lo SCRIVE nei log.
 *
 *  ⚠️ Prima questa API rispondeva «Salvataggio impossibile» e buttava via il
 *  motivo. Una colonna mancante (migrazione non lanciata), un vincolo violato
 *  e una rete caduta davano tutti la stessa pastiglia rossa, e per capire
 *  quale fosse bisognava indovinare. Il ripiego silenzioso e' il guasto.
 */
function erroreDb(dove: string, err: { message?: string; code?: string } | null): string {
  const dettaglio = String(err?.message ?? "");
  console.error(`[locations] ${dove}: ${err?.code ?? "?"} ${dettaglio}`);
  // 42703 = colonna inesistente, 42P01 = tabella inesistente: quasi sempre
  // una migrazione non lanciata su QUESTO cliente.
  if (err?.code === "42703" || err?.code === "42P01" || /column .* does not exist|relation .* does not exist/i.test(dettaglio)) {
    return "loc.err.migrazione";
  }
  if (dettaglio.includes("locations_slug_key")) return "loc.err.slugDup";
  return "common.saveErr";
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** Sedi, societa' e chiavi Stripe: roba da super admin MOODD, non da cliente. */
async function soloSuper(request: Request): Promise<null | Response> {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  if (!isSuperUser(staff)) return json({ error: await msg("loc.err.super") }, 403);
  return null;
}

const testo = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

/** Campi accettati da POST/PATCH, ripuliti. `parziale` = PATCH: si toccano
 *  solo le chiavi arrivate davvero, il resto della riga resta com'e'. */
function campiDa(body: Record<string, unknown>, parziale: boolean): Record<string, unknown> | string {
  const out: Record<string, unknown> = {};

  if (!parziale || body.name !== undefined) {
    const name = testo(body.name, 60);
    if (!name) return "loc.err.name";
    out.name = name;
  }
  if (!parziale || body.slug !== undefined) {
    const slug = testo(body.slug, 40).toLowerCase();
    if (!RE_SLUG.test(slug)) {
      return "loc.err.slug";
    }
    out.slug = slug;
  }
  // Il fuso NON sta qui: sta in Réglages → Général, per sede, come tutto il
  // resto di quella scheda. Averlo anche qui voleva dire due sorgenti per la
  // stessa ora — e due sorgenti che non concordano non danno errore, danno
  // slot sbagliati.
  // Foto della sede: URL reso da /api/admin/upload, quindi gia' nel nostro
  // storage. Si accetta solo quello — un indirizzo qualunque farebbe
  // caricare al browser del ristoratore un'immagine di terzi.
  if (!parziale || body.image_url !== undefined) {
    const u = testo(body.image_url, 400);
    out.image_url = /^https?:\/\/[^\s"'<>]+$/.test(u) ? u : null;
  }
  if (!parziale || body.sort_order !== undefined) {
    const n = Number(body.sort_order);
    out.sort_order = Number.isFinite(n) ? Math.min(999, Math.max(0, Math.round(n))) : 0;
  }
  if (!parziale || body.active !== undefined) out.active = body.active !== false;

  return out;
}

/**
 * Lo storico senza sede, tabella per tabella.
 *
 * ⚠️ Perche' esiste: la migrazione #73 AGGIUNGE `location_id` ma non la
 * riempie — quando gira, le sedi non ci sono ancora. Accendendo il
 * multi-sede senza riattribuire, ordini, prenotazioni e TAVOLI di prima
 * non comparirebbero piu' da nessun punto: il filtro e' `location_id =
 * <id>`, e NULL non lo soddisfa.
 *
 * Database indietro con le migrazioni (funzione assente) = mappa vuota,
 * cioe' nessuna domanda e nessun travaso: non e' un errore da mostrare.
 */
async function contaStorico(): Promise<Record<string, number>> {
  try {
    const { data, error } = await supabaseAdmin.rpc("storico_senza_sede");
    if (error || !data) return {};
    const out: Record<string, number> = {};
    for (const r of data as { tabella: string; n: number }[]) out[r.tabella] = Number(r.n);
    // ⚠️ I DOCUMENTI si contano nello Storage, non nella tabella. In
    // `admin_docs_meta` c'e' una riga solo per i file che hanno una scadenza
    // o un referente: annunciare «3 documenti» e poi spostarne dodici e'
    // peggio che non dire il numero. Quello che si sposta sono i file.
    const file = await contaFileDocumenti();
    if (file > 0) out.admin_docs_meta = file;
    else delete out.admin_docs_meta;
    return out;
  } catch {
    return {};
  }
}

/**
 * I DOCUMENTI GIA' CARICATI, spostati nella cartella della sede.
 *
 * I documenti non si separano con una colonna ma con il PERCORSO nel bucket
 * (`sedi/<id>/contrat/…`): la lista si costruisce leggendo lo Storage, e un
 * file senza riga di metadati non avrebbe nessuna sede da cui farsi
 * filtrare. Quindi accendendo il multi-sede i file di prima vanno spostati,
 * o sparirebbero dalla pagina Documenti di tutti i punti.
 *
 * ⚠️ Lo Storage non lo puo' fare l'SQL: `assegna_storico_sede` sposta le
 * RIGHE, i file li sposta questo. E l'ordine conta — prima il file, poi la
 * riga: se si ferma a meta', restano dei metadati che puntano a un file
 * gia' spostato (si perde una scadenza) invece di un file che nessuno
 * trova piu'.
 *
 * Mai bloccante: un errore qui non deve impedire l'accensione.
 */
/** Quanti PDF ci sono nelle cartelle di categoria alla radice del bucket,
 *  cioe' quanti file lo spostamento andra' a toccare. Le anteprime
 *  (`.thumb-…`) non si contano: seguono il loro PDF. */
async function contaFileDocumenti(): Promise<number> {
  let n = 0;
  for (const cat of ["contrat", "facture", "recu", "legal", "autre"]) {
    try {
      const { data } = await supabaseAdmin.storage.from("documents").list(cat, { limit: 1000 });
      n += (data ?? []).filter((f) => f.name && f.id !== null && !f.name.startsWith(".")).length;
    } catch {
      /* cartella assente */
    }
  }
  return n;
}

async function spostaDocumenti(sedeId: string): Promise<number> {
  const BUCKET = "documents";
  const CATS = ["contrat", "facture", "recu", "legal", "autre"];
  let spostati = 0;
  for (const cat of CATS) {
    try {
      const { data } = await supabaseAdmin.storage.from(BUCKET).list(cat, { limit: 1000 });
      for (const f of data ?? []) {
        // `list()` rende anche le cartelle: hanno `id` nullo e non sono file.
        if (!f.name || f.id === null) continue;
        const da = `${cat}/${f.name}`;
        const a = `sedi/${sedeId}/${cat}/${f.name}`;
        const { error } = await supabaseAdmin.storage.from(BUCKET).move(da, a);
        if (error) continue;
        spostati++;
        await supabaseAdmin.from("admin_docs_meta").update({ path: a }).eq("path", da);
      }
    } catch {
      /* cartella assente o bucket non creato: niente da spostare */
    }
  }
  return spostati;
}

export const GET: APIRoute = async ({ request }) => {
  const no = await soloSuper(request);
  if (no) return no;

  // ---- quante righe non hanno ancora una sede ----
  // Il super admin lo chiede PRIMA di accendere l'interruttore, per sapere
  // quanto storico sta per attribuire e a chi. Sola lettura.
  if (new URL(request.url).searchParams.get("storico") === "1") {
    return json({ storico: await contaStorico() });
  }

  const { data, error } = await supabaseAdmin
    .from("locations")
    .select(SELECT)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  if (error) return json({ error: await msg(erroreDb("GET", error)) }, 500);

  // Place ID e scheda Google di ogni sede. Non sono segreti: si rileggono e
  // si mostrano. La scheda si mostra CON IL SUO NOME — «collegata» non dice
  // niente quando l'errore possibile e' aver collegato la pizzeria sbagliata.
  //
  // ⚠️⚠️ E SI DICE ANCHE SE IL VALORE E' SUO O EREDITATO DAL MARCHIO.
  // `leggiConfig` ricade su `app_config` quando la sede non ha scritto
  // niente — ed e' giusto, e' il modo in cui una sede nuova parte con i
  // campi pieni invece che con un modulo vuoto. Ma per QUESTI due dati
  // l'ereditarieta' e' una bugia: un Place ID e una scheda Google
  // identificano UN'ATTIVITA' FISICA, e tre pizzerie non possono averne una
  // sola. Senza questa distinzione il pannello avrebbe mostrato tutte e tre
  // le sedi come «configurate» con il dato del primo cliente, che e' il vecchio
  // valore rimasto a livello di marchio.
  const placeIds: Record<string, string> = {};
  const google: Record<string, string> = {};
  const reviewUrls: Record<string, string> = {};
  const stampanti: Record<string, { printer_id: string; auto: boolean; dest: Destinazione[] }> = {};
  const propri: Record<string, string[]> = {};
  try {
    for (const r of (data ?? []) as { id: string }[]) {
      const c = await leggiConfig(ambitoDiRiga(r.id), ["google_place_id", "google_location_title", "link_google_review", ...CHIAVI_STAMPA, CHIAVE_DESTINAZIONI]);
      const v = (c.valori.get("google_place_id") ?? "").trim();
      if (v) placeIds[r.id] = v;
      // Il link «lascia una recensione» e' di una SCHEDA, e le schede sono
      // tre: con un link solo chi ha cenato a Schaerbeek recensisce Stockel.
      const rv = (c.valori.get("link_google_review") ?? "").trim();
      if (rv) reviewUrls[r.id] = rv;
      const g = (c.valori.get("google_location_title") ?? "").trim();
      if (g) google[r.id] = g;
      // ⚠️ Il numero della stampante NON e' un segreto: si mostra. Si legge
      // con `valori`, cioe' col ripiego sul marchio gia' applicato — a sede
      // unica la stampante sta li', e la scheda deve vederla.
      stampanti[r.id] = {
        printer_id: (c.valori.get("print_printer_id") ?? "").trim(),
        auto: accesoStampa(c.valori.get("print_auto")),
        dest: leggiDestinazioni(c.valori.get(CHIAVE_DESTINAZIONI)),
      };
      propri[r.id] = [...c.sovrascritte];
    }
  } catch { /* migrazione non lanciata */ }

  // Dei segreti si dice soltanto SE ci sono: mai il valore, nemmeno un pezzo.
  // Questa e' l'unica API che tocca `location_secrets`, ed e' anche il motivo
  // per cui quella tabella e' separata da `location_config`: la lettura
  // generica della configurazione non la incontra proprio.
  const impostati: Record<string, Record<string, boolean>> = {};
  try {
    const { data: righe } = await supabaseAdmin
      .from("location_secrets")
      .select("location_id, key");
    for (const r of (righe ?? []) as { location_id: string; key: string }[]) {
      (impostati[r.location_id] ??= {})[r.key] = true;
    }
  } catch {
    /* tabella assente: nessun segreto impostato */
  }

  // Lo storico rimasto senza sede: il pannello ci mette un avviso. E' uno
  // STATO, non un evento — quindi si vede finche' c'e', invece di comparire
  // solo nell'istante in cui qualcuno tocca un interruttore.
  const storico = await contaStorico();

  // ⚠️ Si dice se la CIFRATURA e' possibile, non se i segreti ci sono: il
  // pannello lo scrive accanto ai campi PRIMA che qualcuno incolli una
  // chiave. Un avviso che arriva dopo il salvataggio e' un avviso che arriva
  // quando la chiave e' gia' negli appunti di qualcuno.
  // ⚠️ Si dice SE l'ambiente ha un ripiego, mai quale. Serve alla scheda per
  // distinguere «non configurata» da «eredita dal .env»: sono due cose
  // diverse, e la prima e' un pagamento che fallira'.
  const ambiente: Record<string, boolean> = {};
  for (const k of CHIAVI_SEGRETE) ambiente[k] = segretoDAmbiente(k) !== "";

  return json({
    locations: data ?? [], secrets: impostati, placeIds, reviewUrls, google, propri, storico,
    cifratura: cifraturaPronta(), ambiente, stampanti,
  });
};

/**
 * Assegna lo storico orfano a una sede: righe (SQL) + file (Storage).
 * Rende quante righe ha spostato, o `null` se il database ha rifiutato.
 *
 * ⚠️ Prima le RIGHE, poi i FILE. Fermandosi a meta' restano dei documenti
 * ancora nella cartella vecchia — si rivedono e si rispostano — invece di
 * righe che puntano a file spostati, che sarebbe una scadenza persa.
 */
async function travasaStorico(sedeId: string): Promise<number | null> {
  const { data, error } = await supabaseAdmin.rpc("assegna_storico_sede", { sede: sedeId });
  if (error) return null;
  await spostaDocumenti(sedeId);
  const riga = (Array.isArray(data) ? data[0] : data) as { assegnate?: number } | null;
  return Number(riga?.assegnate ?? 0);
}

export const POST: APIRoute = async ({ request }) => {
  const no = await soloSuper(request);
  if (no) return no;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: await msg("loc.err.body") }, 400); }

  const campi = campiDa(body, false);
  if (typeof campi === "string") return json({ error: await msg(campi) }, 400);

  const { data, error } = await supabaseAdmin
    .from("locations").insert(campi).select(SELECT).single();
  if (error) {
    // Lo slug e' unico: finisce negli URL pubblici, due sedi non possono averlo uguale.
    const chiave = erroreDb("POST", error);
    return json({ error: await msg(chiave) }, chiave === "loc.err.slugDup" ? 409 : 500);
  }
  scordaSedi();

  // ⚠️ LA PRIMA SEDE PRENDE LO STORICO, senza chiedere niente.
  //
  // Da questo istante il filtro e' acceso: `scegliSede` vede un elenco non
  // piu' vuoto e comincia a separare. Se lo storico restasse a `location_id`
  // NULL sparirebbe da subito — ordini, prenotazioni e TAVOLI compresi — e
  // il ristoratore se ne accorgerebbe aprendo il piano sala vuoto.
  //
  // Non c'e' niente da chiedere perche' non c'e' niente da scegliere: la
  // sede e' una sola. La domanda serve solo quando le sedi sono gia' piu' di
  // una, e allora la si fa dal pannello Sedi.
  let assegnate = 0;
  try {
    const { count } = await supabaseAdmin
      .from("locations").select("id", { count: "exact", head: true });
    if ((count ?? 0) === 1) {
      assegnate = (await travasaStorico(String((data as { id: string }).id))) ?? 0;
    }
  } catch { /* mai bloccante: la sede e' creata comunque */ }

  return json({ ok: true, location: data, assegnate }, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  const no = await soloSuper(request);
  if (no) return no;

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: await msg("loc.err.body") }, 400); }

  // ---- TRAVASO DELLO STORICO a una sede ----
  //
  // ⚠️ Non e' piu' legato a un interruttore (15/09/2026): l'interruttore non
  // esiste, la verita' e' quante sedi ci sono. Questo resta perche' lo
  // storico orfano e' uno STATO che puo' esistere — un database dove le sedi
  // sono state create prima che il codice le separasse — e va potuto
  // risolvere quando lo si incontra, non solo in un istante preciso.
  //
  // Creando la PRIMA sede il travaso e' automatico (vedi POST): li' non c'e'
  // niente da chiedere, lo storico e' per forza suo.
  if (body.storico_sede !== undefined) {
    const sedeStorico = testo(body.storico_sede, 40);
    if (!RE_UUID.test(sedeStorico)) {
      return json({ error: await msg("loc.err.storicoSede"), storico: await contaStorico() }, 400);
    }
    const assegnate = await travasaStorico(sedeStorico);
    if (assegnate === null) return json({ error: await msg("loc.err.storicoKo") }, 500);
    return json({ ok: true, assegnate });
  }


  const id = testo(body.id, 40);
  if (!RE_UUID.test(id)) return json({ error: await msg("loc.err.notFound") }, 400);

  // ---- Place ID di Google (livello 1, sola lettura) ----
  // Identifica UN'ATTIVITA' FISICA: tre pizzerie, tre Place ID. Sta qui e
  // non piu' in Integrazioni perche' e' un dato del PUNTO, come l'indirizzo.
  // Link «lascia una recensione»: e' l'indirizzo pubblico della stessa scheda
  // Google del Place ID qui sopra, e sta accanto a lui per quello. La chiave
  // resta `link_google_review`, la stessa che l'email di recensione legge con
  // l'ambito della RIGA: nessuna migrazione, e per un cliente a sede unica il
  // valore di marchio continua a fare da ripiego.
  if (body.review_url !== undefined) {
    const url = String(body.review_url).trim().slice(0, 500);
    if (url && !/^https:\/\//.test(url)) {
      return json({ error: await msg("err.linkHttpsBad") }, 400);
    }
    const err = await scriviConfig(ambitoDiRiga(id), { link_google_review: url });
    if (err) return json({ error: await msg(erroreDb("review", { message: err })) }, 500);
    return json({ ok: true });
  }

  // ---- La stampante di QUESTO punto ----
  // ⚠️ Due chiavi, e vanno insieme: l'interruttore dice che il ristoratore la
  // vuole, il numero dice che esiste. Acceso senza numero vuol dire una coda
  // che si riempie di ticket che nessuno stampera' mai — e' la stessa regola
  // di `stampaAttiva`, qui dal lato di chi scrive.
  // ---- La stampante di QUESTO punto ----
  // ⚠️ La validazione e la scrittura stanno in `salvaConfigStampa`, perche' le
  // stesse chiavi si salvano anche da Intégrations per i clienti a sede unica.
  // Due copie della regola vorrebbero dire che un giorno una delle due accetta
  // una categoria doppia — e il guasto uscirebbe da una porta sola.
  if (body.printer_id !== undefined || body.print_auto !== undefined || body.destinazioni !== undefined) {
    const r = await salvaConfigStampa(ambitoDiRiga(id), body);
    if (r.errore) return json({ error: `${await msg(r.errore)} ${r.doppie.join(", ")}`.trim() }, r.errore === "common.saveErr" ? 500 : 400);
    return json({ ok: true });
  }

  if (body.place_id !== undefined) {
    const placeId = String(body.place_id).trim().slice(0, 200);
    if (placeId && !/^[A-Za-z0-9_-]+$/.test(placeId)) {
      return json({ error: await msg("loc.err.placeId") }, 400);
    }
    const err = await scriviConfig(ambitoDiRiga(id), { google_place_id: placeId });
    if (err) return json({ error: await msg(erroreDb("place", { message: err })) }, 500);
    return json({ ok: true });
  }

  // ---- scrittura di un segreto (chiave Stripe): SOLA SCRITTURA ----
  // Non c'e' nessun percorso per rileggerlo. Chi lo perde lo rigenera su
  // Stripe: e' il comportamento giusto per una credenziale.
  if (body.secret_key !== undefined) {
    const chiave = testo(body.secret_key, 40);
    if (!SEGRETI.includes(chiave)) return json({ error: await msg("loc.err.secret") }, 400);
    const valore = String(body.secret_value ?? "").trim();

    if (!valore) {
      const { error } = await supabaseAdmin
        .from("location_secrets").delete().eq("location_id", id).eq("key", chiave);
      if (error) return json({ error: await msg("loc.err.delete") }, 500);
      scordaSegreti(id);
      return json({ ok: true, impostato: false });
    }

    // ⚠️ SI RIFIUTA DI SCRIVERE SENZA `SECRETS_KEY`. La tentazione e' di
    // salvare in chiaro «per non bloccare l'utente»: sarebbe il guasto
    // peggiore di tutti, perche' riesce. Il ristoratore vede la spunta verde,
    // il pagamento funziona, e la chiave con cui si incassa resta leggibile
    // a chiunque apra un backup. Meglio un errore che dice cosa fare.
    if (!cifraturaPronta()) return json({ error: await msg("loc.err.noCrypto") }, 500);

    const { error } = await supabaseAdmin
      .from("location_secrets")
      .upsert({ location_id: id, key: chiave, value: cifra(valore), updated_at: new Date().toISOString() },
              { onConflict: "location_id,key" });
    if (error) return json({ error: await msg(erroreDb("secret", error)) }, 500);
    // La chiave nuova deve valere SUBITO: la cache dei segreti dura 60 s, e
    // mezzo minuto di pagamenti sul conto vecchio non si recupera.
    scordaSegreti(id);
    return json({ ok: true, impostato: true });
  }

  // ---- scheda della sede ----
  const campi = campiDa(body, true);
  if (typeof campi === "string") return json({ error: await msg(campi) }, 400);
  if (Object.keys(campi).length === 0) return json({ error: await msg("loc.err.nothing") }, 400);

  const { data, error } = await supabaseAdmin
    .from("locations").update(campi).eq("id", id).select(SELECT).single();
  if (error) {
    const chiave = erroreDb("PATCH", error);
    return json({ error: await msg(chiave) }, chiave === "loc.err.slugDup" ? 409 : 500);
  }
  scordaSedi();
  return json({ ok: true, location: data });
};

export const DELETE: APIRoute = async ({ request, url }) => {
  const no = await soloSuper(request);
  if (no) return no;

  const id = testo(url.searchParams.get("id"), 40);
  if (!RE_UUID.test(id)) return json({ error: await msg("loc.err.notFound") }, 400);

  const { error } = await supabaseAdmin.from("locations").delete().eq("id", id);
  if (error) {
    // `on delete restrict`: ci sono ordini, prenotazioni o altro collegati.
    // Non si forza. Si disattiva la sede, che la toglie dall'uso lasciando
    // intatto tutto quello che ci e' passato dentro.
    const collegata = String(error.code ?? "") === "23503";
    return json(
      { error: await msg(collegata ? "loc.err.linked" : "loc.err.delete") },
      collegata ? 409 : 500,
    );
  }
  scordaSedi();
  scordaSegreti(id);
  return json({ ok: true });
};
