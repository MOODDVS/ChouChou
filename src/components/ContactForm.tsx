import { useState } from "react";
import type { FormEvent, ChangeEvent } from "react";
import { urlConSede } from "../lib/sedeUrl";

type Stato = "idle" | "invio" | "ok" | "errore";

interface Labels {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
  send: string;
  sending: string;
  successTitle: string;
  error: string;
  consentPre: string;   // testo prima del link, es. "J'accepte la "
  consentLink: string;  // testo del link, es. "politique de confidentialité"
  privacyHref: string;  // "/privacy" oppure "/en/privacy"
}

// ⚠️ Anche il modulo contatti ha un punto: il messaggio arriva nella casella
// di QUELLA sede. Senza, finiva sempre in quella della prima.
export default function ContactForm({ t, lang = "fr", sede = "" }: { t: Labels; lang?: "fr" | "en"; sede?: string }) {
  const conSede = (u: string) => urlConSede(u, sede);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [messaggio, setMessaggio] = useState("");
  const [accettato, setAccettato] = useState(false);
  /**
   * IL TRANELLO ANTISPAM — un campo che una persona non vede e non compila
   * mai, e che un programma automatico riempie perche' riempie tutto. Chi lo
   * compila si e' dichiarato robot da solo, e il motore butta via l'invio
   * rispondendo «grazie» (vedi `api/contact.ts`).
   *
   * ⚠️ SI CHIAMA `website` E NON `societe`, e non e' un dettaglio: quando il
   * CAMPO si chiamava `societe`, Chrome lo riempiva da solo con
   * l'organizzazione dell'utente — `autocomplete="off"` non lo ferma — e il
   * server buttava via i messaggi VERI. La CHIAVE spedita resta `societe`:
   * nome del campo e nome della chiave sono due cose diverse apposta.
   */
  const [tranello, setTranello] = useState("");
  const [stato, setStato] = useState<Stato>("idle");

  async function invia(e: FormEvent) {
    e.preventDefault();
    if (!accettato) return; // sicurezza: non invia senza consenso
    setStato("invio");
    try {
      const res = await fetch(conSede("/api/contact"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // ⚠️ `cgu` VIAGGIA. Prima la spunta viveva solo qui dentro: chi manda
        // la richiesta scavalcando la pagina — cioe' un robot — la saltava, e
        // non restava traccia di chi avesse acconsentito. Adesso il motore la
        // scrive con data e ora nell'email che il ristoratore riceve.
        body: JSON.stringify({ nome, email, telefono, oggetto, messaggio, lang, societe: tranello, cgu: accettato }),
      });
      if (!res.ok) throw new Error();
      setStato("ok");
      setNome("");
      setEmail("");
      setTelefono("");
      setOggetto("");
      setMessaggio("");
      setAccettato(false);
      setTranello("");
    } catch {
      setStato("errore");
    }
  }

  if (stato === "ok") {
    return (
      <div className="cf-success">
        <p>{t.successTitle}</p>
      </div>
    );
  }

  return (
    <form className="cf" onSubmit={invia}>
      <div className="cf-row">
        <input
          className="cf-input"
          type="text"
          placeholder={`${t.name} *`}
          value={nome}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setNome(e.target.value)}
          required
        />
        <input
          className="cf-input"
          type="email"
          placeholder={`${t.email} *`}
          value={email}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setEmail(e.target.value)}
          required
        />
      </div>
      <div className="cf-row">
        <input
          className="cf-input"
          type="tel"
          placeholder={t.phone}
          value={telefono}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setTelefono(e.target.value)}
        />
        <input
          className="cf-input"
          type="text"
          placeholder={t.subject}
          value={oggetto}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setOggetto(e.target.value)}
        />
      </div>
      <textarea
        className="cf-textarea"
        placeholder={`${t.message} *`}
        rows={6}
        value={messaggio}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setMessaggio(e.target.value)}
        required
      />

      {/* ⚠️ NASCOSTO AGLI OCCHI E AI LETTORI DI SCHERMO, ma non con
          `display:none`: i programmi automatici piu' svegli saltano i campi
          spenti, e un campo che nessuno compila mai non prende nessuno.
          Fuori dallo schermo e fuori dall'ordine di tabulazione: chi naviga
          da tastiera non ci casca dentro, chi usa un lettore di schermo non
          lo sente, un robot che legge il modulo lo trova e lo riempie.
          ⚠️ `aria-hidden` SUL CONTENITORE e `tabIndex={-1}` sul campo: senza
          il secondo, il campo resta raggiungibile col tasto Tab anche se
          nessuno lo annuncia — e un utente da tastiera si ritroverebbe a
          scrivere in una casella invisibile che gli cancella il messaggio. */}
      <div
        aria-hidden="true"
        style={{ position: "absolute", left: "-9999px", width: "1px", height: "1px", overflow: "hidden" }}
      >
        <label>
          Site web
          <input
            type="text"
            name="website"
            tabIndex={-1}
            autoComplete="off"
            value={tranello}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setTranello(e.target.value)}
          />
        </label>
      </div>

      <label className="cf-consent">
        <input
          type="checkbox"
          className="cf-consent__box"
          checked={accettato}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setAccettato(e.target.checked)}
          required
        />
        <span>
          {t.consentPre}
          <a href={t.privacyHref} target="_blank" rel="noopener">
            {t.consentLink}
          </a>
        </span>
      </label>

      {stato === "errore" && <p className="cf-error">{t.error}</p>}
      <button
        className="cf-btn"
        type="submit"
        disabled={stato === "invio" || !accettato}
      >
        {stato === "invio" ? t.sending : t.send}
      </button>
    </form>
  );
}