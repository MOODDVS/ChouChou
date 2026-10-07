import type { APIRoute } from "astro";
import { verificaStaff, nonAutorizzato } from "../../../lib/admin/adminAuth";
import { ambitoDiRichiesta, leggi, inserisci, aggiorna, cancella } from "../../../lib/admin/sede";
import { ruoloDi } from "../../../lib/admin/superAdmin";
import { fusoDi } from "../../../lib/fuso";
import { leggiRicorrenza, prossima, descrivi } from "../../../lib/admin/ricorrenzaRegole";
import { adminLang } from "../../../lib/admin/adminLang";
import { adminT, ADMIN_LOCALE } from "../../../i18n/admin";
import { DateTime } from "luxon";
import { assegnabile } from "../../../lib/admin/teamRegole";
import { emailNotaAssegnata } from "../../../lib/notifications";

export const prerender = false;


/** Messaggio nella lingua dell'admin. `adminLang()` legge un valore globale
 *  gia' in cache (adminBoot): zero query in piu'. Vedi ENGINE.md,
 *  «Messaggi d'errore delle API admin — nella lingua dell'admin». */
async function msg(chiave: string): Promise<string> {
  return adminT(await adminLang())(chiave);
}

const SELECT = "id, content, author, done, created_at, tags, done_at, done_by, due_at, repeat, assigned_to, assigned_name";
/** Le colonne che una tabella `admin_notes` ha di sicuro, da qualunque
 *  migrazione sia ferma: `conRipiego` non scende mai sotto questo. */
const SELECT_BASE = "id, content, author, done, created_at";
const MAX_LEN = 1000;
/** Quanti tag per nota, e quanto lunghi. Un limite c'e' perche' il campo e'
 *  libero: senza, una nota puo' portarsi dietro un romanzo in trenta
 *  pastiglie e la colonna diventa illeggibile. */
const MAX_TAG = 5;
const MAX_TAG_LEN = 24;

/** CANCELLARE E' DA ADMIN. Lo staff spunta e aggiunge; buttare via quello che
 *  ha scritto un altro e' un'altra cosa.
 *  ⚠️ La decisione sta QUI e non solo nel disegno: il cestino nascosto in CSS
 *  e' un cestino che c'e'. Chi conosce l'indirizzo manda la richiesta lo
 *  stesso. */
function puoCancellare(staff: Parameters<typeof ruoloDi>[0]): boolean {
  return ruoloDi(staff) !== "user";
}

/**
 * LE COLONNE AGGIUNTE DOPO — e come si sopravvive a chi non le ha ancora.
 *
 * `tags` (#34), `done_at` (#78), `done_by` (#79), `due_at` e `repeat` (#80).
 * Un cliente puo' avere la #34 e non la #80: le migrazioni si lanciano a
 * mano, una per Supabase.
 *
 * ⚠️ QUI C'ERA UN DIFETTO CHE PERDEVA DATI IN SILENZIO. Il ripiego era uno
 * solo e tornava a `SELECT_BASE`, cioe' buttava via TUTTE le colonne nuove
 * insieme: su un database senza la #80, una nota salvata con l'etichetta
 * «Important» si salvava davvero — ma senza etichetta. Nessun errore, la
 * nota comparsa nella colonna, il tag sparito, e i filtri scomparsi con lui
 * perche' non c'era piu' nessuna etichetta in nessuna nota.
 *
 * Adesso si toglie UNA colonna alla volta, quella che Postgres dice che
 * manca, e si riprova. Chi ha la #34 tiene i tag anche senza la #80. Il
 * numero di giri e' limitato dalle colonne che esistono: non c'e' modo di
 * restare a girare.
 */
const COLONNE_NUOVE = ["tags", "done_at", "done_by", "due_at", "repeat", "assigned_to", "assigned_name"] as const;

/** Il nome della colonna che manca, letto dall'errore.
 *  ⚠️ Postgres e PostgREST lo dicono in due modi diversi — «column
 *  admin_notes.due_at does not exist» in lettura, «Could not find the
 *  'due_at' column ... in the schema cache» in scrittura — e cercare una
 *  forma sola avrebbe funzionato su un verbo e non sull'altro. */
function colonnaMancante(err: { message?: string } | null): string | null {
  const m = err ? String(err.message ?? "") : "";
  if (!m) return null;
  return COLONNE_NUOVE.find((c) => m.includes(c)) ?? null;
}

