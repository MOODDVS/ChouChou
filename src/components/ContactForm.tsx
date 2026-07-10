import { useState } from "react";
import type { FormEvent, ChangeEvent } from "react";

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

export default function ContactForm({ t, lang = "fr" }: { t: Labels; lang?: "fr" | "en" }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [oggetto, setOggetto] = useState("");
  const [messaggio, setMessaggio] = useState("");
  const [accettato, setAccettato] = useState(false);
  const [stato, setStato] = useState<Stato>("idle");

  async function invia(e: FormEvent) {
    e.preventDefault();
    if (!accettato) return; // sicurezza: non invia senza consenso
    setStato("invio");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, telefono, oggetto, messaggio, lang }),
      });
      if (!res.ok) throw new Error();
      setStato("ok");
      setNome("");
      setEmail("");
      setTelefono("");
      setOggetto("");
      setMessaggio("");
      setAccettato(false);
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