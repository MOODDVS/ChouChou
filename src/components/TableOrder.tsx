import { useState } from "react";
import OrderApp from "./OrderApp";
import { urlConSede } from "../lib/sedeUrl";

/* ⚠️ IL MENU LO TIPIZZA `OrderApp`, non `lib/db`. Importarlo da la' —
   anche solo come tipo — metterebbe in quest’isola un percorso verso
   `db.ts`, che crea il client Supabase ALL’IMPORT e lancia senza le
   variabili d’ambiente. OrderApp si dichiara i suoi tipi in casa per questo
   motivo esatto; qui si riusano i suoi. */
type MenuDiOrderApp = React.ComponentProps<typeof OrderApp>["menu"];

/**
 * ORDINARE DAL PROPRIO TAVOLO — le due schermate, in un'isola sola.
 *
 * Prima si apre la sessione (chi sei, in quanti siete, quale tavolo), poi
 * compare il menu. Sono due viste e non due pagine, e il motivo e' pratico:
 * la sessione che la prima ottiene — `reservation_id` — la seconda deve
 * avere in mano a ogni ordine. Due pagine vorrebbero dire passarsela
 * nell'URL, cioe' un id in chiaro che chiunque puo' cambiare.
 *
 * ⚠️ DUE MODULI DIVERSI, decisi dai DATI e non da un interruttore: dove il
 * piano sala ha dei tavoli si scegle il proprio, dove non ne ha si da' solo
 * il nome. Un bistrot senza numeri sui tavoli non ha niente da far scegliere,
 * e chiedergli un numero sarebbe un modulo che non si puo' compilare.
 *
 * ⚠️ E LA SESSIONE SI RIPRENDE. Il `reservation_id` resta in
 * `sessionStorage`: chi chiude la pagina e riapre il QR a fine cena ritrova
 * lo stesso conto invece di aprirne un secondo — che conterebbe due volte i
 * coperti della sera. Il server la riusa solo se e' di oggi e ancora aperta.
 */

/** Le parole di QUESTA schermata. Le passa la pagina, che e' del cliente. */
export interface TestiSessione {
  titolo: string;
  intro: string;
  tavolo: string;
  tavoloAiuto: string;
  nome: string;
  persone: string;
  email: string;
  emailAiuto: string;
  emailObbligatoria: string;
  apri: string;
  apertura: string;
  /** Messaggi d'errore, tradotti: il server risponde in una lingua sola. */
  errCampi: string;
  errChiuso: string;
  errTavolo: string;
  errGenerico: string;
}

interface Props {
  menu: MenuDiOrderApp;
  /** Le stringhe di OrderApp, costruite dalla pagina come per /order. */
  testiOrdine: React.ComponentProps<typeof OrderApp>["t"];
  testi: TestiSessione;
  lang: string;
  sede?: string;
  /** La sala ha dei tavoli disegnati: lo dice il server, non il browser. */
  conTavoli: boolean;
  /** Si avvisa il cliente quando e' pronto → l'email diventa obbligatoria. */
  avvisa: boolean;
  /** Il tavolo scritto nel QR (`?table=7`). Vuoto = QR generico. */
  tavoloDaUrl?: string;
  sceltaFormato?: "pulsanti" | "modale";
  foto?: boolean;
  carrelloDettagliato?: boolean;
  pagamento?: React.ComponentProps<typeof OrderApp>["pagamento"];
}

interface Sessione {
  reservationId: string;
  tableId: string | null;
  tableLabel: string;
}

const CHIAVE = "restohub-tavolo";

function leggiSessione(): { id: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(CHIAVE);
    return raw ? (JSON.parse(raw) as { id: string }) : null;
  } catch {
    return null;
  }
}