/** Le colonne da chiedere, meno quelle che si sono rivelate assenti.
 *  ⚠️ Il fondo e' `SELECT_BASE`: se un giorno qualcuno mettesse in
 *  `COLONNE_NUOVE` il nome di una colonna che la tabella ha da sempre, il
 *  filtro potrebbe svuotare l'elenco — e un `select("")` non rende un errore,
 *  rende righe senza campi. */
function selectSenza(fuori: Set<string>): string {
  const resta = SELECT.split(", ").filter((c) => !fuori.has(c));
  return resta.length ? resta.join(", ") : SELECT_BASE;
}

/**
 * Esegue una query e, se manca una colonna, la toglie e riprova.
 *
 * `esegui` riceve i campi da scrivere (gia' ripuliti) e l'elenco da
 * rileggere. Chi non scrive niente — la lettura — ignora il primo.
 */
async function conRipiego<T>(
  campi: Record<string, unknown>,
  esegui: (campi: Record<string, unknown>, select: string) => PromiseLike<{ data: T; error: { message?: string } | null }>,
): Promise<{ data: T; error: { message?: string } | null }> {
  const fuori = new Set<string>();
  let ultimo = await esegui(campi, SELECT);
  for (let giro = 0; giro < COLONNE_NUOVE.length; giro++) {
    const manca = colonnaMancante(ultimo.error);
    if (!ultimo.error || !manca || fuori.has(manca)) return ultimo;
    fuori.add(manca);
    const corpo: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(campi)) if (!fuori.has(k)) corpo[k] = v;
    ultimo = await esegui(corpo, selectSenza(fuori));
  }
  return ultimo;
}

/**
 * I TAG SONO LIBERI.
 *
 * ⚠️ Qui c'era un elenco chiuso di tre — important, recurrent, fournisseur —
 * e tutto il resto veniva buttato via SENZA DIRLO: la nota si salvava, il tag
 * scritto a mano spariva, e chi l'aveva scritto vedeva solo che «non ha
 * funzionato». Adesso passa qualunque parola; a essere controllate sono la
 * LUNGHEZZA e la QUANTITA', che sono problemi di spazio, non di vocabolario.
 *
 * Il confronto per i doppioni ignora maiuscole e spazi: «Metro», «metro» e
 * «Metro » sono lo stesso tag, e tre pastiglie uguali su una nota sono un
 * difetto che si vede.
 */
function leggiTags(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const visti = new Set<string>();
  const out: string[] = [];
  for (const t of v) {
    const pulito = String(t ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_LEN);
    if (!pulito) continue;
    const chiave = pulito.toLowerCase();
    if (visti.has(chiave)) continue;
    visti.add(chiave);
    out.push(pulito);
    if (out.length >= MAX_TAG) break;
  }
  return out;
}

/**
 * Una data dal browser: ISO valido o niente.
 *
 * ⚠️ NEL FUSO DEL LOCALE quando il fuso non c'e' scritto. Il campo del modale
 * e' un `datetime-local` e manda «2026-03-10T09:00», senza zona: letto con
 * `new Date()` quelle sarebbero le 9 del BROWSER. Un ristoratore in viaggio,
 * o un telefono rimasto su un altro fuso, fisserebbe una scadenza a un'ora
 * che non e' quella che ha scritto — e la nota diventerebbe rossa un'ora
 * prima o dopo senza che nessuno capisca.
 *
 * ⚠️ E una data illeggibile e' «nessuna scadenza», non un errore: `new
 * Date("domani")` rende `Invalid Date` e `.toISOString()` su quello LANCIA,
 * cioe' un 500 e una nota che non si salva.
 */
function leggiQuando(v: unknown, fuso: string): string | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const d = DateTime.fromISO(t, { zone: fuso });
  return d.isValid ? d.toISO() : null;
}

/**
 * LA PERSONA A CUI SI ASSEGNA — letta dalla rubrica, non dal browser.
 *
 * ⚠️ Il nome NON arriva dal modale: arriva da `team`. Chi manda la richiesta
 * potrebbe scrivere qualunque nome accanto a qualunque id, e la nota direbbe
 * «assegnata a Marco» mentre l'email parte a un altro. Qui si legge l'id e si
 * prende quello che la rubrica dice.
 *
 * ⚠️ E si ricontrolla che sia assegnabile. L'elenco nel modale lo filtra gia',
 * ma un elenco e' un suggerimento: la regola vale dove si scrive.
 */
