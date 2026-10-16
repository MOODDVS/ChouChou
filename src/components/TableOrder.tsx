import { useState, useEffect, useRef } from "react";
import OrderApp from "./OrderApp";
import { urlConSede } from "../lib/sedeUrl";
import { piattiInVetrina } from "../lib/vetrinaRegole";
import { testoPiatto } from "../lib/i18nMenu";

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
 * ⚠️ E LA SESSIONE SI RIPRENDE. Il `reservation_id` resta in
 * `sessionStorage`: chi riordina a fine cena ritrova lo stesso conto invece
 * di aprirne un secondo — che conterebbe due volte i coperti della sera. Il
 * server la riusa solo se e' di oggi e ancora aperta.
 */

/** Le parole di questa pagina. Le passa la pagina, che e' del cliente. */
export interface TestiSessione {
  titolo: string;
  tavolo: string;
  tavoloAiuto: string;
  persone: string;
  /** Il percorso in tre passi, in cima: dove sono e cosa viene dopo. */
  passo1: string;
  passo2: string;
  passo3: string;
  /** Il bottone che apre la scelta, e il titolo del riquadro che si apre. */
  scegli: string;
  scegliTavolo: string;
  /** Si e’ gia’ scelto, e si vuole cambiare. */
  cambia: string;
  /** Chiudere il riquadro della scelta senza scegliere. */
  chiudi: string;
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
  pagamento?: React.ComponentProps<typeof OrderApp>["pagamento"];
}

const CHIAVE = "restohub-tavolo";
/** Tavolo e coperti scelti, per ritrovarli tornando da Stripe. */
const CHIAVE_SCELTA = "restohub-tavolo-scelta";

