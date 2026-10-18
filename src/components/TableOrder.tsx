import { useState, useEffect, useRef } from "react";
import OrderApp from "./OrderApp";
import { urlConSede } from "../lib/sedeUrl";
import { piattiInVetrina } from "../lib/vetrinaRegole";
import { testoPiatto } from "../lib/i18nMenu";
import type { TestiConto } from "../lib/contoTesti";

/* ⚠️ IL MENU LO TIPIZZA `OrderApp`, non `lib/db`. Importarlo da la' —
   anche solo come tipo — metterebbe in quest’isola un percorso verso
   `db.ts`, che crea il client Supabase ALL’IMPORT e lancia senza le
   variabili d’ambiente. OrderApp si dichiara i suoi tipi in casa per questo
   motivo esatto; qui si riusano i suoi. */
type MenuDiOrderApp = React.ComponentProps<typeof OrderApp>["menu"];
type PiattoDiOrderApp = MenuDiOrderApp[number]["items"][number];

/**
 * ORDINARE DAL PROPRIO TAVOLO — scelta, dati, pagamento.
 *
 * ⚠️ PRIMA IL MENU. Chi inquadra il QR vuole vedere cosa c’e’ da mangiare,
 * non compilare un modulo per poterlo vedere: la versione di prima chiedeva
 * tavolo, nome, coperti ed email PRIMA della carta, e un modulo davanti al
 * menu e’ il punto in cui la gente rimette il telefono in tasca. In piu’
 * apriva la sessione subito, e chi guardava e se ne andava restava «seduto»
 * nel piano sala per tutta la sera.
 *
 * Adesso: si sceglie (il menu di `OrderApp`), poi si dice chi si e’ —
 * tavolo e coperti li disegna questa pagina dentro il pannello dei dati di
 * `OrderApp`, nome ed email sono i suoi — e la sessione si apre solo quando
 * si preme per pagare (`apriSessione`).
 *
 * ⚠️ DUE MODULI DIVERSI, decisi dai DATI e non da un interruttore: dove il
 * piano sala ha dei tavoli si sceglie il proprio, dove non ne ha si da' solo
 * il nome.
 *
 * ⚠️ E LA SESSIONE SI RIPRENDE. Il `reservation_id` resta nel telefono
 * (`ricorda`, quattro ore): chi riordina a fine cena ritrova lo stesso conto
 * invece di aprirne un secondo — che conterebbe due volte i coperti della
 * sera. Il server la riusa solo se e' di oggi e ancora aperta.
 */

/** Le parole di questa pagina. Le passa la pagina, che e' del cliente. */
export interface TestiSessione {
  titolo: string;
  tavolo: string;
  tavoloAiuto: string;
  persone: string;
  /** Il bottone che apre la scelta, e il titolo del riquadro che si apre. */
  scegli: string;
  scegliTavolo: string;
  /** Si e’ gia’ scelto, e si vuole cambiare. */
  cambia: string;
  /** Chiudere il riquadro della scelta senza scegliere. */
  chiudi: string;
  /** Nei dati, al posto di «quanti siete», se il tavolo e' gia' aperto da
   *  un altro telefono: ci si unisce, e l'ordine si aggiunge al suo. */
  tavoloUnito: string;
  /** Messaggi d'errore, tradotti: il server risponde in una lingua sola. */
  errCampi: string;
  errChiuso: string;
  errTavolo: string;
  errGenerico: string;
  /** Il modale a servizio chiuso: titolo, «riapre alle {ora}», «per oggi e’
   *  finita», e il bottone che ricarica per riprovare. */
  chiusoTitolo: string;
  chiusoRiapre: string;
  chiusoOggi: string;
  aggiorna: string;
  /** Il locale e' aperto ma qui non si puo' pagare in nessun modo: nessuna
   *  carta pronta e nessun pagamento sul posto. Dice a chi rivolgersi. */
  nonDisponibileTitolo: string;
  nonDisponibileTesto: string;
  /** «Appeler le serveur»: la scritta che gira attorno alla campanella (ed
   *  e' anche il suo nome per chi non vede), il titolo della scelta del
   *  tavolo, la conferma («{t}» = il tavolo) e l'errore. */
  chiama: string;
  chiamaTitolo: string;
  chiamaFatto: string;
  chiamaErr: string;
  /** Sala SENZA tavoli: si chiama col nome. Il titolo del riquadro, il
   *  segnaposto del campo, il bottone, e la conferma (senza tavolo). */
  chiamaNomeTitolo: string;
  chiamaNome: string;
  chiamaInvia: string;
  chiamaFattoNome: string;
  /** Si e' gia' chiamato: «potrai richiamare tra {tempo}» (es. «4:32»). */
  chiamaAttendi: string;
}

interface Props {
  menu: MenuDiOrderApp;
  /** Le stringhe di OrderApp, costruite dalla pagina come per /order. */
  testiOrdine: React.ComponentProps<typeof OrderApp>["t"];
  testi: TestiSessione;
  lang: string;
  sede?: string;
  /**
   * I TAVOLI DELLA SALA, come li ha disegnati il ristoratore.
   *
   * ⚠️ L’ELENCO, NON UN «CI SONO I TAVOLI: SÌ/NO». Un campo libero al tavolo
   * produce «7», «tavolo 7», «7 terrazza» e «8» battuto per sbaglio: il
   * server rifiuta i primi tre e accetta il quarto, che e’ il peggiore — i
   * piatti partono per un tavolo dove siede qualcun altro.
   *
   * Vuoto = sala senza mappa: si chiede solo il nome.
   */
  tavoli: { id: string; name: string; zone: string }[];
  /** Si avvisa il cliente quando e' pronto → l'email diventa obbligatoria. */
  avvisa: boolean;
  /** Il tavolo scritto nel QR (`?table=7`). Vuoto = QR generico. */
  tavoloDaUrl?: string;
  /** I tavoli gia' aperti dal QR adesso, con le INIZIALI di chi c'e'
   *  seduto (mai i nomi: arrivano al telefono di chiunque). */
  aperti?: { id: string; iniziali: string[] }[];
  /**
   * IL SERVIZIO E’ CHIUSO ADESSO — lo calcola la pagina lato server con la
   * stessa regola delle due rotte. `null` = aperto. `riapre` = l’ora di
   * riapertura di OGGI, `null` se per oggi e’ finita.
   */
  chiuso?: { riapre: string | null; motivo?: "orario" | "pagamento" } | null;
  /** Si torna da Stripe col tasto «indietro» (`?ripresa=1`): si apre sui
   *  dati, col carrello di prima, invece che sul menu. */
  ripresa?: boolean;
  /** La foto del locale: compare SOLO se nessun piatto ha una foto da far
   *  girare nella vetrina. Vuoto = nessuna, e nessun riquadro. */
  immagine?: string;
  sceltaFormato?: "pulsanti" | "modale";
  foto?: boolean;
  carrelloDettagliato?: boolean;
  /** Il totale ripetuto sotto le note (vedi OrderApp). */
  totaleSottoLeNote?: boolean;
  /** La campanella «Appeler le serveur» accanto alla barra del carrello
   *  (interruttore nei Réglages). Col piano sala si sceglie il tavolo,
   *  senza si dice il nome. Mai a servizio chiuso. */
  chiamata?: boolean;
  /** Minuti prima di poter richiamare (Réglages). Il conto vero lo manda il
   *  server a ogni chiamata; questo e' solo il ripiego. */
  attesaChiamata?: number;
  pagamento?: React.ComponentProps<typeof OrderApp>["pagamento"];
  /** Il conto aperto (Réglages, `opzioniTavolo().conto`): si ordina e si paga
   *  alla fine. Solo col tavolo scelto. Vedi conto-aperto.md. */
  conto?: boolean;
  /** Le sue parole, dal motore (`lib/contoTesti.ts`). */
  testiConto?: TestiConto;
}

/** Quello che il server dice del conto del tavolo a chi ne fa parte. */
interface DatiConto {
  stato: string;
  code: string;
  reservation_id: string;
  tavolo_id: string;
  invito_svg: string;
  invito_url: string;
  ordinato: number;
  persone: number;
  invii: {
    numero: number;
    inviato: boolean;
    righe: { nome: string; piatti: { nome: string; qty: number; prezzo_cents: number }[]; totale_cents: number; mio: boolean; token?: string }[];
  }[];
  totale_cents: number;
}
/** Il conto del tavolo visto da questa pagina: nessuno, di altri, il mio. */
type StatoContoPagina =
  | { tipo: "nessuno" }
  | { tipo: "altri"; iniziale: string }
  | { tipo: "membro"; dati: DatiConto };
