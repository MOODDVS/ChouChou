import { useEffect, useState, type ReactElement } from "react";
import { useTranslations } from "../i18n/ui";
import { urlConSede } from "../lib/sedeUrl";
/* La fila dei giorni e' nuova: nessun sito la veste ancora. Specificita'
   zero (`:where`), quindi qualunque regola del sito vince. */
import "./SlotPicker.css";

interface SlotPickerProps {
  onSelect?: (slot: string | null) => void;
  /** Il giorno del ritiro (YYYY-MM-DD), quando il ristoratore ha aperto gli
   *  ordini per i prossimi giorni (Réglages → Commandes). `null` = oggi, come
   *  sempre. */
  onGiorno?: (giorno: string | null) => void;
  lang?: "fr" | "en";
  /** La lingua VERA della pagina, per i nomi dei giorni: il dizionario
   *  pubblico ne ha due, i giorni si scrivono in tutte. */
  lingua?: string;
  /** Il punto da cui si ritira. Vuoto = punto unico (vedi lib/sedeUrl). */
  sede?: string;
  /** Ritiro o consegna: la consegna ha orari piu' tardi (preparazione +
   *  tragitto, Réglages → «Délai de livraison»). Cambiando, orari e giorni si
   *  richiedono e l'orario scelto si spegne. */
  servizio?: "ritiro" | "consegna";
}

type Stato = "loading" | "ok" | "chiuso" | "errore";

// La griglia è a 4 colonne (vedi CSS .slotpicker-grid). Quando gli orari di
// una fascia superano 3 righe (12 slot) la lista si accorcia e compare un
// bottone per mostrarli/nasconderli tutti.
const SLOT_VISIBILI = 12;

/* «Oggi» e «Domani» si dicono a parole: «ven. 17 oct.» per oggi fa pensare. */
const PAROLE_GIORNO: Record<string, [string, string]> = {
  fr: ["Aujourd’hui", "Demain"],
  en: ["Today", "Tomorrow"],
  it: ["Oggi", "Domani"],
  nl: ["Vandaag", "Morgen"],
  es: ["Hoy", "Mañana"],
  de: ["Heute", "Morgen"],
};

/* ⚠️ NESSUN ORARIO DI CONSEGNA non vuol dire «commandes fermées»: il ritiro
   puo' essere ancora aperto (la consegna parte piu' tardi, o i fattorini sono
   tutti fuori). Il messaggio di sempre farebbe andar via chi potrebbe ancora
   passare a prenderla. */
const CONSEGNA_CHIUSA: Record<string, string> = {
  fr: "Plus de livraison possible pour ce jour — le retrait reste possible.",
  en: "No more deliveries for this day — pickup is still available.",
  it: "Nessuna consegna possibile per questo giorno — il ritiro resta possibile.",
  nl: "Geen levering meer mogelijk voor deze dag — afhalen blijft mogelijk.",
  es: "No quedan entregas para este día — la recogida sigue siendo posible.",
};

/* Il campo che apre il calendario, quando i giorni sono piu' di due. */
const ALTRA_DATA: Record<string, string> = {
  fr: "Ou choisir une date…",
  en: "Or pick a date…",
  it: "Oppure scegli una data…",
  nl: "Of kies een datum…",
  es: "O elige una fecha…",
  de: "Oder ein Datum wählen…",
};

