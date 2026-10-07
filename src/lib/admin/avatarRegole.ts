/**
 * IL CERCHIO DI UNA PERSONA — iniziali e colore, uguali ovunque.
 *
 * ⚠️ Queste due righe erano dentro il carosello delle recensioni Google, in
 * una chiusura che nessun altro poteva vedere. Alla seconda persona da
 * disegnare — chi riceve una nota — la via corta era ricopiarle: due funzioni
 * uguali oggi, due colori diversi per lo stesso nome il giorno in cui una
 * delle due cambia. E un colore «stabile» che cambia da una schermata
 * all'altra e' peggio di nessun colore, perche' smette di identificare.
 */

/** «Vincenzo Santamaria» → «VS». Vuoto o impronunciabile → «?». */
export function iniziali(nome: string): string {
  return (
    String(nome ?? "")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0] ?? "")
      .join("")
      .toUpperCase() || "?"
  );
}

/**
 * Un colore RICAVATO DAL NOME: la stessa persona ha sempre lo stesso cerchio,
 * e due persone diverse quasi mai lo stesso.
 *
 * ⚠️ Saturazione e luminosita' fisse, varia solo la tinta: lasciandole libere
 * uscirebbero anche grigi slavati e gialli accecanti, e il cerchio
 * smetterebbe di essere leggibile proprio per qualcuno — sempre lo stesso.
 */
export function coloreDi(nome: string): string {
  let h = 0;
  const n = String(nome ?? "");
  for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) % 360;
  return `hsl(${h}, 42%, 38%)`;
}
