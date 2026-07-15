import { useEffect, useState } from "react";
import { useTranslations } from "../i18n/ui";

interface SlotPickerProps {
  onSelect?: (slot: string | null) => void;
  lang?: "fr" | "en";
}

type Stato = "loading" | "ok" | "chiuso" | "errore";

// La griglia è a 4 colonne (vedi CSS .slotpicker-grid). Quando gli orari di
// una fascia superano 3 righe (12 slot) la lista si accorcia e compare un
// bottone per mostrarli/nasconderli tutti.
const SLOT_VISIBILI = 12;

export default function SlotPicker({ onSelect, lang = "fr" }: SlotPickerProps) {
  const t = useTranslations(lang);

  const [stato, setStato] = useState<Stato>("loading");
  const [lunch, setLunch] = useState<string[]>([]);
  const [dinner, setDinner] = useState<string[]>([]);
  const [selezionato, setSelezionato] = useState<string | null>(null);

  useEffect(() => {
    let attivo = true;

    async function caricaSlots() {
      try {
        const res = await fetch("/api/slots");
        if (!res.ok) {
          if (attivo) setStato("errore");
          return;
        }
        const data: { lunch: string[]; dinner: string[] } = await res.json();
        if (!attivo) return;

        if (data.lunch.length === 0 && data.dinner.length === 0) {
          setStato("chiuso");
        } else {
          setLunch(data.lunch);
          setDinner(data.dinner);
          setStato("ok");
        }
      } catch {
        if (attivo) setStato("errore");
      }
    }

    caricaSlots();
    return () => {
      attivo = false;
    };
  }, []);

  function scegli(slot: string) {
    const nuovo = slot === selezionato ? null : slot;
    setSelezionato(nuovo);
    onSelect?.(nuovo);
  }

  if (stato === "loading") {
    return <p className="slotpicker-msg">{t("slot.loading")}</p>;
  }
  if (stato === "errore") {
    return <p className="slotpicker-msg">{t("slot.error")}</p>;
  }
  if (stato === "chiuso") {
    return <p className="slotpicker-msg">{t("slot.closed")}</p>;
  }

  // I label "Midi"/"Soir" servono solo con orario spezzato: se il servizio
  // è continuato (una sola fascia con slot) si mostrano solo gli orari.
  const spezzato = lunch.length > 0 && dinner.length > 0;

  return (
    <div className="slotpicker">
      {lunch.length > 0 && (
        <FasciaSlot
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