/** Il giorno dopo `iso` (YYYY-MM-DD), in UTC: e' un giorno, non un istante. */
function giornoDopo(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function etichettaGiorno(iso: string, oggi: string, lingua: string): string {
  const parole = PAROLE_GIORNO[lingua] ?? PAROLE_GIORNO.fr;
  const diff = Math.round((Date.parse(iso) - Date.parse(oggi)) / 86_400_000);
  if (diff === 0) return parole[0];
  if (diff === 1) return parole[1];
  try {
    // ⚠️ Mezzogiorno UTC letto in UTC: e' un giorno, non un istante, e un fuso
    // a ovest lo farebbe scivolare al giorno prima.
    return new Intl.DateTimeFormat(lingua, {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(`${iso}T12:00:00Z`));
  } catch {
    return iso;
  }
}

export default function SlotPicker({ onSelect, onGiorno, lang = "fr", lingua, sede = "", servizio = "ritiro" }: SlotPickerProps) {
  const conSede = (u: string) => urlConSede(u, sede);
  // Il servizio viaggia con ogni richiesta: senza, una consegna vedrebbe gli
  // orari del ritiro e il checkout ne rifiuterebbe i primi.
  const conServizio = (u: string) => (servizio === "consegna" ? `${u}${u.includes("?") ? "&" : "?"}service=delivery` : u);
  const t = useTranslations(lang);

  const [stato, setStato] = useState<Stato>("loading");
  const [lunch, setLunch] = useState<string[]>([]);
  const [dinner, setDinner] = useState<string[]>([]);
  const [selezionato, setSelezionato] = useState<string | null>(null);
  /* I giorni fra cui scegliere. Vuoto = finestra chiusa (solo oggi): il
     selettore e' identico a prima, senza fila di giorni. */
  const [giorni, setGiorni] = useState<string[]>([]);
  const [oggi, setOggi] = useState("");
  const [giorno, setGiorno] = useState<string | null>(null);
  /* La fascia mostrata quando ce ne sono due (Midi / Soir), come le schede
     dei servizi nel widget delle prenotazioni. */
  const [fascia, setFascia] = useState<"lunch" | "dinner">("lunch");

  async function caricaSlots(data: string | null, vivo: () => boolean) {
    setStato("loading");
    try {
      // ⚠️ Gli orari di ritiro sono di UN punto: senza sede erano quelli del primo.
      const res = await fetch(data ? conSede(conServizio(`/api/slots?date=${data}`)) : conSede(conServizio("/api/slots")));
      if (!res.ok) {
        if (vivo()) setStato("errore");
        return;
      }
      const d: { lunch: string[]; dinner: string[] } = await res.json();
      if (!vivo()) return;
      if (d.lunch.length === 0 && d.dinner.length === 0) {
        setStato("chiuso");
      } else {
        setLunch(d.lunch);
        setDinner(d.dinner);
        // Si apre sulla prima fascia che ha orari: a pranzo finito, la sera.
        setFascia(d.lunch.length > 0 ? "lunch" : "dinner");
        setStato("ok");
      }
    } catch {
      if (vivo()) setStato("errore");
    }
  }

  // 1. Quali giorni? (all'apertura, e di nuovo se cambia il punto)
  useEffect(() => {
    let attivo = true;
    const vivo = () => attivo;
    (async () => {
      let lista: string[] = [];
      let finestra = 0;
      try {
        const res = await fetch(conSede(conServizio("/api/slots?days=1")));
        if (res.ok) {
          const d: { avanti?: number; oggi?: string; giorni?: string[] } = await res.json();
          finestra = d.avanti ?? 0;
          lista = d.giorni ?? [];
          if (attivo) setOggi(d.oggi ?? "");
        }
      } catch {
        // Senza la lista dei giorni si ripiega su oggi: come prima.
      }
      if (!attivo) return;
      // Cambiando servizio l'orario scelto non vale piu': le 19:00 del ritiro
      // possono non esistere per la consegna.
      setSelezionato(null);
      onSelect?.(null);
      if (finestra > 0) {
        setGiorni(lista);
        if (lista.length === 0) {
          setGiorno(null);
          onGiorno?.(null);
          setStato("chiuso");
          return;
        }
        setGiorno(lista[0]);
        onGiorno?.(lista[0]);
        await caricaSlots(lista[0], vivo);
      } else {
        setGiorni([]);
        setGiorno(null);
        onGiorno?.(null);
        await caricaSlots(null, vivo);
      }
    })();
    return () => {
      attivo = false;
    };
  }, [sede, servizio]); // ⚠️ `sede` e `servizio`: cambiando punto o fra ritiro e consegna, giorni e orari si richiedono.

  function scegli(slot: string) {
    const nuovo = slot === selezionato ? null : slot;
    setSelezionato(nuovo);
    onSelect?.(nuovo);
  }

  /* Cambiando giorno l'orario scelto non vale piu': le 19:30 di domani non
     sono quelle di oggi, e un orario rimasto acceso finirebbe al checkout
     col giorno sbagliato. */
  function scegliGiorno(iso: string) {
    if (iso === giorno) return;
    setGiorno(iso);
    onGiorno?.(iso);
    setSelezionato(null);
    onSelect?.(null);
    caricaSlots(iso, () => true);
  }

  /* ⚠️ «AUJOURD'HUI», «DEMAIN» E UN CALENDARIO, come il widget delle
     prenotazioni (decisione di Enzo, 21/10/2026). Con la finestra aperta a
     sette o trenta giorni, una fila di trenta bottoni «ven. 23 oct.» si
     scorre di lato e non si legge; quasi tutti ordinano per oggi o domani.
     Oggi e domani restano bottoni sempre visibili — spenti se quel giorno
     non si puo' — e gli altri giorni si scelgono dal calendario, che accende
     SOLO i giorni della lista del server. Con due giorni o meno il
     calendario non serve e non c'e'. */
  const loc = lingua ?? lang;
  const base = oggi || giorni[0] || "";
  const domani = base ? giornoDopo(base) : "";
  const conCalendario = giorni.length > 2;
  const [calAperto, setCalAperto] = useState(false);
  const bottoni = conCalendario ? [base, domani] : giorni;
  const altroGiorno = conCalendario && giorno && giorno !== base && giorno !== domani ? giorno : null;
  const filaGiorni =
    giorni.length > 1 || (giorni.length === 1 && giorni[0] !== oggi) ? (
      <div className="slotpicker-scelta-giorno">
        <div className="slotpicker-giorni" role="group">
          {bottoni.map((g) => {
            const possibile = giorni.includes(g);
            return (
              <button
                key={g}
                type="button"
                className={"slotpicker-giorno" + (g === giorno ? " is-selected" : "")}
                aria-pressed={g === giorno}
                disabled={!possibile}
                onClick={() => { setCalAperto(false); scegliGiorno(g); }}
              >
                {etichettaGiorno(g, base, loc)}
              </button>
            );
          })}
        </div>
        {conCalendario && (
          <>
            <button
              type="button"
              className={"slotpicker-data" + (altroGiorno ? " is-selected" : "")}
              aria-expanded={calAperto}
              onClick={() => setCalAperto((v) => !v)}
            >
              {altroGiorno ? etichettaGiorno(altroGiorno, base, loc) : (ALTRA_DATA[loc] ?? ALTRA_DATA.fr)}
            </button>
            {calAperto && (
              <Calendario
                giorni={giorni}
                scelto={giorno}
                oggi={base}
                lingua={loc}
                onScegli={(g) => { setCalAperto(false); scegliGiorno(g); }}
              />
            )}
          </>
        )}
      </div>
    ) : null;

  let corpo;
  if (stato === "loading") {
    corpo = <p className="slotpicker-msg">{t("slot.loading")}</p>;
  } else if (stato === "errore") {
    corpo = <p className="slotpicker-msg">{t("slot.error")}</p>;
  } else if (stato === "chiuso") {
    corpo = (
      <p className="slotpicker-msg">
        {servizio === "consegna" ? (CONSEGNA_CHIUSA[lingua ?? lang] ?? CONSEGNA_CHIUSA.fr) : t("slot.closed")}
      </p>
    );
  } else {
    /* ⚠️ MIDI E SOIR SONO DUE SCHEDE, non due elenchi uno sotto l'altro
       (decisione di Enzo, 21/10/2026): con il pranzo e la cena aperti erano
       quattro o cinque righe di bottoni prima dei campi del cliente. Come nel
       widget delle prenotazioni, si sceglie la fascia e si vedono i suoi
       orari. Con una fascia sola (servizio continuato, o pranzo gia' finito)
       niente schede: solo gli orari. L'orario scelto resta scelto anche
       cambiando scheda: e' la scheda che si guarda, non la scelta. */
    const spezzato = lunch.length > 0 && dinner.length > 0;
    const mostrata = spezzato ? fascia : lunch.length > 0 ? "lunch" : "dinner";
    const slots = mostrata === "lunch" ? lunch : dinner;
    corpo = (
      <div className="slotpicker">
        {spezzato && (
          <div className="slotpicker-tabs" role="tablist">
            {(["lunch", "dinner"] as const).map((f) => {
              const conScelta = selezionato !== null && (f === "lunch" ? lunch : dinner).includes(selezionato);
              return (
                <button
                  key={f}
                  type="button"
                  role="tab"
                  aria-selected={mostrata === f}
                  className={"slotpicker-tab" + (mostrata === f ? " is-active" : "") + (conScelta ? " has-scelta" : "")}
                  onClick={() => setFascia(f)}
                >
                  {f === "lunch" ? t("slot.lunch") : t("slot.dinner")}
                </button>
              );
            })}
          </div>
        )}
        <FasciaSlot
          key={`${mostrata}-${giorno ?? ""}`}
          titolo={null}
          slots={slots}
          selezionato={selezionato}
          onScegli={scegli}
          labelPiu={t("slot.showAll")}
          labelMeno={t("slot.showLess")}
        />
      </div>
    );
  }

  // Senza scelta del giorno (finestra chiusa, o solo oggi) niente fila: come prima.
  if (!filaGiorni) return corpo;
  return (
    <div className="slotpicker-col-giorni">
      {filaGiorni}
      {corpo}
    </div>
  );
}

/**
 * IL CALENDARIO DEI GIORNI DI RITIRO — stesso disegno del widget delle
 * prenotazioni (`dp-*` la', `slotpicker-cal-*` qui), ma nel flusso della
 * pagina e non sopra: un pannello fisso dentro un modulo che scorre finiva
 * fuori schermo sul telefono (lo stesso guaio del widget dentro l'iframe).
 * ⚠️ Si accendono SOLO i giorni che il server ha mandato: e' lui che sa
 * quali giorni sono aperti e dentro la finestra. Il calendario non decide
 * niente, mostra.
 */
function Calendario({ giorni, scelto, oggi, lingua, onScegli }: {
  giorni: string[];
  scelto: string | null;
  oggi: string;
  lingua: string;
  onScegli: (iso: string) => void;
}) {
  const primo = scelto ?? giorni[0] ?? oggi;
  const [anno, setAnno] = useState(Number(primo.slice(0, 4)));
  const [mese, setMese] = useState(Number(primo.slice(5, 7)) - 1);
  const possibili = new Set(giorni);
  const meseDi = (iso: string) => iso.slice(0, 7);
  const chiave = `${anno}-${String(mese + 1).padStart(2, "0")}`;
  const primoMese = meseDi(giorni[0] ?? oggi);
  const ultimoMese = meseDi(giorni[giorni.length - 1] ?? oggi);
  const sposta = (d: number) => {
    let m = mese + d;
    let a = anno;
    if (m < 0) { m = 11; a--; }
    if (m > 11) { m = 0; a++; }
    setMese(m);
    setAnno(a);
  };
  let titolo = chiave;
  let dow: string[] = [];
  try {
    titolo = new Intl.DateTimeFormat(lingua, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(anno, mese, 1)));
    // Lunedi' per primo: 5 gennaio 2026 e' un lunedi'.
    dow = [0, 1, 2, 3, 4, 5, 6].map((i) =>
      new Intl.DateTimeFormat(lingua, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 5 + i))),
    );
  } catch { /* lingua sconosciuta: il numero del mese e niente intestazione */ }
  const vuote = (new Date(Date.UTC(anno, mese, 1)).getUTCDay() + 6) % 7;
  const nGiorni = new Date(Date.UTC(anno, mese + 1, 0)).getUTCDate();
  const celle: ReactElement[] = [];
  for (let i = 0; i < vuote; i++) celle.push(<span key={`v${i}`} className="slotpicker-cal-cella is-vuota" />);
  for (let g = 1; g <= nGiorni; g++) {
    const iso = `${chiave}-${String(g).padStart(2, "0")}`;
    const ok = possibili.has(iso);
    celle.push(
      <button
        key={iso}
        type="button"
        className={"slotpicker-cal-cella" + (iso === scelto ? " is-selected" : "") + (iso === oggi ? " is-oggi" : "")}
        disabled={!ok}
        onClick={() => onScegli(iso)}
      >
        {g}
      </button>,
    );
  }
  return (
    <div className="slotpicker-cal">
      <div className="slotpicker-cal-testa">
        <button type="button" className="slotpicker-cal-nav" disabled={chiave <= primoMese} onClick={() => sposta(-1)} aria-label="‹">‹</button>
        <span className="slotpicker-cal-titolo">{titolo}</span>
        <button type="button" className="slotpicker-cal-nav" disabled={chiave >= ultimoMese} onClick={() => sposta(1)} aria-label="›">›</button>
      </div>
      {dow.length > 0 && <div className="slotpicker-cal-dow">{dow.map((d, i) => <span key={i}>{d}</span>)}</div>}
      <div className="slotpicker-cal-griglia">{celle}</div>
    </div>
  );
}

