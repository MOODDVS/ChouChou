import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { useTranslations } from "../i18n/ui";

type Stato = "form" | "invio" | "ok" | "errore";
type Fascia = "lunch" | "dinner";

interface Slots {
  lunch: string[];
  dinner: string[];
}
interface CalendarInfo {
  closedWeekdays: number[];
  closedDates: string[];
}

interface BookingModalProps {
  lang?: "fr" | "en";
}

function iso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const g = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${g}`;
}
function isoLeggibile(s: string): string {
  if (!s) return "";
  const [y, m, g] = s.split("-").map((n) => parseInt(n, 10));
  return `${String(g).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y}`;
}

export default function BookingModal({ lang = "fr" }: BookingModalProps) {
  const t = useTranslations(lang);
  const MESI = t("cal.months").split(",");
  const GIORNI = t("cal.days").split(",");

  const [aperto, setAperto] = useState(false);
  const [stato, setStato] = useState<Stato>("form");
  const [erroreMsg, setErroreMsg] = useState("");

  const [prenom, setPrenom] = useState("");
  const [nom, setNom] = useState("");
  const [email, setEmail] = useState("");
  const [telephone, setTelephone] = useState("");
  const [date, setDate] = useState("");
  const [heure, setHeure] = useState("");
  const [personnes, setPersonnes] = useState("2");
  const [isSociete, setIsSociete] = useState(false);
  const [societe, setSociete] = useState("");
  const [notes, setNotes] = useState("");
  const [accettato, setAccettato] = useState(false);

  const [calInfo, setCalInfo] = useState<CalendarInfo>({ closedWeekdays: [], closedDates: [] });
  const [calOpen, setCalOpen] = useState(false);
  const [mese, setMese] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const [slots, setSlots] = useState<Slots>({ lunch: [], dinner: [] });
  const [fascia, setFascia] = useState<Fascia>("dinner");
  const [caricandoSlot, setCaricandoSlot] = useState(false);

  const calRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function apri() {
      setAperto(true);
      setStato("form");
    }
    window.addEventListener("open-booking", apri);
    return () => window.removeEventListener("open-booking", apri);
  }, []);

  useEffect(() => {
    if (!aperto) return;
    fetch("/api/calendar-info")
      .then((r) => r.json())
      .then((d: CalendarInfo) => {
        setCalInfo({
          closedWeekdays: d.closedWeekdays ?? [],
          closedDates: d.closedDates ?? [],
        });
      })
      .catch(() => setCalInfo({ closedWeekdays: [], closedDates: [] }));
  }, [aperto]);

  useEffect(() => {
    if (aperto && !date) {
      const primo = primoGiornoUtile();
      if (primo) {
        setDate(iso(primo));
        setMese(new Date(primo.getFullYear(), primo.getMonth(), 1));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aperto, calInfo]);

  useEffect(() => {
    if (!aperto) return;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (calOpen) setCalOpen(false);
        else chiudi();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [aperto, calOpen]);

  useEffect(() => {
    if (!calOpen) return;
    function onClick(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setCalOpen(false);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [calOpen]);

  useEffect(() => {
    if (!date) return;
    caricaSlot(date);
    setHeure("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  function weekdayDB(d: Date): number {
    return d.getDay();
  }

  function isGiornoChiuso(d: Date): boolean {
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);
    if (d < oggi) return true;
    if (calInfo.closedWeekdays.includes(weekdayDB(d))) return true;
    if (calInfo.closedDates.includes(iso(d))) return true;
    return false;
  }

  function primoGiornoUtile(): Date | null {
    const base = new Date();
    base.setHours(0, 0, 0, 0);
    for (let i = 0; i < 60; i++) {
      const d = new Date(base);
      d.setDate(base.getDate() + i);
      if (!isGiornoChiuso(d)) return d;
    }
    return null;
  }

  async function caricaSlot(d: string) {
    setCaricandoSlot(true);
    try {
      const res = await fetch(`/api/booking-slots?date=${d}`);
      const data: Slots = await res.json();
      const s: Slots = { lunch: data.lunch ?? [], dinner: data.dinner ?? [] };
      setSlots(s);
      setFascia(s.dinner.length > 0 ? "dinner" : "lunch");
    } catch {
      setSlots({ lunch: [], dinner: [] });
    } finally {
      setCaricandoSlot(false);
    }
  }

  function chiudi() {
    setAperto(false);
    setCalOpen(false);
  }

  function celleMese(): (Date | null)[] {
    const anno = mese.getFullYear();
    const m = mese.getMonth();
    const primo = new Date(anno, m, 1);
    const giorniNelMese = new Date(anno, m + 1, 0).getDate();
    const jsDay = primo.getDay();
    const offset = jsDay === 0 ? 6 : jsDay - 1;
    const celle: (Date | null)[] = [];
    for (let i = 0; i < offset; i++) celle.push(null);
    for (let g = 1; g <= giorniNelMese; g++) celle.push(new Date(anno, m, g));
    return celle;
  }

  function scegliGiorno(d: Date) {
    if (isGiornoChiuso(d)) return;
    setDate(iso(d));
    setCalOpen(false);
  }

  function meseProssimo() {
    setMese(new Date(mese.getFullYear(), mese.getMonth() + 1, 1));
  }
  function mesePrecedente() {
    setMese(new Date(mese.getFullYear(), mese.getMonth() - 1, 1));
  }

  const meseCorrenteOPassato = (() => {
    const oggi = new Date();
    const inizioMeseCorrente = new Date(oggi.getFullYear(), oggi.getMonth(), 1);
    return mese <= inizioMeseCorrente;
  })();

  const emailValida = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  const formValido =
    prenom.trim() &&
    nom.trim() &&
    emailValida &&
    telephone.trim() &&
    date &&
    heure &&
    personnes &&
    (!isSociete || societe.trim()) &&
    accettato;

  async function invia(e: FormEvent) {
    e.preventDefault();
    if (!formValido || stato === "invio") return;
    setStato("invio");
    setErroreMsg("");
    try {
      const res = await fetch("/api/booking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prenom, nom, email, telephone, date, heure, personnes,
          societe: isSociete ? societe : "",
          notes,
          lang,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErroreMsg(data.error ?? t("book.errSend"));
        setStato("errore");
        return;
      }
      setStato("ok");
    } catch {
      setErroreMsg(t("book.errConnection"));
      setStato("errore");
    }
  }

  if (!aperto) return null;

  const slotAttivi = fascia === "lunch" ? slots.lunch : slots.dinner;
  const nessunoSlot = !caricandoSlot && slots.lunch.length === 0 && slots.dinner.length === 0;
  const celle = celleMese();

  return (
    <div className="bk-overlay" onClick={chiudi}>
      <div className="bk-modal" onClick={(e) => e.stopPropagation()}>
        {stato === "ok" ? (
          <div className="bk-done">
            <p className="bk-claim">THIS IS PIZZERIA 77</p>
            <h2 className="bk-title">{t("book.doneTitle")}</h2>
            <p className="bk-sub">{t("book.doneText").replace("{name}", prenom)}</p>
            <button type="button" className="bk-submit" onClick={chiudi}>{t("book.close")}</button>
          </div>
        ) : (
          <>
            <p className="bk-claim">THIS IS PIZZERIA 77</p>
            <h2 className="bk-title">{t("book.title")}</h2>

            <form className="bk-form" onSubmit={invia}>
              <div className="bk-row bk-row--stack">
                <input className="bk-input" type="text" placeholder={t("book.firstName")} value={prenom} onChange={(e) => setPrenom(e.target.value)} />
                <input className="bk-input" type="text" placeholder={t("book.lastName")} value={nom} onChange={(e) => setNom(e.target.value)} />
              </div>
              <div className="bk-row bk-row--stack">
                <input className="bk-input" type="email" placeholder={t("book.email")} value={email} onChange={(e) => setEmail(e.target.value)} />
                <input className="bk-input" type="tel" placeholder={t("book.phone")} value={telephone} onChange={(e) => setTelephone(e.target.value)} />
              </div>

              <div className="bk-row bk-row--datepeople">
                <div className="bk-field" ref={calRef} style={{ position: "relative" }}>
                  <span className="bk-label">{t("book.date")}</span>
                  <button
                    type="button"
                    className="bk-input bk-datebtn"
                    onClick={() => setCalOpen((v) => !v)}
                  >
                    {date ? isoLeggibile(date) : t("book.chooseDate")}
                  </button>

                  {calOpen && (
                    <div className="bk-cal">
                      <div className="bk-cal-head">
                        <button type="button" className="bk-cal-nav" onClick={mesePrecedente} disabled={meseCorrenteOPassato} aria-label={t("book.aria.prevMonth")}>‹</button>
                        <span className="bk-cal-title">{MESI[mese.getMonth()]} {mese.getFullYear()}</span>
                        <button type="button" className="bk-cal-nav" onClick={meseProssimo} aria-label={t("book.aria.nextMonth")}>›</button>
                      </div>
                      <div className="bk-cal-grid bk-cal-dow">
                        {GIORNI.map((g) => <span key={g} className="bk-cal-dowcell">{g}</span>)}
                      </div>
                      <div className="bk-cal-grid">
                        {celle.map((d, i) =>
                          d === null ? (
                            <span key={`e${i}`} className="bk-cal-cell is-empty" />
                          ) : (
                            <button
                              key={iso(d)}
                              type="button"
                              className={
                                "bk-cal-cell" +
                                (isGiornoChiuso(d) ? " is-disabled" : "") +
                                (date === iso(d) ? " is-selected" : "")
                              }
                              disabled={isGiornoChiuso(d)}
                              onClick={() => scegliGiorno(d)}
                            >
                              {d.getDate()}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="bk-field">
                  <span className="bk-label">{t("book.people")}</span>
                  <div className="bk-stepper">
                    <button
                      type="button"
                      className="bk-step"
                      onClick={() => setPersonnes((p) => String(Math.max(1, parseInt(p, 10) - 1)))}
                      disabled={parseInt(personnes, 10) <= 1}
                      aria-label={t("book.peopleLess")}
                    >−</button>
                    <span className="bk-step-val" aria-live="polite">{personnes}</span>
                    <button
                      type="button"
                      className="bk-step"
                      onClick={() => setPersonnes((p) => String(Math.min(10, parseInt(p, 10) + 1)))}
                      disabled={parseInt(personnes, 10) >= 10}
                      aria-label={t("book.peopleMore")}
                    >+</button>
                  </div>
                </div>
              </div>

              <div className="bk-slots">
                <span className="bk-label">{t("book.time")}</span>
                {nessunoSlot ? (
                  <p className="bk-slot-msg">{t("book.noSlotsDay")}</p>
                ) : (
                  <>
                    <div className="bk-tabs">
                      <button type="button" className={"bk-tab" + (fascia === "lunch" ? " is-active" : "")} onClick={() => setFascia("lunch")} disabled={slots.lunch.length === 0}>{t("slot.lunch")}</button>
                      <button type="button" className={"bk-tab" + (fascia === "dinner" ? " is-active" : "")} onClick={() => setFascia("dinner")} disabled={slots.dinner.length === 0}>{t("slot.dinner")}</button>
                    </div>
                    {caricandoSlot ? (
                      <p className="bk-slot-msg">{t("slot.loadingShort")}</p>
                    ) : slotAttivi.length === 0 ? (
                      <p className="bk-slot-msg">{t("book.noSlotsService")}</p>
                    ) : (
                      <div className="bk-slot-grid">
                        {slotAttivi.map((s) => (
                          <button key={s} type="button" className={"bk-slot" + (heure === s ? " is-selected" : "")} onClick={() => setHeure(s)}>{s}</button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <label className="bk-check">
                <input type="checkbox" checked={isSociete} onChange={(e) => setIsSociete(e.target.checked)} />
                <span>{t("book.isCompany")}</span>
              </label>
              {isSociete && (
                <input className="bk-input" type="text" placeholder={t("book.companyName")} value={societe} onChange={(e) => setSociete(e.target.value)} />
              )}

              <textarea className="bk-textarea" rows={3} placeholder={t("book.notesPlaceholder")} value={notes} onChange={(e) => setNotes(e.target.value)} />

              <label className="bk-check bk-consent">
                <input type="checkbox" checked={accettato} onChange={(e) => setAccettato(e.target.checked)} />
                <span>
                  {t("book.consentPre")}
                  <a href={lang === "en" ? "/en/privacy" : "/privacy"} target="_blank" rel="noopener">{t("book.consentLink")}</a>
                </span>
              </label>

              {stato === "errore" && <p className="bk-error">{erroreMsg}</p>}

              <button type="submit" className="bk-submit" disabled={!formValido || stato === "invio"}>
                {stato === "invio" ? t("book.submitting") : t("book.submit")}
              </button>
              <p className="bk-note">{t("book.disclaimer")}</p>
            </form>
          </>
        )}

        <button
          type="button"
          className="bk-close-fab"
          onClick={chiudi}
          aria-label={t("book.close")}
        >
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" stroke="#000" stroke-width="2.5" stroke-linecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}