import { useEffect, useState } from "react";
import { useTranslations } from "../i18n/ui";

interface SlotPickerProps {
  onSelect?: (slot: string | null) => void;
  lang?: "fr" | "en";
}

type Stato = "loading" | "ok" | "chiuso" | "errore";

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
        <div className="slotpicker-fascia">
          {spezzato && <h4 className="slotpicker-titolo">{t("slot.lunch")}</h4>}
          <div className="slotpicker-grid">
            {lunch.map((slot) => (
              <SlotBtn key={slot} slot={slot} attivo={slot === selezionato} onClick={() => scegli(slot)} />
            ))}
          </div>
        </div>
      )}

      {dinner.length > 0 && (
        <div className="slotpicker-fascia">
          {spezzato && <h4 className="slotpicker-titolo">{t("slot.dinner")}</h4>}
          <div className="slotpicker-grid">
            {dinner.map((slot) => (
              <SlotBtn key={slot} slot={slot} attivo={slot === selezionato} onClick={() => scegli(slot)} />
            ))}
          </div>
        </div>
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