function leggiScelta(): { tavolo?: string; persone?: string } {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(CHIAVE_SCELTA) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

/** Fin dove si sceglie con un tocco. ⚠️ Oltre, NON si taglia: un tavolo da
 *  dodici esiste (due tavoli uniti), e scrivere dieci al posto di dodici
 *  vorrebbe dire due coperti in meno nel conto della sera, ogni volta. */
const PERSONE_PASTIGLIE = 10;

function leggiSessione(): { id: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHIAVE);
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
  tavoloDaUrl = "", chiuso = null, ripresa = false, immagine = "", sceltaFormato, foto, carrelloDettagliato, pagamento,
}: Props) {
  /* ⚠️ LA STESSA CONVENZIONE DI `OrderApp`, non una variante: un `conSede`
     locale attorno a ogni URL. La rete che controlla che il browser dica
     sempre il punto (`tests/pubblico.test.mjs`) cerca proprio questa forma
     nelle quaranta battute prima dell’indirizzo — scritto in un altro modo,
     la chiamata resta giusta e la RETE non la vede piu’. */
  const conSede = (u: string) => urlConSede(u, sede);
  /* Su quale schermo di `OrderApp` siamo: decide il passo acceso. */
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
      window.sessionStorage.setItem(CHIAVE_SCELTA, JSON.stringify({ tavolo, persone }));
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
  const [aiutoAperto, setAiutoAperto] = useState(false);
  /* Si e’ chiesto «piu’ di dieci»: compare il campo per dire quanti. */
  const [oltreDieci, setOltreDieci] = useState(false);
  /* ⚠️ Il QR puo’ portare un id OPPURE un nome (`?table=7`), e in quel caso
     il quadrato deve mostrare lo stesso il tavolo giusto: si cerca per tutti
     e due. Se non si trova niente, il bottone «scegli» resta — meglio
     chiedere che mostrare un tavolo inventato. */
  const scelto =
    tavoli.find((t) => t.id === tavolo) ??
    tavoli.find((t) => t.name.trim().toLowerCase() === tavolo.trim().toLowerCase()) ??
    null;
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
      try {
        window.sessionStorage.setItem(CHIAVE, JSON.stringify({ id: dati.reservation_id }));
      } catch {
        /* navigazione privata: si ordina lo stesso, non si riprende */
      }
      return { ok: true, reservationId: dati.reservation_id, tableId: dati.table_id ?? null };
    } catch {
      return { ok: false, errore: testi.errGenerico };
    }
  }

  /* ⚠️ IL PERCORSO E’ UNA GUIDA, NON UNA BARRA DI AVANZAMENTO CHE MENTE.
     Primo passo acceso sul menu, secondo sul pannello dei dati; il terzo
     resta spento finche’ il cliente non esce da questa pagina (il pagamento
     lo porta via, su Stripe): annuncia cosa viene, e si vede che deve
     ancora venire. A servizio chiuso il primo passo e’ SPENTO: non c’e’
     niente da scegliere, e accenderlo vorrebbe dire invitare a farlo. */
  function percorso() {
    const passi = [testi.passo1, testi.passo2, testi.passo3];
    const attivo = vista === "menu" ? 1 : 2;
    return (
      <ol className="tbl-passi" aria-label={passi.join(" · ")}>
        {passi.map((p, i) => {
          const n = i + 1;
          const stato = chiusoTesto
            ? n === 1 ? "spento" : "poi"
            : n === attivo ? "ora" : n < attivo ? "fatto" : "poi";
          return (
            <li key={p} className={`tbl-passo tbl-passo--${stato}`} aria-current={stato === "ora" ? "step" : undefined}>
              <span className="tbl-passo-n">{stato === "fatto" ? "✓" : n}</span>
              <span className="tbl-passo-lab">{p}</span>
            </li>
          );
        })}
      </ol>
    );
  }

  /* I campi «dove e in quanti», dentro il pannello dei dati di OrderApp, al
     posto dell’ora di ritiro. Le classi da vestire: `tbl-form`, `tbl-campo`,
     `tbl-lab`, `tbl-tav`, `tbl-scegli`, `tbl-pgrid`, `tbl-p`, `tbl-input`. */
  const campi = (
    <div className="tbl-form">
      {conTavoli && (
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
          {scelto ? (
            <button
              type="button"
              className="tbl-tav tbl-tav--scelto"
              onClick={() => setSceltaAperta(true)}
              aria-label={`${scelto.name} — ${testi.cambia}`}
            >
              <span className="tbl-tav-n">{scelto.name}</span>
              <span className="tbl-tav-ico" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
              </span>
            </button>
          ) : (
            <button type="button" className="tbl-scegli" onClick={() => setSceltaAperta(true)}>
              {testi.scegli}
            </button>
          )}
          {aiutoAperto && <p className="tbl-aiuto-testo">{testi.tavoloAiuto}</p>}
        </div>
      )}
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
              className={`tbl-p${!oltreDieci && Number(persone) === n ? " tbl-p--ora" : ""}`}
              aria-pressed={!oltreDieci && Number(persone) === n}
              onClick={() => { setOltreDieci(false); setPersone(String(n)); }}
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            className={`tbl-p${oltreDieci ? " tbl-p--ora" : ""}`}
            aria-pressed={oltreDieci}
            onClick={() => { setOltreDieci(true); setPersone(String(PERSONE_PASTIGLIE + 1)); }}
          >
            {PERSONE_PASTIGLIE}+
          </button>
        </div>
        {/* ⚠️ Il campo compare SOLO dopo «10+»: tenerlo sempre visibile
            rimetterebbe in pagina proprio la tastiera che le pastiglie
            servono a evitare. */}
        {oltreDieci && (
          <input className="tbl-input tbl-p-oltre" type="number" inputMode="numeric"
            min={PERSONE_PASTIGLIE + 1} max={100} value={persone}
            onChange={(e) => setPersone(e.target.value)} autoFocus />
        )}
      </div>
    </div>
  );

  /* Le classi da vestire qui: `tbl-pagina`, `tbl-titolo`, `tbl-passi`,
     `tbl-modale` (e dentro), `tbl-chiuso`. */
  return (
    <div className="tbl-pagina">
      {percorso()}
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
          tavolo={{ campi, pronto, emailObbligatoria: avvisa, apriSessione, onVista: setVista }}
          vistaIniziale={ripresa ? "checkout" : "menu"}
          sceltaFormato={sceltaFormato}
          foto={foto}
          carrelloDettagliato={carrelloDettagliato}
          pagamento={pagamento}
        />
      )}

      {/* ⚠️ IL MODALE DEI TAVOLI STA FUORI DAL PANNELLO, non dentro il campo:
          dentro, lo sfondo scuro avrebbe coperto solo quel pezzo di pagina. E
          si chiude toccando il fondo o con Esc — chi apre per sbaglio deve
          poterne uscire senza scegliere un tavolo a caso.
          ⚠️ Niente nomi di zona: in sala il cliente cerca il SUO numero, e
          scriverglieli sopra gli fa leggere qualcosa che non gli serve. */}
      {sceltaAperta && (
        <div
          className="tbl-modale"
          role="dialog"
          aria-modal="true"
          aria-label={testi.scegliTavolo}
          onClick={() => setSceltaAperta(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setSceltaAperta(false); }}
        >
          {/* Il riquadro NON chiude: il tocco su un tavolo non deve valere
              anche come tocco sul fondo. */}
          <div className="tbl-modale-box" onClick={(e) => e.stopPropagation()}>
            <div className="tbl-modale-testa">
              <p className="tbl-modale-tit">{testi.scegliTavolo}</p>
              <button type="button" className="tbl-modale-x" aria-label={testi.chiudi}
                      onClick={() => setSceltaAperta(false)}>×</button>
            </div>
            <div className="tbl-griglia">
              {tavoli.map((t) => (
                /* ⚠️ Si tiene l’ID, non il nome: un tavolo rinominato stasera
                   manderebbe i piatti altrove, e due zone possono avere tutte
                   e due un «3». */
                <button
                  key={t.id}
                  type="button"
                  className={`tbl-tav${scelto?.id === t.id ? " tbl-tav--ora" : ""}`}
                  aria-pressed={scelto?.id === t.id}
                  onClick={() => { setTavolo(t.id); setSceltaAperta(false); }}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ⚠️ IL MODALE «CHIUSO» NON SI CHIUDE. Dietro non c’e’ niente da fare,
          e una X porterebbe su una pagina vuota con un percorso spento — una
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