/** Il telefono fa parte di un conto: quale, e col codice (l'autorizzazione). */
interface Membro { reservationId: string; code: string; tableId: string }

const CHIAVE = "restohub-tavolo";
/** Tavolo e coperti scelti, per ritrovarli tornando da Stripe. */
const CHIAVE_SCELTA = "restohub-tavolo-scelta";
/** Il nome dato alla campanella (sala senza tavoli): la seconda chiamata
 *  della sera non lo richiede da capo. */
const CHIAVE_NOME_CHIAMATA = "restohub-chiamata-nome";
/** Fino a quando (ms) non si puo' richiamare: sopravvive a un ricaricamento,
 *  se no bastava ricaricare la pagina per far suonare di nuovo il tablet. */
const CHIAVE_ATTESA_CHIAMATA = "restohub-chiamata-fino";
/** Il conto aperto di cui questo telefono fa parte (id, codice, tavolo). */
const CHIAVE_CONTO = "restohub-conto";
/** I token degli ordini fatti da QUESTO telefono sul conto: solo quelli si
 *  possono togliere, finche' il loro invio non e' partito. */
const CHIAVE_CONTO_MIEI = "restohub-conto-miei";

/** «4:32», «0:07». */
function minSec(secondi: number): string {
  const s = Math.max(0, Math.ceil(secondi));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * LA MEMORIA DEL TELEFONO: quattro ore, poi si dimentica.
 *
 * ⚠️ NON `sessionStorage`, com'era. Quella vive quanto la SCHEDA: chi pagava,
 * chiudeva e riscansionava il QR per il dolce si ritrovava una scheda nuova e
 * vuota — il tavolo da scegliere da capo, e peggio, il SUO tavolo spento
 * nella griglia come «gia' aperto da altri», perche' la pagina non sapeva
 * piu' di averlo aperto lei (16/10/2026).
 *
 * ⚠️ Ma NEMMENO `localStorage` per sempre: domani, allo stesso ristorante,
 * quel telefono si ritroverebbe il tavolo di ieri gia' scelto, e i piatti
 * partirebbero per un tavolo dove siede qualcun altro. Quattro ore coprono
 * una cena lunga; dopo, la memoria si cancella da sola alla prima lettura.
 *
 * ⚠️ Ogni accesso sta in un `try`: in navigazione privata (o con i dati del
 * sito bloccati) leggere o scrivere LANCIA. Si ordina lo stesso, non si
 * ricorda.
 */
const MEMORIA_MS = 4 * 60 * 60 * 1000;

function ricorda(chiave: string, valore: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(chiave, JSON.stringify({ v: valore, fino: Date.now() + MEMORIA_MS }));
  } catch {
    /* navigazione privata: si ordina lo stesso, non si ricorda */
  }
}

function richiama(chiave: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(chiave);
    if (!raw) return null;
    const o = JSON.parse(raw) as { v?: unknown; fino?: unknown };
    if (!o || typeof o.fino !== "number" || o.fino < Date.now() || typeof o.v !== "string") {
      window.localStorage.removeItem(chiave);
      return null;
    }
    return o.v;
  } catch {
    return null;
  }
}