export default function TableOrder({
  menu, testiOrdine, testi, lang, sede = "", conTavoli, avvisa,
  tavoloDaUrl = "", sceltaFormato, foto, carrelloDettagliato, pagamento,
}: Props) {
  /* ⚠️ LA STESSA CONVENZIONE DI `OrderApp`, non una variante: un `conSede`
     locale attorno a ogni URL. La rete che controlla che il browser dica
     sempre il punto (`tests/pubblico.test.mjs`) cerca proprio questa forma
     nelle quaranta battute prima dell’indirizzo — scritto in un altro modo,
     la chiamata resta giusta e la RETE non la vede piu’. */
  const conSede = (u: string) => urlConSede(u, sede);
  const [sessione, setSessione] = useState<Sessione | null>(null);
  const [nome, setNome] = useState("");
  const [persone, setPersone] = useState("2");
  const [email, setEmail] = useState("");
  const [tavolo, setTavolo] = useState(tavoloDaUrl);
  const [invio, setInvio] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const emailValida = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const valido =
    nome.trim().length >= 2 &&
    Number(persone) >= 1 &&
    (!conTavoli || tavolo.trim() !== "") &&
    (avvisa ? emailValida : email.trim() === "" || emailValida);

  async function apri() {
    if (!valido || invio) return;
    setInvio(true);
    setErrore(null);
    try {
      /* ⚠️ Il punto viaggia con la chiamata: senza, un gruppo con piu' sedi
         aprirebbe il tavolo 7 della PRIMA. Stesso inciampo gia' pagato da
         /api/checkout e /api/coupon. */
      const res = await fetch(conSede("/api/table-session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nome,
          people: Number(persone),
          ...(conTavoli ? { table: tavolo.trim() } : {}),
          ...(email.trim() ? { email: email.trim() } : {}),
          lang,
          /* ⚠️ La sessione di prima, se c'e'. Senza tavoli e' l'unica chiave
             che il server ha per ritrovare lo stesso conto: col tavolo gli
             basta il numero. */
          ...(leggiSessione()?.id ? { reservation_id: leggiSessione()?.id } : {}),
        }),
      });
      const dati = (await res.json()) as {
        reservation_id?: string; table_id?: string | null; table_label?: string; error?: string;
      };
      if (!res.ok || !dati.reservation_id) {
        /* ⚠️ Il server risponde in una lingua sola, e di proposito: i suoi
           messaggi sono per i log, non per il cliente. Qui si traducono i
           casi che il cliente puo' davvero incontrare, e tutto il resto
           diventa un errore generico — mai la stringa grezza del server. */
        const e = String(dati.error ?? "");
        setErrore(
          e.includes("ferme") ? testi.errChiuso
            : e.includes("table") ? testi.errTavolo
            : e.includes("email") || e.includes("nom") || e.includes("personnes") ? testi.errCampi
            : testi.errGenerico,
        );
        setInvio(false);
        return;
      }
      try {
        window.sessionStorage.setItem(CHIAVE, JSON.stringify({ id: dati.reservation_id }));
      } catch {
        /* navigazione privata: si ordina lo stesso, non si riprende */
      }
      setSessione({
        reservationId: dati.reservation_id,
        tableId: dati.table_id ?? null,
        tableLabel: String(dati.table_label ?? ""),
      });
    } catch {
      setErrore(testi.errGenerico);
      setInvio(false);
    }
  }

  if (sessione) {
    return (
      <OrderApp
        menu={menu}
        t={testiOrdine}
        lang={lang}
        sede={sede}
        tavolo={{ ...sessione, emailObbligatoria: avvisa }}
        sceltaFormato={sceltaFormato}
        foto={foto}
        carrelloDettagliato={carrelloDettagliato}
        pagamento={pagamento}
      />
    );
  }

  /* Le classi da vestire: `tbl-apri`, `tbl-titolo`, `tbl-intro`, `tbl-form`,
     `tbl-campo`, `tbl-lab`, `tbl-aiuto`, `tbl-input`, `tbl-err`, `tbl-btn`. */
  return (
    <div className="tbl-apri">
      <h1 className="tbl-titolo">{testi.titolo}</h1>
      <p className="tbl-intro">{testi.intro}</p>
      <div className="tbl-form">
        {conTavoli && (
          <label className="tbl-campo">
            <span className="tbl-lab">{testi.tavolo}<span className="tbl-aiuto">{testi.tavoloAiuto}</span></span>
            <input className="tbl-input" type="text" inputMode="numeric" value={tavolo}
              onChange={(e) => setTavolo(e.target.value)} autoComplete="off" />
          </label>
        )}
        <label className="tbl-campo">
          <span className="tbl-lab">{testi.nome}</span>
          <input className="tbl-input" type="text" value={nome}
            onChange={(e) => setNome(e.target.value)} autoComplete="given-name" />
        </label>
        <label className="tbl-campo">
          <span className="tbl-lab">{testi.persone}</span>
          <input className="tbl-input" type="number" min={1} max={100} value={persone}
            onChange={(e) => setPersone(e.target.value)} />
        </label>
        <label className="tbl-campo">
          <span className="tbl-lab">
            {testi.email}
            <span className="tbl-aiuto">{avvisa ? testi.emailObbligatoria : testi.emailAiuto}</span>
          </span>
          <input className="tbl-input" type="email" value={email}
            onChange={(e) => setEmail(e.target.value)} autoComplete="email" required={avvisa} />
        </label>
      </div>
      {errore && <p className="tbl-err">{errore}</p>}
      <button type="button" className="tbl-btn" onClick={apri} disabled={!valido || invio}>
        {invio ? testi.apertura : testi.apri}
      </button>
    </div>
  );
}