async function personaDaAssegnare(
  id: unknown,
  ambito: Parameters<typeof leggi>[1],
): Promise<{ id: string; name: string; email: string } | null> {
  const x = String(id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(x)) return null;
  const { data } = await leggi("team", ambito, "id, name, email, category, active").eq("id", x).maybeSingle();
  const p = data as { id?: string; name?: string; email?: string } | null;
  if (!p || !assegnabile(data as never)) return null;
  return { id: String(p.id), name: String(p.name ?? ""), email: String(p.email ?? "") };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

// GET /api/admin/notes — tutte le note, attive prima poi le fatte, recenti in cima.
export const GET: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();

  const ambito = await ambitoDiRichiesta(request, staff);
  // ⚠️ DALLA PIU' VECCHIA ALLA PIU' NUOVA, e le fatte in fondo. Una
  // lavagnetta si legge come e' stata scritta: la riga di stamattina sotto
  // quella di ieri, come su un foglio appeso al muro. Al contrario — le nuove
  // in cima — una nota rimasta li' da una settimana scivolava verso il basso
  // ogni volta che qualcuno ne scriveva un'altra, cioe' proprio quella che
  // andava fatta per prima spariva per prima.
  const { data, error } = await conRipiego({}, (_c, select) =>
    leggi("admin_notes", ambito, select)
      .order("done", { ascending: true })
      .order("created_at", { ascending: true }));

  if (error) return json({ error: await msg("err.read") }, 500);
  // ⚠️ Il permesso viaggia col dato, e non lo si deduce lato browser da un
  // ruolo scritto nell'HTML: e' la stessa risposta che decide se la DELETE
  // passera', quindi quello che si vede e quello che si puo' fare non possono
  // dire due cose diverse.
  return json({ notes: data ?? [], canDelete: puoCancellare(staff) });
};

// POST /api/admin/notes — crea una nota. Autore = email dello staff loggato.
export const POST: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  // Cancellazione via POST: il firewall dell'hosting blocca il metodo
  // DELETE dai browser mobili (403 prima di arrivare all'app), quindi la
  // suppression viaggia come POST { delete_id }.
  const delId = String(body.delete_id ?? "");
  if (delId) {
    if (!puoCancellare(staff)) return nonAutorizzato();
    if (!/^[0-9a-f-]{36}$/i.test(delId)) return json({ error: await msg("err.id") }, 400);
    const { error } = await cancella("admin_notes", ambito).eq("id", delId);
    if (error) return json({ error: "Suppression impossible : " + String(error.message ?? "") }, 500);
    return json({ ok: true });
  }

  const content = String(body.content ?? "").trim();
  if (!content) return json({ error: await msg("err.noteEmpty") }, 400);
  // ⚠️ Il NOME se c'e', l'email solo come ripiego. Su una lavagnetta la firma
  // serve a sapere a chi chiedere, e «admin@moodd.online» e' il nome di una
  // casella, non di una persona: in cucina non si chiama nessuno cosi'.
  // Il nome si copia nella nota al momento in cui la si scrive, e non si
  // rilegge ogni volta dall'utente: la firma di una nota di marzo deve
  // restare quella di marzo anche se poi la persona cambia nome o se ne va.
  const author = (staff.nome || staff.email || "").slice(0, 120) || null;
  const tags = leggiTags(body.tags);
  const repeat = leggiRicorrenza(body.repeat);
  // ⚠️ Una regola senza una prima scadenza non succede mai: «ogni lunedi' alle
  // 9» vuol dire che la prima volta e' lunedi' prossimo, e quel conto lo fa il
  // server. Lasciandolo al browser, due computer con l'orologio diverso
  // darebbero due prime scadenze diverse per la stessa nota.
  const fuso = await fusoDi(ambito);
  let due = leggiQuando(body.due_at, fuso);
  if (repeat && !due) due = prossima(repeat, new Date().toISOString(), fuso);

  const chi = await personaDaAssegnare(body.assigned_to, ambito);

  const { data, error } = await conRipiego(
    {
      tags: tags.length ? tags : null, due_at: due, repeat,
      assigned_to: chi?.id ?? null, assigned_name: chi?.name ?? null,
    },
    (campi, select) =>
      inserisci("admin_notes", ambito, { content: content.slice(0, MAX_LEN), author, ...campi })
        .select(select).single(),
  );

  if (error || !data) return json({ error: await msg("err.create") }, 500);
  // ⚠️ DOPO il salvataggio, e senza aspettarla. La nota e' gia' sulla
  // lavagnetta: un'email lenta — o un Resend non configurato — non deve far
  // girare la rotella a chi ha appena premuto «Ajouter».
  if (chi) void avvisa(chi, content, author, due, repeat, ambito);
  return json({ note: data });
};