function leggiScelta(): { tavolo?: string; persone?: string } {
  try {
    return JSON.parse(richiama(CHIAVE_SCELTA) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Fin dove si sceglie con un tocco: 1–5 e poi «6+», sei pastiglie su UNA
 *  riga sola. Al tavolo quasi tutti sono da uno a cinque; due righe da dieci
 *  occupavano mezzo schermo per numeri che non sceglie quasi nessuno.
 *  ⚠️ Oltre, NON si taglia: un tavolo da otto esiste (due tavoli uniti), e
 *  scrivere cinque al posto di otto vorrebbe dire tre coperti in meno nel
 *  conto della sera, ogni volta. «6+» apre il campo e si scrive il numero. */
const PERSONE_PASTIGLIE = 5;

function leggiMembro(): Membro | null {
  try {
    const raw = richiama(CHIAVE_CONTO);
    const m = raw ? (JSON.parse(raw) as Membro) : null;
    return m && m.reservationId && m.code ? m : null;
  } catch {
    return null;
  }
}

function leggiMiei(): string[] {
  try {
    const a = JSON.parse(richiama(CHIAVE_CONTO_MIEI) ?? "[]");
    return Array.isArray(a) ? a.map(String).slice(-50) : [];
  } catch {
    return [];
  }
}

function euroConto(c: number): string {
  return (c / 100).toFixed(2).replace(".", ",") + " €";
}

function leggiSessione(): { id: string } | null {
  try {
    const raw = richiama(CHIAVE);
    return raw ? (JSON.parse(raw) as { id: string }) : null;
  } catch {
    return null;
  }
}

/**
 * LA VETRINA — le foto dei piatti che si possono ordinare, una alla volta.
 *
 * ⚠️ SCORRIMENTO NATIVO (`scroll-snap`), non una libreria: col dito funziona
 * come ogni galleria del telefono, e non c'e' niente da scaricare in piu'.
 * Il giro da solo e' un aiuto, non un obbligo: si FERMA al primo tocco — chi
 * sta guardando una foto non deve vedersela portare via — e non parte
 * affatto con «riduci movimento» attivo o a pagina nascosta.
 *
 * Il nome sta in basso a sinistra, piccolo, su una sfumatura scura: si legge
 * su qualunque piatto, chiaro o scuro, senza coprire il piatto.
 */
function Vetrina({ foto, nomi }: { foto: { id: string; src: string; nome: string }[]; nomi: string }) {
  const binario = useRef<HTMLDivElement | null>(null);
  const toccato = useRef(false);
  const [indice, setIndice] = useState(0);
  const quante = foto.length;

  useEffect(() => {
    if (quante < 2 || typeof window === "undefined") return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const giro = window.setInterval(() => {
      const el = binario.current;
      if (!el || toccato.current || document.hidden) return;
      const prossima = (Math.round(el.scrollLeft / el.clientWidth) + 1) % quante;
      el.scrollTo({ left: prossima * el.clientWidth, behavior: "smooth" });
    }, 4500);
    return () => window.clearInterval(giro);
  }, [quante]);

  if (quante === 0) return null;
  return (
    <div className="tbl-vetrina" role="region" aria-roledescription="carousel" aria-label={nomi}>
      <div
        className="tbl-vetrina-binario"
        ref={binario}
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndice(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
        onPointerDown={() => { toccato.current = true; }}
        onTouchStart={() => { toccato.current = true; }}
      >
        {foto.map((f, i) => (
          <figure key={f.id} className="tbl-vetrina-foto" aria-label={`${i + 1} / ${quante}`}>
            {/* ⚠️ Il posto e' riservato (`width`/`height` + `aspect-ratio` nel
                CSS): senza, la carta salterebbe giu' all'arrivo di ogni foto.
                La prima subito, le altre quando servono. */}
            <img src={f.src} alt="" width={1200} height={675}
                 loading={i === 0 ? "eager" : "lazy"} decoding="async" />
            {f.nome && <figcaption className="tbl-vetrina-nome">{f.nome}</figcaption>}
          </figure>
        ))}
      </div>
      {quante > 1 && (
        <div className="tbl-vetrina-punti" aria-hidden="true">
          {foto.map((f, i) => <span key={f.id} className={i === indice ? "is-ora" : undefined} />)}
        </div>
      )}
    </div>
  );
}

export default function TableOrder({
  menu, testiOrdine, testi, lang, sede = "", tavoli, avvisa,
  tavoloDaUrl = "", aperti = [], chiuso = null, ripresa = false, immagine = "", sceltaFormato, foto, carrelloDettagliato, totaleSottoLeNote, chiamata = false, attesaChiamata = 5, pagamento,
  conto = false, testiConto,
}: Props) {
  /* ⚠️ LA STESSA CONVENZIONE DI `OrderApp`, non una variante: un `conSede`
     locale attorno a ogni URL. La rete che controlla che il browser dica
     sempre il punto (`tests/pubblico.test.mjs`) cerca proprio questa forma
     nelle quaranta battute prima dell’indirizzo — scritto in un altro modo,
     la chiamata resta giusta e la RETE non la vede piu’. */
  const conSede = (u: string) => urlConSede(u, sede);
  /* Su quale schermo di `OrderApp` siamo: decide vetrina e campanella. */
  const [vista, setVista] = useState<"menu" | "checkout">("menu");
  /* ⚠️ CHIUSO NON E’ SOLO «ALL’APERTURA DELLA PAGINA». Chi ha aperto il menu
     alle 14:25 e preme per pagare alle 14:35 trova la cucina chiusa: il
     server rifiuta, e qui si apre lo STESSO modale invece di una riga rossa
     in fondo al carrello — e’ la stessa notizia, e deve dirsi allo stesso
     modo. Il testo si decide quando si chiude: da qui in poi non cambia. */
  /* ⚠️ «NON SI PUO' PAGARE» SI DICE PRIMA, NON DOPO IL CARRELLO. Senza
     carta pronta e senza pagamento sul posto `/api/checkout` rifiuta ogni
     ordine — e lo scopriva il cliente al dodicesimo piatto, premendo
     «Commander» (visto il 16/10/2026). La pagina lo sa gia' dal server: lo
     dice subito, con lo stesso modale del servizio chiuso, e dice a chi
     rivolgersi invece di lasciarlo davanti a un errore. */
  const pagamentoAssente = chiuso?.motivo === "pagamento";
  const [chiusoTesto, setChiusoTesto] = useState<string | null>(
    chiuso
      ? pagamentoAssente
        ? testi.nonDisponibileTesto
        : chiuso.riapre
          ? testi.chiusoRiapre.replace("{ora}", chiuso.riapre)
          : testi.chiusoOggi
      : null,
  );
  const chiusoTitolo = pagamentoAssente ? testi.nonDisponibileTitolo : testi.chiusoTitolo;
  /* ⚠️ Tavolo e coperti si RICORDANO per la scheda: chi torna indietro da
     Stripe non deve rifare la sala. Il tavolo del QR (`?table=`) vince sempre
     su quello ricordato — e' scritto sul cartoncino davanti a lui. */
  const ricordata = leggiScelta();
  const [persone, setPersone] = useState(ricordata.persone || "2");
  const [tavolo, setTavolo] = useState(tavoloDaUrl || ricordata.tavolo || "");
  useEffect(() => {
    try {
      ricorda(CHIAVE_SCELTA, JSON.stringify({ tavolo, persone }));
    } catch {
      /* navigazione privata: si ordina lo stesso, non si ricorda */
    }
  }, [tavolo, persone]);
  /* `?ripresa=1` serve UNA volta: tolto dall'indirizzo appena letto, se no un
     ricaricamento a meta' menu riporterebbe sui dati senza motivo. */
  useEffect(() => {
    if (!ripresa) return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete("ripresa");
      window.history.replaceState(window.history.state, "", u.toString());
    } catch { /* indirizzo non riscrivibile: pazienza */ }
  }, [ripresa]);
  const conTavoli = tavoli.length > 0;
  const [sceltaAperta, setSceltaAperta] = useState(false);
  /* ⚠️ LO STESSO MODALE DEI TAVOLI PER DUE DOMANDE: «dove ordini?» e «dove
     sei seduto?» (la campanella). Due modali uguali si separerebbero alla
     prima modifica; uno solo con due modi resta lo stesso gesto. */
  const [modoScelta, setModoScelta] = useState<"ordine" | "chiamata">("ordine");
  /* ⚠️ I DUE RIQUADRI (tavoli, nome) SALGONO DAL BASSO E SCENDONO QUANDO SI
     CHIUDONO, come la scelta del formato di OrderApp e con lo stesso
     meccanismo: si mette `is-uscita`, si legge dal CSS quanto dura
     l'animazione, e solo dopo si smonta. Senza animazione (sito che non la
     veste, «riduci movimento») si chiude all'istante.
     ⚠️ `setTimeout`, mai `requestAnimationFrame`: a scheda nascosta i
     fotogrammi si fermano e il riquadro resterebbe aperto per sempre. */
  const [uscita, setUscita] = useState(false);
  const modaleRef = useRef<HTMLDivElement | null>(null);
  function chiudiRiquadro() {
    if (uscita) return;
    const fine = () => {
      setSceltaAperta(false);
      setNomeAperto(false);
      setUscita(false);
    };
    setUscita(true);
    window.setTimeout(() => {
      const el = modaleRef.current;
      const stile = el ? window.getComputedStyle(el) : null;
      const durata = stile ? parseFloat(stile.animationDuration) * 1000 : 0;
      if (!stile || stile.animationName === "none" || !durata) {
        fine();
        return;
      }
      window.setTimeout(fine, durata + 40);
    }, 0);
  }
  function apriScelta(modo: "ordine" | "chiamata") {
    /* Senza piano sala non c'e' una griglia da mostrare: si chiede il nome. */
    if (modo === "chiamata" && tavoli.length === 0) {
      setNomeAperto(true);
      return;
    }
    setModoScelta(modo);
    setSceltaAperta(true);
  }
  /* La riga che conferma la chiamata (o dice che non e' partita). */
  const [avviso, setAvviso] = useState<{ testo: string; ok: boolean } | null>(null);
  const avvisoTimer = useRef<number | undefined>(undefined);
  function mostraAvviso(testo: string, ok: boolean) {
    setAvviso({ testo, ok });
    window.clearTimeout(avvisoTimer.current);
    avvisoTimer.current = window.setTimeout(() => setAvviso(null), 6000);
  }
  const [chiamando, setChiamando] = useState(false);
  /* ⚠️ IL TIMER DELLA CAMPANELLA. Dopo una chiamata, fino a `finoA` non si
     richiama: la campanella mostra il conto alla rovescia al posto del
     disegno, e un tocco dice quanto manca invece di far suonare il tablet.
     L'attesa la sceglie il ristoratore (1, 3, 5, 10 minuti) e la decide il
     SERVER (`riprova_tra`): un secondo telefono allo stesso tavolo, o uno
     ricaricato, ritrova lo stesso tempo. */
  /* ⚠️ Si legge DOPO il montaggio, non nello `useState`: il server disegna la
     campanella senza conto alla rovescia (non vede il telefono), e se il
     primo disegno nel browser fosse diverso React butterebbe via la pagina
     del server e la ridisegnerebbe da capo. */
  const [finoA, setFinoA] = useState(0);
  useEffect(() => {
    setFinoA(Number(richiama(CHIAVE_ATTESA_CHIAMATA)) || 0);
  }, []);
  const [ora, setOra] = useState(() => Date.now());
  const restanti = Math.max(0, Math.ceil((finoA - ora) / 1000));
  useEffect(() => {
    if (finoA <= Date.now()) return;
    setOra(Date.now());
    const id = window.setInterval(() => {
      const t = Date.now();
      setOra(t);
      if (t >= finoA) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [finoA]);
  function avviaAttesa(secondi: number) {
    const fino = Date.now() + Math.max(1, secondi) * 1000;
    setFinoA(fino);
    ricorda(CHIAVE_ATTESA_CHIAMATA, String(fino));
  }
  /* Sala senza tavoli: il riquadro che chiede il nome, e il nome. */
  const [nomeAperto, setNomeAperto] = useState(false);
  const [nomeChiamata, setNomeChiamata] = useState(() => {
    return richiama(CHIAVE_NOME_CHIAMATA) ?? "";
  });
  const [aiutoAperto, setAiutoAperto] = useState(false);
  /* Si e’ chiesto «piu’ di dieci»: compare il campo per dire quanti. */
  /* ⚠️ Parte gia' su «6+» se il numero ricordato e' piu' alto: chi torna da
     Stripe con «8» deve ritrovare il suo otto nel campo, non nessuna
     pastiglia accesa e un otto invisibile. */
  const [oltre, setOltre] = useState(Number(ricordata.persone) > PERSONE_PASTIGLIE);
  /* ⚠️ Il QR puo’ portare un id OPPURE un nome (`?table=7`), e in quel caso
     il quadrato deve mostrare lo stesso il tavolo giusto: si cerca per tutti
     e due. Se non si trova niente, il bottone «scegli» resta — meglio
     chiedere che mostrare un tavolo inventato. */
  const sceltoGrezzo =
    tavoli.find((t) => t.id === tavolo) ??
    tavoli.find((t) => t.name.trim().toLowerCase() === tavolo.trim().toLowerCase()) ??
    null;
  /* ⚠️ I TAVOLI GIA' APERTI NON SI SPENGONO PIU' (16/10/2026). Il caso
     normale sono amici allo stesso tavolo, ognuno col suo telefono e il suo
     conto: spegnere il tavolo aperto impediva al secondo di ordinare da dove
     era seduto. Il server aggancia gia' la stessa sessione (un tavolo, un
     conto di coperti, tanti ordini); la pagina ACCENDE il tavolo aperto nella
     griglia e mostra nella barra le iniziali di chi c'e'. */
  const idDi = (v: string) =>
    (tavoli.find((t) => t.id === v) ??
      tavoli.find((t) => t.name.trim().toLowerCase() === v.trim().toLowerCase()))?.id ?? "";
  /* Il tavolo che QUESTO telefono ha gia' aperto: per lui non e' «di altri». */
  const mioGiaAperto = leggiSessione() ? idDi(ricordata.tavolo ?? "") : "";
  /* Le iniziali per tavolo, come le manda il server: solo chi ha ORDINATO
     davvero (vedi `tavoliApertiAlQr`). ⚠️ Niente iniziale «mia» aggiunta qui
     al click su «Payer et commander»: si accendeva prima del pagamento, e
     chi tornava indietro da Stripe restava acceso senza aver ordinato. */
  const inizialiDi = (id: string): string[] => aperti.find((a) => a.id === id)?.iniziali ?? [];
  const aperto = (id: string) => aperti.some((a) => a.id === id);
  const scelto = sceltoGrezzo;
  /* Ci si UNISCE a un tavolo aperto da un altro telefono: «quanti siete»
     non si chiede (il server tiene i coperti di chi l'ha aperto). */
  const siUnisce = scelto !== null && scelto.id !== mioGiaAperto && aperti.some((a) => a.id === scelto.id);
  /* ⚠️ «Pronto» vuol dire un tavolo che ESISTE, non un campo pieno: un
     `?table=` storto nel QR lascerebbe un testo che nessun tavolo conferma. */
  const pronto = Number(persone) >= 1 && (!conTavoli || scelto !== null);
  /* Le foto della vetrina: i piatti ordinabili che ne hanno una, col nome
     nella lingua della pagina. Nessuno → la foto del locale, senza nome. */
  const vetrina = (() => {
    const piatti = piattiInVetrina<PiattoDiOrderApp>(menu);
    if (piatti.length > 0) {
      return piatti.map((p) => ({ id: p.id, src: String(p.image_url), nome: testoPiatto(p, lang).name }));
    }
    return immagine ? [{ id: "locale", src: immagine, nome: "" }] : [];
  })();

  /* ═════════ IL CONTO APERTO (conto-aperto.md) ═════════
     Il telefono sa di quale conto fa parte (`CHIAVE_CONTO`: id e codice). Il
     server, a ogni domanda, ricontrolla il codice: e' l'autorizzazione, e
     senza non si vede ne' si aggiunge niente.
     ⚠️ La memoria si legge DOPO il montaggio, come l'attesa della campanella:
     il server disegna la pagina senza sapere niente del telefono. */
  const tc = testiConto ?? null;
  const contoAttivo = conto && conTavoli && tc !== null;
  const [membro, setMembro] = useState<Membro | null>(null);
  const [statoConto, setStatoConto] = useState<StatoContoPagina | null>(null);
  const [additionAperta, setAdditionAperta] = useState(false);
  const [codiceScritto, setCodiceScritto] = useState("");
  const [erroreConto, setErroreConto] = useState<string | null>(null);
  const [msgConto, setMsgConto] = useState<string | null>(null);
  const [lavoroConto, setLavoroConto] = useState(false);
  useEffect(() => {
    setMembro(leggiMembro());
  }, []);
  function salvaMembro(m: Membro | null) {
    if (m) ricorda(CHIAVE_CONTO, JSON.stringify(m));
    else {
      try { window.localStorage.removeItem(CHIAVE_CONTO); } catch { /* pazienza */ }
    }
    setMembro(m);
  }
  async function chiediTab(corpo: Record<string, unknown>): Promise<{ ok: boolean; status: number; d: Record<string, unknown> }> {
    const res = await fetch(conSede("/api/table-tab"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    const d = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, d };
  }
  async function caricaConto(m: Membro | null = membro) {
    if (!contoAttivo || !scelto) return;
    try {
      const { d } = await chiediTab({
        azione: "stato",
        table: scelto.id,
        ...(m ? { reservation_id: m.reservationId, code: m.code } : {}),
        miei: leggiMiei(),
      });
      const c = d.conto as (DatiConto & { membro?: boolean; iniziale?: string; errore?: string }) | null | undefined;
      if (!c) {
        /* Nessun conto qui: chiuso dal cameriere (incassato, o rifiutato), o
           mai aperto. Il telefono lo dimentica, e se ne faceva parte lo dice:
           un'addizione che sparisce senza una parola sembra un guasto. */
        if (m && m.tableId === scelto.id) {
          salvaMembro(null);
          setAdditionAperta(false);
          if (tc) mostraAvviso(tc.chiuso, true);
        }
        setStatoConto({ tipo: "nessuno" });
        return;
      }
      if (c.membro) {
        setStatoConto({ tipo: "membro", dati: c });
        return;
      }
      // Un conto c'e', ma non e' (piu') il mio: il codice e' cambiato o il
      // conto e' un altro. ⚠️ Bloccato non vuol dire «non sei dei nostri».
      if (m && c.errore && c.errore !== "bloccato") salvaMembro(null);
      setStatoConto({ tipo: "altri", iniziale: String(c.iniziale ?? "") });
    } catch {
      /* rete assente: la pagina resta com'era */
    }
  }
  useEffect(() => {
    if (!contoAttivo) return;
    void caricaConto();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contoAttivo, scelto?.id, membro?.code, membro?.reservationId]);
  /* ⚠️ IN ATTESA DEL CAMERIERE, O CON L'ADDIZIONE APERTA, SI RICONTROLLA
     OGNI 15 SECONDI: la validazione arriva dal tablet, e il cliente deve
     vederla senza ricaricare la pagina. Mai a scheda nascosta. */
  const inAttesaConto = statoConto?.tipo === "membro" && statoConto.dati.stato === "pending";
  useEffect(() => {
    if (!contoAttivo || !(additionAperta || inAttesaConto)) return;
    const id = window.setInterval(() => {
      if (!document.hidden) void caricaConto();
    }, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contoAttivo, additionAperta, inAttesaConto, membro?.code]);
  /* Il QR «Inviter» porta `?code=07`: si entra nel conto senza scrivere
     niente. `?addition=1` e' il ritorno dopo un ordine sul conto. Tutti e due
     servono UNA volta: si tolgono dall'indirizzo appena letti. */
  useEffect(() => {
    if (!contoAttivo) return;
    let cod = "";
    try {
      const u = new URL(window.location.href);
      cod = (u.searchParams.get("code") ?? "").trim();
      const add = u.searchParams.get("addition") === "1";
      if (cod || add) {
        u.searchParams.delete("code");
        u.searchParams.delete("addition");
        window.history.replaceState(window.history.state, "", u.toString());
      }
      if (add) setAdditionAperta(true);
    } catch { /* indirizzo non leggibile: pazienza */ }
    if (cod && scelto) void unisciti(cod);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contoAttivo]);

  async function unisciti(cod: string): Promise<Membro | null> {
    if (!tc || !scelto) return null;
    setErroreConto(null);
    setLavoroConto(true);
    try {
      const { ok, d } = await chiediTab({ azione: "unisciti", table: scelto.id, code: cod });
      if (ok && d.reservation_id) {
        const m = { reservationId: String(d.reservation_id), code: String(d.code), tableId: String(d.table_id) };
        salvaMembro(m);
        setCodiceScritto("");
        await caricaConto(m);
        return m;
      }
      const e = String(d.error ?? "");
      setErroreConto(e === "bloque" ? tc.errBloccato : e === "code" ? tc.errCodice : e.includes("ferme") ? testi.errChiuso : tc.errGenerico);
      return null;
    } catch {
      setErroreConto(tc.errGenerico);
      return null;
    } finally {
      setLavoroConto(false);
    }
  }

  /** «Ouvrir un compte»: apre il conto sul tavolo e rende il codice. */
  async function inviaApri(chi: { nome: string; email: string }): Promise<
    { ok: true; reservationId: string; tableId: string; code: string } | { ok: false; errore: string }
  > {
    if (!tc || !scelto) return { ok: false, errore: testi.errGenerico };
    try {
      const { ok, status, d } = await chiediTab({
        azione: "apri", table: scelto.id, people: Number(persone), name: chi.nome,
        ...(chi.email ? { email: chi.email } : {}), lang,
      });
      if (!ok) {
        const e = String(d.error ?? "");
        /* ⚠️ QUALCUNO HA APERTO UN SECONDO PRIMA: il carrello resta, e la
           pagina mostra «Rejoindre» col campo del codice. */
        if (status === 409 && e.includes("deja")) {
          setStatoConto({ tipo: "altri", iniziale: String(d.iniziale ?? "") });
          return { ok: false, errore: tc.giaAperto.replace("{i}", String(d.iniziale ?? "")) };
        }
        if (e.includes("ferme")) {
          setChiusoTesto(testi.errChiuso);
          return { ok: false, errore: testi.errChiuso };
        }
        return { ok: false, errore: e.includes("email") || e.includes("nom") || e.includes("personnes") ? testi.errCampi : tc.errGenerico };
      }
      const m = { reservationId: String(d.reservation_id), code: String(d.code), tableId: String(d.table_id) };
      salvaMembro(m);
      // La stessa sessione per un eventuale «Commander et payer» dopo.
      ricorda(CHIAVE, JSON.stringify({ id: m.reservationId }));
      return { ok: true, reservationId: m.reservationId, tableId: m.tableId, code: m.code };
    } catch {
      return { ok: false, errore: tc.errGenerico };
    }
  }

  /** «Ajouter à l'addition»: il conto c'e' gia'. ⚠️ Se il telefono ordina da
   *  un altro tavolo (unito a quello del conto), prima lo si aggiunge alla
   *  sessione: il server accetta l'ordine solo da un tavolo del conto. */
  async function inviaAggiungi(): Promise<
    { ok: true; reservationId: string; tableId: string; code: string } | { ok: false; errore: string }
  > {
    if (!tc || !scelto || !membro) return { ok: false, errore: testi.errGenerico };
    let m: Membro | null = membro;
    if (scelto.id !== m.tableId) m = await unisciti(m.code);
    if (!m) return { ok: false, errore: tc.errGenerico };
    return { ok: true, reservationId: m.reservationId, tableId: scelto.id, code: m.code };
  }

  function contoFatto(r: { token: string }) {
    if (!r.token) return;
    ricorda(CHIAVE_CONTO_MIEI, JSON.stringify([...leggiMiei(), r.token].slice(-50)));
  }

  async function togliDalConto(token: string) {
    if (!tc || !scelto || !membro) return;
    setMsgConto(null);
    try {
      const { ok, d } = await chiediTab({ azione: "togli", table: scelto.id, code: membro.code, token });
      if (!ok) setMsgConto(String(d.error ?? "").includes("envoye") ? tc.errTogli : tc.errGenerico);
      await caricaConto();
    } catch {
      setMsgConto(tc.errGenerico);
    }
  }

  /** «Demander l'addition»: la stessa campanella, con il motivo. */
  async function chiediAddizione() {
    if (!tc || !scelto) return;
    setMsgConto(null);
    setLavoroConto(true);
    try {
      const res = await fetch(conSede("/api/table-call"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ table: scelto.id, reason: "bill" }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) setMsgConto(tc.chiesto);
      else if (String(d.error ?? "").includes("ferme")) setMsgConto(testi.errChiuso);
      else setMsgConto(tc.errChiedi);
    } catch {
      setMsgConto(tc.errChiedi);
    } finally {
      setLavoroConto(false);
    }
  }

  /* Per OrderApp: «Ouvrir un compte» accanto al pagamento, o «Ajouter à
     l'addition» al suo posto. Finche' non si sa com'e' il tavolo, niente. */
  const contoPerOrderApp = !contoAttivo || !tc || !scelto || !statoConto
    ? null
    : statoConto.tipo === "membro"
      ? { modo: "aggiungi" as const, etichetta: tc.aggiungi, invio: tc.invio, invia: inviaAggiungi, fatto: contoFatto }
      : statoConto.tipo === "nessuno"
        ? { modo: "apri" as const, etichetta: tc.apri, sotto: tc.apriSotto, invio: tc.invio, invia: inviaApri, fatto: contoFatto }
        : null;
  const nelConto = statoConto?.tipo === "membro";
  const contoDiAltri = statoConto?.tipo === "altri" ? statoConto : null;

  async function apriSessione(chi: { nome: string; email: string }): Promise<
    { ok: true; reservationId: string; tableId: string | null } | { ok: false; errore: string }
  > {
    try {
      /* ⚠️ Il punto viaggia con la chiamata: senza, un gruppo con piu' sedi
         aprirebbe il tavolo 7 della PRIMA. Stesso inciampo gia' pagato da
         /api/checkout e /api/coupon. */
      const res = await fetch(conSede("/api/table-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: chi.nome,
          people: Number(persone),
          /* ⚠️ L’ID del tavolo, mai il nome: due zone possono avere tutte e
             due un «3», e un tavolo rinominato stasera manderebbe i piatti
             altrove. */
          ...(conTavoli && scelto ? { table: scelto.id } : {}),
          ...(chi.email ? { email: chi.email } : {}),
          lang,
          /* ⚠️ La sessione di prima, se c'e'. Senza tavoli e' l'unica chiave
             che il server ha per ritrovare lo stesso conto: col tavolo gli
             basta il numero. */
          ...(leggiSessione()?.id ? { reservation_id: leggiSessione()?.id } : {}),
        }),
      });
      const dati = (await res.json()) as {
        reservation_id?: string; table_id?: string | null; error?: string;
      };
      if (!res.ok || !dati.reservation_id) {
        /* ⚠️ Il server risponde in una lingua sola, e di proposito: i suoi
           messaggi sono per i log, non per il cliente. Qui si traducono i
           casi che il cliente puo' davvero incontrare, e tutto il resto
           diventa un errore generico — mai la stringa grezza del server. */
        const e = String(dati.error ?? "");
        if (e.includes("ferme")) {
          setChiusoTesto(testi.errChiuso);
          return { ok: false, errore: testi.errChiuso };
        }
        return {
          ok: false,
          errore: e.includes("table") ? testi.errTavolo
            : e.includes("email") || e.includes("nom") || e.includes("personnes") ? testi.errCampi
            : testi.errGenerico,
        };
      }
      ricorda(CHIAVE, JSON.stringify({ id: dati.reservation_id }));
      return { ok: true, reservationId: dati.reservation_id, tableId: dati.table_id ?? null };
    } catch {
      return { ok: false, errore: testi.errGenerico };
    }
  }

  /**
   * «APPELER LE SERVEUR»: scelto il tavolo, si avvisa il tablet del locale.
   *
   * ⚠️ IL TAVOLO SI CHIEDE SOLO SE NON SI SA GIA'. Scelto in cima (o dal QR),
   * la campanella chiama subito quello: il cliente lo vede scritto nella
   * barra, e chiederglielo di nuovo a ogni chiamata era un tocco inutile.
   * Senza tavoli vale lo stesso per il nome: dato una volta, basta.
   *
   * ⚠️ Scelto qui, il tavolo diventa anche quello dell'ordine — ma solo se
   * l'ordine non ne aveva ancora uno e nessun altro l'ha gia' aperto: la
   * campanella non deve cambiare di nascosto dove arrivano i piatti.
   */
  async function chiama(chi: { tavolo: { id: string; name: string } } | { nome: string }) {
    chiudiRiquadro();
    if ("tavolo" in chi && !scelto) setTavolo(chi.tavolo.id);
    if ("nome" in chi) {
      ricorda(CHIAVE_NOME_CHIAMATA, chi.nome);
    }
    setChiamando(true);
    try {
      const res = await fetch(conSede("/api/table-call"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* ⚠️ L'ID del tavolo, mai il nome del tavolo; il nome della persona
           solo dove la sala non ha tavoli. */
        body: JSON.stringify("tavolo" in chi ? { table: chi.tavolo.id } : { name: chi.nome }),
      });
      const dati = (await res.json().catch(() => ({}))) as { error?: string; riprova_tra?: number };
      if (res.ok) {
        avviaAttesa(Number(dati.riprova_tra) || attesaChiamata * 60);
        mostraAvviso(
          "tavolo" in chi ? testi.chiamaFatto.replace("{t}", chi.tavolo.name) : testi.chiamaFattoNome,
          true,
        );
      } else if (String(dati.error ?? "").includes("ferme")) {
        /* Lo stesso modale del servizio chiuso: e' la stessa notizia. */
        setChiusoTesto(testi.errChiuso);
      } else {
        mostraAvviso(testi.chiamaErr, false);
      }
    } catch {
      mostraAvviso(testi.chiamaErr, false);
    } finally {
      setChiamando(false);
    }
  }
  /* La campanella c'e' su TUTTI E DUE gli schermi, accanto alla pillola in
     fondo: sul menu quella del carrello, sui dati «Retour au menu». Il
     pannello dei dati lascia in fondo lo spazio (TableOrder.css), cosi' il
     bottone per pagare non le finisce mai sotto. */
  const campanello = chiamata && !chiusoTesto;
  /** Il tocco sulla campanella: aspetta → dice quanto manca; tavolo (o nome)
   *  gia' noto → chiama subito; se no → chiede. */
  function toccaCampanella() {
    if (chiamando) return;
    if (restanti > 0) {
      mostraAvviso(testi.chiamaAttendi.replace("{tempo}", minSec(restanti)), true);
      return;
    }
    if (conTavoli && scelto) { void chiama({ tavolo: scelto }); return; }
    const nomeNoto = nomeChiamata.trim();
    if (!conTavoli && nomeNoto.length >= 2) { void chiama({ nome: nomeNoto }); return; }
    apriScelta("chiamata");
  }

  /* ⚠️ IL TAVOLO IN CIMA, SUBITO, E FERMO LI'. Era il primo campo del
     pannello dei dati, cioe' l'ultima cosa che si vedeva: chi inquadra il QR
     deve sapere da subito a quale tavolo sta ordinando (e' la conferma che
     non ha sbagliato cartoncino), e poterlo cambiare da qualunque punto
     della carta. Sticky: resta in alto mentre si scorre, sopra la barra delle
     categorie, che si mette sotto di lei (`--tbl-barra-h`).
     Le classi da vestire: `tbl-barra`, piu' quelle del campo di prima. */
  const conBarra = conTavoli && !chiusoTesto;
  /* ⚠️ SCORRENDO, LA BARRA SI RIMPICCIOLISCE: in cima e' una scheda piena
     («Votre table» e il numero grande), giu' nella carta diventa una riga
     sottile che ruba meno spazio ai piatti ma dice ancora il tavolo.
     ⚠️ DUE SOGLIE, non una: rimpicciolendo, la barra accorcia la pagina, e
     con una soglia sola la pagina ci ballerebbe sopra (piccola → la pagina
     sale → torna sotto la soglia → grande → …). Si stringe oltre i 120px e
     torna grande solo sotto i 30: in mezzo resta com'e'. */
  const [compatta, setCompatta] = useState(false);
  useEffect(() => {
    if (!conBarra) return;
    const guarda = () => {
      const y = window.scrollY;
      setCompatta((ora) => (ora ? y > 30 : y > 120));
    };
    guarda();
    window.addEventListener("scroll", guarda, { passive: true });
    return () => window.removeEventListener("scroll", guarda);
  }, [conBarra]);
  /* L'ALTEZZA PIENA della barra, misurata: la usa la barra stessa per tenere
     fermo il suo spazio nella pagina, e le categorie per mettersi sotto.
     ⚠️ Si misura SOLO a barra piena: stretta, la sua altezza la scrive il CSS
     (`tbl-pagina--compatta`). Misurarla mentre si stringe voleva dire un
     aggiornamento di React a ogni fotogramma — gli scatti di prima.
     ⚠️ Si misura e non si scrive: l'aiuto «?» la fa crescere. */
  const fondoRef = useRef<HTMLDivElement | null>(null);
  const [altezzaPiena, setAltezzaPiena] = useState(0);
  useEffect(() => {
    const el = fondoRef.current;
    if (!el || compatta) return;
    const misura = () => setAltezzaPiena(Math.round(el.getBoundingClientRect().height));
    misura();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(misura);
    ro.observe(el);
    return () => ro.disconnect();
  });
  const barraTavolo = (
    <div className="tbl-campo tbl-campo--riga">
      {/* ⚠️ L’AIUTO E’ UN BOTTONE, non un `title`: su un telefono il
          suggerimento del sistema non esiste — non c’e’ niente da
          sorvolare — e la frase resterebbe scritta solo per chi usa il
          mouse. Qui si tocca e compare. */}
      <span className="tbl-lab tbl-lab--riga">
        {testi.tavolo}
        <button
          type="button"
          className="tbl-aiuto-btn"
          aria-label={testi.tavoloAiuto}
          aria-expanded={aiutoAperto}
          onClick={() => setAiutoAperto((v) => !v)}
        >
          ?
        </button>
      </span>
      {/* ⚠️ IL QUADRATO E’ IL BOTTONE. Scelto: il numero, grande abbastanza
          da leggersi senza avvicinare il telefono — e’ la conferma che non
          si e’ sbagliato cartoncino — e una matita in un angolo dice che
          si puo’ toccare. Non scelto: un bottone solo. */}
      {/* ⚠️ CHI C'E' AL TAVOLO: un cerchio con l'iniziale per persona (chi
          ha aperto e chi ha ordinato), accanto al numero. Si vede subito se
          ci si sta unendo agli amici — o se si e' sbagliato tavolo e c'e'
          gente che non si conosce. Solo iniziali, mai nomi. */}
      {scelto && inizialiDi(scelto.id).length > 0 && (
        <span className="tbl-avatars" aria-hidden="true">
          {inizialiDi(scelto.id).map((i) => (
            <span key={i} className="tbl-avatar">{i}</span>
          ))}
        </span>
      )}
      {scelto ? (
        <button
          type="button"
          className={`tbl-tav tbl-tav--scelto${aperto(scelto.id) ? " tbl-tav--aperto" : ""}`}
          onClick={() => apriScelta("ordine")}
          aria-label={`${scelto.name} — ${testi.cambia}`}
        >
          <span className="tbl-tav-n">{scelto.name}</span>
          <span className="tbl-tav-ico" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
          </span>
        </button>
      ) : (
        <button type="button" className="tbl-scegli" onClick={() => apriScelta("ordine")}>
          {testi.scegli}
        </button>
      )}
      {/* «Addition»: chi e' nel conto la apre da qui, da qualunque punto
          della carta. */}
      {nelConto && tc && (
        <button type="button" className="tbl-conto-btn" onClick={() => setAdditionAperta(true)}>
          {tc.mia}
        </button>
      )}
      {aiutoAperto && <p className="tbl-aiuto-testo">{testi.tavoloAiuto}</p>}
    </div>
  );

  /* I campi «dove e in quanti», dentro il pannello dei dati di OrderApp, al
     posto dell’ora di ritiro. Le classi da vestire: `tbl-form`, `tbl-campo`,
     `tbl-lab`, `tbl-tav`, `tbl-scegli`, `tbl-pgrid`, `tbl-p`, `tbl-input`. */
  const campi = (
    <div className="tbl-form">
      {/* ⚠️ IL TAVOLO SI SCEGLIE IN CIMA (la barra fissa), ma se manca lo si
          ricorda QUI: e' il pannello dove il bottone per pagare resta spento
          finche' il tavolo non c'e', e chi non capisce perche' non guarda in
          alto — guarda il bottone. */}
      {conTavoli && !scelto && (
        <button type="button" className="tbl-scegli tbl-scegli--manca" onClick={() => apriScelta("ordine")}>
          {testi.scegliTavolo}
        </button>
      )}
      {siUnisce && !nelConto && !contoDiAltri && <p className="tbl-unito">{testi.tavoloUnito}</p>}
      {/* IL CONTO APERTO. Gia' dentro: una riga che lo dice. Di altri: il
          campo del codice per unirsi (il carrello resta), e l'uscita per chi
          si e' seduto a un tavolo lasciato aperto. Le classi da vestire:
          `tbl-conto-unisciti`, `tbl-conto-codice`, `tbl-conto-err`,
          `tbl-conto-nonnostro`. */}
      {nelConto && tc && <p className="tbl-unito">{tc.sulConto}</p>}
      {contoDiAltri && tc && (
        <div className="tbl-conto-unisciti">
          <p className="tbl-unito">{tc.giaAperto.replace("{i}", contoDiAltri.iniziale)}</p>
          <div className="tbl-conto-codice">
            <input
              className="tbl-input"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              maxLength={2}
              aria-label={tc.codice}
              placeholder={tc.codicePh}
              value={codiceScritto}
              onChange={(e) => setCodiceScritto(e.target.value.replace(/[^0-9]/g, "").slice(0, 2))}
            />
            <button
              type="button"
              className="tbl-btn"
              disabled={codiceScritto.length === 0 || lavoroConto}
              onClick={() => void unisciti(codiceScritto)}
            >
              {tc.unisciti}
            </button>
          </div>
          {erroreConto && <p className="tbl-conto-err" role="alert">{erroreConto}</p>}
          {chiamata && scelto ? (
            <button type="button" className="tbl-conto-nonnostro" onClick={() => void chiama({ tavolo: scelto })}>
              {tc.nonNostro}
            </button>
          ) : (
            <p className="tbl-conto-nonnostro-t">{tc.nonNostro} — {tc.nonNostroTesto}</p>
          )}
        </div>
      )}
      {!siUnisce && !nelConto && !contoDiAltri && (
      <div className="tbl-campo">
        <span className="tbl-lab">{testi.persone}</span>
        {/* ⚠️ PASTIGLIE, non un campo numerico, ed e’ lo stesso modo del
            widget prenotazioni (`rw-pgrid`): chi e’ seduto risponde con un
            tocco invece di aprire la tastiera numerica, che su un telefono
            copre mezzo schermo e va poi chiusa a mano. */}
        <div className="tbl-pgrid">
          {Array.from({ length: PERSONE_PASTIGLIE }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              type="button"
              className={`tbl-p${!oltre && Number(persone) === n ? " tbl-p--ora" : ""}`}
              aria-pressed={!oltre && Number(persone) === n}
              onClick={() => { setOltre(false); setPersone(String(n)); }}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            className={`tbl-p${oltre ? " tbl-p--ora" : ""}`}
            aria-pressed={oltre}
            onClick={() => { setOltre(true); setPersone(String(PERSONE_PASTIGLIE + 1)); }}
          >
            {/* «6+», non «5+»: il cinque ha gia' la sua pastiglia, e «5+»
                farebbe pensare che vada scelto anche per cinque. */}
            {PERSONE_PASTIGLIE + 1}+
          </button>
        </div>
        {/* ⚠️ Il campo compare SOLO dopo «6+»: tenerlo sempre visibile
            rimetterebbe in pagina proprio la tastiera che le pastiglie
            servono a evitare. */}
        {oltre && (
          <input className="tbl-input tbl-p-oltre" type="number" inputMode="numeric"
            min={PERSONE_PASTIGLIE + 1} max={100} value={persone}
            onChange={(e) => setPersone(e.target.value)} autoFocus />
        )}
      </div>
      )}
    </div>
  );

  /* Le classi da vestire qui: `tbl-pagina`, `tbl-titolo`, `tbl-passi`,
     `tbl-modale` (e dentro), `tbl-chiuso`. */
  return (
    <div
      className={`tbl-pagina${campanello ? " tbl-pagina--campanello" : ""}${conBarra ? " tbl-pagina--barra" : ""}${conBarra && compatta ? " tbl-pagina--compatta" : ""}`}
      style={conBarra && altezzaPiena
        /* ⚠️ Solo l'altezza PIENA, inline. `--tbl-barra-h` (dove si mettono le
           categorie) la deriva il CSS: inline vincerebbe sempre, e la barra
           stretta non riuscirebbe piu' a dirla. */
        ? ({ "--tbl-barra-piena": `${altezzaPiena}px` } as React.CSSProperties)
        : undefined}
    >
      {conBarra && (
        <div className={`tbl-barra${compatta ? " tbl-barra--compatta" : ""}`}>
          <div className="tbl-barra-fondo" ref={fondoRef}>
            {barraTavolo}
          </div>
        </div>
      )}
      {/* ⚠️ IL TITOLO NON SI VEDE, MA C'E'. Chi usa un lettore di schermo
          arriva su una pagina e cerca il suo titolo: toglierlo dal codice
          gliela lascerebbe senza nome. Lo nasconde il CSS (`tbl-titolo`). */}
      <h1 className="tbl-titolo">{testi.titolo}</h1>
      {/* ⚠️ LA VETRINA SOLO SUL MENU. Sul pannello dei dati spingerebbe il
          riepilogo e il bottone di pagamento sotto la piega, proprio quando
          il cliente sta per pagare. Se nessun piatto ha una foto, gira la
          foto del locale da sola; se non c'e' nemmeno quella, niente. */}
      {vista === "menu" && <Vetrina foto={vetrina} nomi={testi.titolo} />}

      {/* ⚠️ A servizio chiuso il menu NON si monta: niente da scegliere, e un
          carrello riempito per niente e’ peggio di un modale che dice subito
          come stanno le cose. */}
      {!chiusoTesto && (
        <OrderApp
          menu={menu}
          t={testiOrdine}
          lang={lang}
          sede={sede}
          tavolo={{ campi, pronto, emailObbligatoria: avvisa, apriSessione, onVista: setVista, conto: contoPerOrderApp }}
          vistaIniziale={ripresa ? "checkout" : "menu"}
          sceltaFormato={sceltaFormato}
          foto={foto}
          carrelloDettagliato={carrelloDettagliato}
          totaleSottoLeNote={totaleSottoLeNote}
          pagamento={pagamento}
        />
      )}

      {/* ⚠️ LA CAMPANELLA, a destra della barra del carrello. La scritta
          gira attorno al disegno: dice cosa fa il bottone senza bisogno di
          un'etichetta accanto, che sul telefono non ci starebbe. E' la
          scritta stessa il nome del bottone per chi non vede (`aria-label`);
          i due disegni sono nascosti ai lettori di schermo.
          Le classi da vestire: `tbl-campanello`, `tbl-campanello-giro`,
          `tbl-campanello-ico`, `tbl-avviso`. */}
      {campanello && (
        <button
          type="button"
          className={`tbl-campanello${restanti > 0 ? " tbl-campanello--attesa" : ""}`}
          aria-label={restanti > 0 ? testi.chiamaAttendi.replace("{tempo}", minSec(restanti)) : testi.chiama}
          disabled={chiamando}
          onClick={toccaCampanella}
        >
          <svg className="tbl-campanello-giro" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              {/* ⚠️ Raggio 30 su 50: la scritta sta VICINA alla campanella e
                  lontana dal bordo, che resta un anello vuoto — attaccata al
                  bordo sembrava tagliata. */}
              <path id="tbl-campanello-cerchio" d="M50,50 m-30,0 a30,30 0 1,1 60,0 a30,30 0 1,1 -60,0" />
            </defs>
            {/* ⚠️ `textLength` = la circonferenza (2π·30 ≈ 188): la scritta
                fa il giro intero in qualsiasi lingua, corta o lunga, e il
                pallino chiude il cerchio invece di lasciare un buco. */}
            <text>
              <textPath href="#tbl-campanello-cerchio" textLength={188} lengthAdjust="spacing">
                {/* ⚠️ Spazi INDIVISIBILI attorno al pallino: uno spazio normale
                    in fondo a un testo SVG viene mangiato, e il pallino finiva
                    incollato all'inizio della frase («•APPELER»). */}
                {`${testi.chiama.toLocaleUpperCase(lang)}\u00A0\u00A0•\u00A0\u00A0`}
              </textPath>
            </text>
          </svg>
          {/* In attesa, al posto del disegno il tempo che manca. */}
          {restanti > 0 ? (
            <span className="tbl-campanello-tempo" aria-hidden="true">{minSec(restanti)}</span>
          ) : (
            <svg className="tbl-campanello-ico" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          )}
        </button>
      )}
      {/* ⚠️ La zona `role="status"` c'e' SEMPRE, vuota quando non c'e' niente
          da dire: un lettore di schermo annuncia cio' che CAMBIA dentro una
          zona viva, non una zona che compare gia' piena. */}
      <div className="tbl-avviso-zona" role="status">
        {avviso && (
          <p className={`tbl-avviso${avviso.ok ? "" : " tbl-avviso--errore"}`}>{avviso.testo}</p>
        )}
      </div>

      {/* ⚠️ IL MODALE DEI TAVOLI STA FUORI DAL PANNELLO, non dentro il campo:
          dentro, lo sfondo scuro avrebbe coperto solo quel pezzo di pagina. E
          si chiude toccando il fondo o con Esc — chi apre per sbaglio deve
          poterne uscire senza scegliere un tavolo a caso.
          ⚠️ Niente nomi di zona: in sala il cliente cerca il SUO numero, e
          scriverglieli sopra gli fa leggere qualcosa che non gli serve. */}
      {sceltaAperta && (
        <div
          className={`tbl-modale${uscita ? " is-uscita" : ""}`}
          ref={modaleRef}
          role="dialog"
          aria-modal="true"
          aria-label={modoScelta === "chiamata" ? testi.chiamaTitolo : testi.scegliTavolo}
          onClick={chiudiRiquadro}
          onKeyDown={(e) => { if (e.key === "Escape") chiudiRiquadro(); }}
        >
          {/* Il riquadro NON chiude: il tocco su un tavolo non deve valere
              anche come tocco sul fondo. */}
          <div className="tbl-modale-box" onClick={(e) => e.stopPropagation()}>
            <div className="tbl-modale-testa">
              <p className="tbl-modale-tit">{modoScelta === "chiamata" ? testi.chiamaTitolo : testi.scegliTavolo}</p>
              <button type="button" className="tbl-modale-x" aria-label={testi.chiudi}
                      onClick={chiudiRiquadro}>×</button>
            </div>
            <div className="tbl-griglia">
              {tavoli.map((t) => (
                /* ⚠️ Si tiene l’ID, non il nome: un tavolo rinominato stasera
                   manderebbe i piatti altrove, e due zone possono avere tutte
                   e due un «3». */
                <button
                  key={t.id}
                  type="button"
                  className={`tbl-tav${scelto?.id === t.id ? " tbl-tav--ora" : ""}${aperto(t.id) ? " tbl-tav--aperto" : ""}`}
                  aria-pressed={scelto?.id === t.id}
                  onClick={() => {
                    if (modoScelta === "chiamata") { void chiama({ tavolo: t }); return; }
                    setTavolo(t.id);
                    chiudiRiquadro();
                  }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SALA SENZA TAVOLI: la campanella chiede il nome, e sul tablet si
          legge «Marc appelle le serveur» — lo stesso modo in cui il ticket
          dell'ordine dice «MARC». Un riquadro con un campo solo: e' l'unica
          cosa che il cameriere puo' usare per trovare chi lo cerca. */}
      {nomeAperto && (
        <div
          className={`tbl-modale${uscita ? " is-uscita" : ""}`}
          ref={modaleRef}
          role="dialog"
          aria-modal="true"
          aria-label={testi.chiamaNomeTitolo}
          onClick={chiudiRiquadro}
          onKeyDown={(e) => { if (e.key === "Escape") chiudiRiquadro(); }}
        >
          <form
            className="tbl-modale-box tbl-chiama-form"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              const n = nomeChiamata.trim();
              if (n.length >= 2 && !chiamando) void chiama({ nome: n });
            }}
          >
            <div className="tbl-modale-testa">
              <p className="tbl-modale-tit">{testi.chiamaNomeTitolo}</p>
              <button type="button" className="tbl-modale-x" aria-label={testi.chiudi}
                      onClick={chiudiRiquadro}>×</button>
            </div>
            <input
              className="tbl-input"
              type="text"
              autoComplete="given-name"
              autoFocus
              maxLength={40}
              aria-label={testi.chiamaNome}
              placeholder={testi.chiamaNome}
              value={nomeChiamata}
              onChange={(e) => setNomeChiamata(e.target.value)}
            />
            <button type="submit" className="tbl-btn" disabled={nomeChiamata.trim().length < 2 || chiamando}>
              {testi.chiamaInvia}
            </button>
          </form>
        </div>
      )}

      {/* «VOTRE ADDITION»: lo stato (in attesa del cameriere / aperta), il
          codice e il QR «Inviter», gli invii con chi ha preso cosa, il totale,
          «Demander l'addition». ⚠️ Nomi e piatti li scrive la gente: React li
          mette come testo. Il QR lo disegna il server, da un link.
          Le classi da vestire: `tbl-conto` e `tbl-conto-*`. */}
      {additionAperta && statoConto?.tipo === "membro" && tc && (() => {
        const d = statoConto.dati;
        const inAttesa = d.stato === "pending";
        return (
          <div
            className="tbl-modale"
            role="dialog"
            aria-modal="true"
            aria-label={tc.titolo}
            onClick={() => setAdditionAperta(false)}
            onKeyDown={(e) => { if (e.key === "Escape") setAdditionAperta(false); }}
          >
            <div className="tbl-modale-box tbl-conto" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modale-testa">
                <p className="tbl-modale-tit">{tc.titolo}</p>
                <button type="button" className="tbl-modale-x" aria-label={testi.chiudi}
                        onClick={() => setAdditionAperta(false)}>×</button>
              </div>
              <p className={`tbl-conto-stato${inAttesa ? " is-attesa" : ""}`} role="status">{inAttesa ? tc.attesa : tc.aperta}</p>
              <p className="tbl-conto-ordinato">
                {tc.ordinato.replace("{n}", String(d.ordinato)).replace("{p}", String(d.persone))}
              </p>
              <div className="tbl-conto-invita">
                {d.invito_svg && <div className="tbl-conto-qr" aria-hidden="true" dangerouslySetInnerHTML={{ __html: d.invito_svg }} />}
                <div className="tbl-conto-invita-testo">
                  <p className="tbl-conto-lab">{tc.invita}</p>
                  <p className="tbl-conto-code">{d.code}</p>
                  <p className="tbl-conto-aiuto">{tc.invitaTesto}</p>
                </div>
              </div>
              {d.invii.length === 0 ? (
                <p className="tbl-conto-vuoto">{tc.vuoto}</p>
              ) : (
                d.invii.map((inv) => (
                  <section className="tbl-conto-invio" key={inv.numero}>
                    <p className="tbl-conto-invio-tit">
                      {tc.invioN.replace("{k}", String(inv.numero))}
                      <span className={`tbl-conto-invio-stato${inv.inviato ? " is-cucina" : ""}`}>{inv.inviato ? tc.inCucina : tc.inAttesa}</span>
                    </p>
                    {inv.righe.map((r, i) => (
                      <div className={`tbl-conto-riga${r.mio ? " is-mia" : ""}`} key={i}>
                        <div className="tbl-conto-chi">
                          <strong>{r.nome}</strong>
                          <span>{euroConto(r.totale_cents)}</span>
                        </div>
                        <ul className="tbl-conto-piatti">
                          {r.piatti.map((p, j) => <li key={j}>{p.qty} × {p.nome}</li>)}
                        </ul>
                        {r.token && (
                          <button type="button" className="tbl-conto-togli" onClick={() => void togliDalConto(r.token as string)}>
                            {tc.togli}
                          </button>
                        )}
                      </div>
                    ))}
                  </section>
                ))
              )}
              <div className="tbl-conto-totale">
                <span>{tc.totale}</span>
                <strong>{euroConto(d.totale_cents)}</strong>
              </div>
              <div className="tbl-avviso-zona" role="status">
                {msgConto && <p className="tbl-conto-msg">{msgConto}</p>}
              </div>
              <button type="button" className="tbl-btn" disabled={lavoroConto || d.invii.length === 0} onClick={() => void chiediAddizione()}>
                {tc.chiedi}
              </button>
              <button type="button" className="tbl-conto-ancora" onClick={() => setAdditionAperta(false)}>
                {tc.ancora}
              </button>
            </div>
          </div>
        );
      })()}

      {/* ⚠️ IL MODALE «CHIUSO» NON SI CHIUDE. Dietro non c’e’ niente da fare,
          e una X porterebbe su una pagina vuota — una
          pagina rotta, agli occhi di chi e’ seduto. L’unica azione e’
          riprovare: dice QUANDO, cosi’ chi legge «17:00» sa che deve solo
          aspettare, non che il QR e’ guasto. */}
      {chiusoTesto && (
        <div className="tbl-modale tbl-modale--chiuso" role="alertdialog" aria-modal="true" aria-labelledby="tbl-chiuso-tit">
          <div className="tbl-modale-box tbl-chiuso">
            <p className="tbl-chiuso-tit" id="tbl-chiuso-tit">{chiusoTitolo}</p>
            <p className="tbl-chiuso-testo">{chiusoTesto}</p>
            <button type="button" className="tbl-btn" onClick={() => window.location.reload()}>
              {testi.aggiorna}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
