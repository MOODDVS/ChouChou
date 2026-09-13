/**
 * ATTESA VISIBILE — il bottone che ha fatto partire una richiesta lo dice.
 *
 * `disabled` da solo non e' un segnale: un bottone spento sembra un click che
 * non e' stato registrato, e chi lo usa ci riclicca sopra. Tre secondi di
 * silenzio, in sala, diventano cinque click e cinque richieste.
 *
 *     await conAttesa(del, async () => {
 *       const res = await fetch(…);
 *       …
 *     });
 *
 * Mentre il lavoro e' in corso: rotella al posto dell'etichetta (`.is-loading`
 * di button.css), bottone disabilitato, e i click successivi sullo stesso
 * bottone NON fanno partire una seconda richiesta.
 *
 * Il bottone puo' sparire mentre si lavora (la lista si ricarica e il nodo
 * viene sostituito): ripulire un nodo staccato non fa danni, quindi il
 * `finally` resta incondizionato.
 */
export async function conAttesa<T>(
  btn: HTMLElement | null | undefined,
  lavoro: () => Promise<T>,
): Promise<T | undefined> {
  if (!btn) return lavoro();
  if (btn.dataset.attesa) return undefined; // gia' in corso: il click si ignora
  btn.dataset.attesa = "1";
  // Cestini e bottoncini tondi stanno in 34px: la rotella grande li sborderebbe.
  const piccolo = btn.getBoundingClientRect().height < 40;
  btn.classList.add("is-loading");
  if (piccolo) btn.classList.add("is-loading-sm");
  const eraSpento = btn instanceof HTMLButtonElement ? btn.disabled : false;
  if (btn instanceof HTMLButtonElement) btn.disabled = true;
  try {
    return await lavoro();
  } finally {
    delete btn.dataset.attesa;
    btn.classList.remove("is-loading", "is-loading-sm");
    if (btn instanceof HTMLButtonElement) btn.disabled = eraSpento;
  }
}
