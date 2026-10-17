import { useEffect, useState } from "react";
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

export default function SlotPicker({ onSelect, onGiorno, lang = "fr", lingua, sede = "" }: SlotPickerProps) {
  const conSede = (u: string) => urlConSede(u, sede);
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

  async function caricaSlots(data: string | null, vivo: () => boolean) {
    setStato("loading");
    try {
      // ⚠️ Gli orari di ritiro sono di UN punto: senza sede erano quelli del primo.
      const res = await fetch(data ? conSede(`/api/slots?date=${data}`) : conSede("/api/slots"));
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
        const res = await fetch(conSede("/api/slots?days=1"));
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
  }, [sede]); // ⚠️ `sede`: se la pagina cambia punto, giorni e orari vanno richiesti di nuovo.

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

  const filaGiorni =
    giorni.length > 1 || (giorni.length === 1 && giorni[0] !== oggi) ? (
      <div className="slotpicker-giorni" role="group">
        {giorni.map((g) => (
          <button
            key={g}
            type="button"
            className={"slotpicker-giorno" + (g === giorno ? " is-selected" : "")}
            aria-pressed={g === giorno}
            onClick={() => scegliGiorno(g)}
          >
            {etichettaGiorno(g, oggi || giorni[0], lingua ?? lang)}
          </button>
        ))}
      </div>
    ) : null;

  let corpo;
  if (stato === "loading") {
    corpo = <p className="slotpicker-msg">{t("slot.loading")}</p>;
  } else if (stato === "errore") {
    corpo = <p className="slotpicker-msg">{t("slot.error")}</p>;
  } else if (stato === "chiuso") {
    corpo = <p className="slotpicker-msg">{t("slot.closed")}</p>;
  } else {
    // I label "Midi"/"Soir" servono solo con orario spezzato: se il servizio
    // è continuato (una sola fascia con slot) si mostrano solo gli orari.
    const spezzato = lunch.length > 0 && dinner.length > 0;
    corpo = (
      <div className="slotpicker">
        {lunch.length > 0 && (
          <FasciaSlot
            key={`l-${giorno ?? ""}`}
            titolo={spezzato ? t("slot.lunch") : null}
            slots={lunch}
            selezionato={selezionato}
            onScegli={scegli}
            labelPiu={t("slot.showAll")}
            labelMeno={t("slot.showLess")}
          />
        )}

        {dinner.length > 0 && (
          <FasciaSlot
            key={`d-${giorno ?? ""}`}
            titolo={spezzato ? t("slot.dinner") : null}
            slots={dinner}
            selezionato={selezionato}
            onScegli={scegli}
            labelPiu={t("slot.showAll")}
            labelMeno={t("slot.showLess")}
          />
        )}
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