interface FasciaSlotProps {
  titolo: string | null;
  slots: string[];
  selezionato: string | null;
  onScegli: (slot: string) => void;
  labelPiu: string;
  labelMeno: string;
}

function FasciaSlot({ titolo, slots, selezionato, onScegli, labelPiu, labelMeno }: FasciaSlotProps) {
  const [espanso, setEspanso] = useState(false);

  const troppi = slots.length > SLOT_VISIBILI;
  // Se lo slot selezionato è oltre i primi 12 (l'utente l'aveva scelto dopo
  // aver espanso) la lista resta aperta, così la sua scelta resta visibile.
  const idxSel = selezionato ? slots.indexOf(selezionato) : -1;
  const mostraTutti = !troppi || espanso || idxSel >= SLOT_VISIBILI;
  const visibili = mostraTutti ? slots : slots.slice(0, SLOT_VISIBILI);

  return (
    <div className="slotpicker-fascia">
      {titolo && <h4 className="slotpicker-titolo">{titolo}</h4>}
      <div className="slotpicker-grid">
        {visibili.map((slot) => (
          <SlotBtn key={slot} slot={slot} attivo={slot === selezionato} onClick={() => onScegli(slot)} />
        ))}
      </div>
      {troppi && (
        <button
          type="button"
          className="slotpicker-toggle"
          aria-expanded={mostraTutti}
          onClick={() => setEspanso((v) => !v)}
        >
          <span>{mostraTutti ? labelMeno : labelPiu}</span>
          <svg
            className={"slotpicker-toggle-ico" + (mostraTutti ? " is-open" : "")}
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SlotBtn({ slot, attivo, onClick }: { slot: string; attivo: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={"slotpicker-btn" + (attivo ? " is-selected" : "")}
      aria-pressed={attivo}
      onClick={onClick}
    >
      {slot}
    </button>
  );
}