/** L'email a chi riceve la nota: una riga sola, usata da POST e da PUT.
 *  ⚠️ La scadenza e la ricorrenza si scrivono in chiaro, non si rimandano a
 *  una pagina: chi riceve non ha un accesso al pannello, e «vedi la nota» per
 *  lui non vuol dire niente. */
async function avvisa(
  chi: { name: string; email: string },
  testo: string,
  daParteDi: string | null,
  due: string | null,
  repeat: unknown,
  ambito: Parameters<typeof leggi>[1],
): Promise<void> {
  const fuso = await fusoDi(ambito);
  const r = leggiRicorrenza(repeat);
  const lingua = await adminLang();
  const tr = adminT(lingua);
  const loc = ADMIN_LOCALE[lingua] ?? "fr-BE";
  // ⚠️ I nomi dei giorni e dei mesi con luxon, che e' gia' qui: `Intl` sul
  // server dipende dai dati di localizzazione del runtime, e un Node compilato
  // stretto risponde «Monday» in francese senza dire niente.
  const nomeGiorno = (dow: number) => DateTime.fromObject({ weekday: dow as 1 }).setLocale(loc).toFormat("cccc");
  const nomeMese = (m: number) => DateTime.fromObject({ month: m }).setLocale(loc).toFormat("LLLL");
  await emailNotaAssegnata({
    location_id: ambito.modo === "sede" ? ambito.id : null,
    a: chi.email,
    nomeDestinatario: chi.name,
    testo,
    daParteDi: daParteDi || "",
    quando: due ? DateTime.fromISO(due, { zone: fuso }).toFormat("dd/LL/yyyy HH:mm") : null,
    // ⚠️ La regola IN PAROLE, con la stessa funzione che scrive il
    // bigliettino nella colonna: «chaque lundi a 09:00». Prima diceva
    // «settimana · 09:00» — la regola mezza tradotta e mezza in codice, cioe'
    // una frase che chi la riceve deve interpretare.
    ripete: r ? descrivi(r, { t: tr, giorno: nomeGiorno, mese: nomeMese }) : null,
  });
}

