/**
 * Un QR code come SVG, lato server (per i cartoncini da stampare).
 *
 * ⚠️ Un solo `<path>`, non un `<rect>` per modulo: un QR da tavolo ha qualche
 * centinaio di moduli scuri, e cento cartoncini sulla stessa pagina di
 * stampa farebbero decine di migliaia di elementi. `shape-rendering:
 * crispEdges` tiene i bordi netti alla stampa: un QR sfumato si legge male.
 *
 * Correzione d'errore «M»: il cartoncino sta su un tavolo, con le macchie di
 * sugo e il bicchiere appoggiato sopra. «M» regge il 15% di danni restando
 * piccolo; «H» farebbe un QR piu' fitto, piu' difficile da inquadrare.
 */
import qrcode from "qrcode-generator";

export function qrSvg(testo: string, margine = 2): string {
  const qr = qrcode(0, "M");
  qr.addData(testo, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const lato = n + margine * 2;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c + margine} ${r + margine}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lato} ${lato}" shape-rendering="crispEdges" role="img" aria-hidden="true"><rect width="${lato}" height="${lato}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