// PUT /api/admin/notes — modifica una nota: done (fatto/da fare) e/o content.
export const PUT: APIRoute = async ({ request }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: await msg("err.request") }, 400);
  }

  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  const campi: Record<string, unknown> = {};
  if ("done" in body) {
    campi.done = !!body.done;
    // ⚠️ Si azzera alla riapertura. Lasciandolo, una nota rimessa fra quelle
    // da fare resterebbe «fatta il 3 marzo» per sempre: il conto di marzo
    // continuerebbe a contarla, e quello della settimana in cui verra'
    // chiusa davvero la perderebbe.
    campi.done_at = campi.done ? new Date().toISOString() : null;
    // CHI l'ha spuntata, col nome se c'e' — come la firma di chi la scrive.
    campi.done_by = campi.done ? (staff.nome || staff.email || "").slice(0, 120) || null : null;

    // ---- UNA NOTA RICORRENTE NON SI CHIUDE: AVANZA ----
    // «Ogni lunedi' ordinare la farina» non e' una cosa che finisce. Spuntata,
    // la riga resta fra quelle da fare con la scadenza di lunedi' prossimo:
    // una lavagnetta che si svuota di cio' che torna ogni settimana e' una
    // lavagnetta che ogni settimana qualcuno deve riscrivere.
    // ⚠️ `done_at` e `done_by` si scrivono lo stesso, e qui vogliono dire
    // «l'ULTIMA volta, e da chi»: senza, di una nota che torna da mesi non
    // resterebbe traccia di nessuno dei giri.
    // ⚠️ Il calcolo e' sul server e parte da ADESSO, non dalla scadenza
    // vecchia: una nota in ritardo di tre settimane tornerebbe lunedi'
    // scorso, cioe' subito rossa, e cosi' via per tre giri a vuoto.
    if (campi.done) {
      const { data: ora } = await leggi("admin_notes", ambito, "id, repeat, content, assigned_to, assigned_name")
        .eq("id", id).maybeSingle();
      const riga = ora as { repeat?: unknown; content?: string; assigned_to?: string } | null;
      const regola = leggiRicorrenza(riga?.repeat);
      if (regola) {
        const dopo = prossima(regola, new Date().toISOString(), await fusoDi(ambito));
        if (dopo) {
          campi.done = false;
          campi.due_at = dopo;
          // ⚠️ IL GIRO SUCCESSIVO SI ANNUNCIA DI NUOVO. «Ogni lunedi'
          // ordinare la farina» assegnata a Marco e' un promemoria
          // settimanale: avvisarlo solo la prima volta vorrebbe dire che da
          // martedi' in poi la nota torna e nessuno glielo dice.
          // La si manda QUI, cioe' quando la nota riparte davvero — non da un
          // cron che debba sapere quali note esistono.
          const chi2 = await personaDaAssegnare(riga?.assigned_to, ambito);
          if (chi2) {
            void avvisa(chi2, String(riga?.content ?? ""),
              (staff.nome || staff.email || ""), dopo, riga?.repeat, ambito);
          }
        }
      }
    }
  }
  // ⚠️ Anche le ETICHETTE. Senza, aprire una nota per correggerle e premere
  // «Enregistrer» salvava il testo e lasciava le etichette com'erano: il
  // modale diceva di averle cambiate, il database no — e la differenza si
  // vedeva solo ricaricando la pagina.
  if ("tags" in body) {
    const t2 = leggiTags(body.tags);
    campi.tags = t2.length ? t2 : null;
  }
  if ("due_at" in body) campi.due_at = leggiQuando(body.due_at, await fusoDi(ambito));
  if ("repeat" in body) campi.repeat = leggiRicorrenza(body.repeat);

  // ---- L'ASSEGNAZIONE ----
  // ⚠️ L'email parte SOLO SE LA PERSONA CAMBIA. Senza questo confronto, ogni
  // «Enregistrer» riscriverebbe a chi gia' sapeva: correggere una virgola in
  // una nota diventa un'email in piu' per Marco, e dopo tre volte Marco
  // smette di aprirle.
  let daAvvisare: { name: string; email: string } | null = null;
  if ("assigned_to" in body) {
    const chi = await personaDaAssegnare(body.assigned_to, ambito);
    campi.assigned_to = chi?.id ?? null;
    campi.assigned_name = chi?.name ?? null;
    const { data: prima } = await leggi("admin_notes", ambito, "assigned_to").eq("id", id).maybeSingle();
    const vecchio = String((prima as { assigned_to?: string } | null)?.assigned_to ?? "");
    if (chi && chi.id !== vecchio) daAvvisare = chi;
  }
  if ("content" in body) {
    const c = String(body.content ?? "").trim();
    if (!c) return json({ error: await msg("err.noteEmpty") }, 400);
    campi.content = c.slice(0, MAX_LEN);
  }
  if (Object.keys(campi).length === 0) return json({ error: await msg("err.nothing") }, 400);

  // ⚠️ Il ripiego toglie la colonna mancante anche da cio' che SCRIVE, non
  // solo da cio' che rilegge: scriverla su una tabella che non ce l'ha
  // fallisce allo stesso modo del `select`, e il secondo tentativo morirebbe
  // come il primo — su un cliente senza la #78 la spunta avrebbe smesso di
  // funzionare del tutto, non «senza statistica».
  const { data, error } = await conRipiego(campi, (c, select) =>
    aggiorna("admin_notes", ambito, c).eq("id", id).select(select).single());

  if (error || !data) return json({ error: await msg("err.update") }, 500);
  if (daAvvisare) {
    const d = data as { content?: string; due_at?: string | null; repeat?: unknown };
    void avvisa(daAvvisare, String(d.content ?? ""), (staff.nome || staff.email || ""),
      d.due_at ?? null, d.repeat, ambito);
  }
  return json({ note: data });
};

// DELETE /api/admin/notes?id=... — elimina una nota.
export const DELETE: APIRoute = async ({ request, url }) => {
  const staff = await verificaStaff(request);
  if (!staff) return nonAutorizzato();
  const ambito = await ambitoDiRichiesta(request, staff);

  const id = url.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: await msg("err.id") }, 400);

  const { error } = await cancella("admin_notes", ambito).eq("id", id);
  if (error) return json({ error: "Suppression impossible : " + String(error.message ?? "") }, 500);
  return json({ ok: true });
};
