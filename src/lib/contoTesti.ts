/**
 * LE PAROLE DEL CONTO APERTO sulla pagina del tavolo (conto-aperto.md).
 *
 * ⚠️ QUI, NEL MOTORE, e non nel dizionario pubblico: `src/i18n/**` e' del
 * cliente (`merge=ours`), e una chiave nuova messa la' non arriverebbe mai a
 * nessuno — sul tavolo si leggerebbe «tab.open». Lo stesso motivo per cui le
 * parole della pagina stanno in `PaginaTavolo.astro`.
 *
 * `{i}` = l'iniziale di chi ha aperto, `{n}`/`{p}` = chi ha ordinato / su
 * quanti, `{k}` = il numero dell'invio.
 */
export interface TestiConto {
  apri: string;
  apriSotto: string;
  /** Da soli (1 persona): lo stesso conto, «Payer sur place». */
  apriSolo: string;
  apriSoloSotto: string;
  aggiungi: string;
  invio: string;
  giaAperto: string;
  codice: string;
  codicePh: string;
  unisciti: string;
  errCodice: string;
  errBloccato: string;
  errGenerico: string;
  nonNostro: string;
  nonNostroTesto: string;
  sulConto: string;
  mia: string;
  titolo: string;
  attesa: string;
  aperta: string;
  invita: string;
  invitaTesto: string;
  ordinato: string;
  invioN: string;
  inCucina: string;
  inAttesa: string;
  togli: string;
  errTogli: string;
  totale: string;
  vuoto: string;
  chiedi: string;
  chiesto: string;
  errChiedi: string;
  ancora: string;
  /** Il conto e' stato chiuso dal personale (incassato o rifiutato). */
  chiuso: string;
  /* ── Pagare l'addizione online (fase 4). `{x}` = un importo. ── */
  paga: string;
  pagaMio: string;
  pagaParte: string;
  pagaResto: string;
  pagaMancia: string;
  pagaNessuna: string;
  pagaBtn: string;
  pagaIndietro: string;
  giaPagato: string;
  resta: string;
  inCorso: string;
  errInCorso: string;
  errNiente: string;
  errPaga: string;
  pagatoOk: string;
  /** Pagato tutto: il conto si e' chiuso da solo. */
  saldato: string;
  /** Nel conto il tavolo non si cambia dal telefono. */
  tavoloBloccato: string;
  /** «Payer»: il bottone della modale, la pillola in fondo, il titolo
   *  della schermata con le due strade. */
  pagaTit: string;
  pagaOnline: string;
  oppure: string;
}

export const TESTI_CONTO: Record<string, TestiConto> = {
  fr: {
    apri: "Ouvrir un compte", apriSotto: "Commandez maintenant, payez à la fin. Vos amis rejoignent avec un code.",
    apriSolo: "Payer sur place", apriSoloSotto: "Commandez maintenant, payez à la fin.",
    aggiungi: "Ajouter à l’addition", invio: "Envoi…",
    giaAperto: "Une addition est déjà ouverte sur cette table ({i}). Entrez son code pour la rejoindre.",
    codice: "Code de l’addition", codicePh: "2 chiffres", unisciti: "Rejoindre",
    errCodice: "Ce n’est pas le bon code.", errBloccato: "Trop d’essais. Réessayez dans quelques minutes, ou demandez au serveur.",
    errGenerico: "Impossible pour le moment. Réessayez.",
    nonNostro: "Ce n’est pas notre table", nonNostroTesto: "Demandez à un serveur : il libère la table.",
    sulConto: "Vous êtes sur l’addition de cette table : votre commande s’y ajoute.",
    mia: "Addition", titolo: "Votre addition",
    attesa: "Votre commande attend la confirmation du serveur. Vous pouvez encore ajouter ou retirer vos plats.",
    aperta: "Addition ouverte : vos commandes partent en cuisine.",
    invita: "Code pour vos amis", invitaTesto: "Ils scannent ce QR code, ou entrent le code sur la page de la table.",
    ordinato: "{n}/{p} ont commandé", invioN: "Envoi {k}", inCucina: "en cuisine", inAttesa: "en attente",
    togli: "Retirer", errTogli: "Trop tard : c’est déjà en cuisine. Demandez au serveur.",
    totale: "Total", vuoto: "Rien encore sur l’addition.",
    chiedi: "Demander l’addition", chiesto: "C’est noté : le serveur apporte l’addition.",
    errChiedi: "La demande n’est pas passée. Faites signe à un serveur.",
    ancora: "Commander autre chose",
    chiuso: "Votre addition a été fermée par le serveur.",
    paga: "Payer l’addition", pagaMio: "Ce que j’ai commandé", pagaParte: "Une part égale", pagaResto: "Tout le reste",
    pagaMancia: "Pourboire", pagaNessuna: "Aucun", pagaBtn: "Payer {x}", pagaIndietro: "Retour",
    giaPagato: "Déjà payé", resta: "Reste à payer", inCorso: "Paiement en cours : {x}",
    errInCorso: "Cette part est déjà en cours de paiement. Réessayez dans un instant.",
    errNiente: "Il n’y a plus rien à payer avec ce choix.",
    errPaga: "Le paiement n’a pas pu démarrer. Réessayez, ou demandez au serveur.",
    pagatoOk: "Merci ! Votre paiement est bien reçu.",
    saldato: "Merci ! L’addition est réglée. À bientôt !",
    tavoloBloccato: "Votre addition est ouverte sur cette table. Pour changer de table, demandez au serveur.",
    pagaTit: "Payer", pagaOnline: "Payer en ligne", oppure: "ou",
  },
  en: {
    apri: "Open a tab", apriSotto: "Order now, pay at the end. Your friends join with a code.",
    apriSolo: "Pay on site", apriSoloSotto: "Order now, pay at the end.",
    aggiungi: "Add to the bill", invio: "Sending…",
    giaAperto: "A bill is already open at this table ({i}). Enter its code to join.",
    codice: "Bill code", codicePh: "2 digits", unisciti: "Join",
    errCodice: "That’s not the right code.", errBloccato: "Too many tries. Try again in a few minutes, or ask the waiter.",
    errGenerico: "Not possible right now. Please try again.",
    nonNostro: "This isn’t our table", nonNostroTesto: "Ask a member of staff: they will free the table.",
    sulConto: "You’re on this table’s bill: your order is added to it.",
    mia: "Bill", titolo: "Your bill",
    attesa: "Your order is waiting for the waiter’s confirmation. You can still add or remove your dishes.",
    aperta: "Bill open: your orders go to the kitchen.",
    invita: "Code for your friends", invitaTesto: "They scan this QR code, or enter the code on the table page.",
    ordinato: "{n}/{p} have ordered", invioN: "Round {k}", inCucina: "in the kitchen", inAttesa: "waiting",
    togli: "Remove", errTogli: "Too late: it’s already in the kitchen. Please ask the waiter.",
    totale: "Total", vuoto: "Nothing on the bill yet.",
    chiedi: "Ask for the bill", chiesto: "Got it: the waiter is bringing the bill.",
    errChiedi: "The request didn’t go through. Please wave to a member of staff.",
    ancora: "Order something else",
    chiuso: "Your bill has been closed by the waiter.",
    paga: "Pay the bill", pagaMio: "What I ordered", pagaParte: "An equal share", pagaResto: "Everything left",
    pagaMancia: "Tip", pagaNessuna: "None", pagaBtn: "Pay {x}", pagaIndietro: "Back",
    giaPagato: "Already paid", resta: "Left to pay", inCorso: "Payment in progress: {x}",
    errInCorso: "This share is already being paid. Try again in a moment.",
    errNiente: "There is nothing left to pay with this choice.",
    errPaga: "The payment could not start. Try again, or ask the waiter.",
    pagatoOk: "Thank you! Your payment has been received.",
    saldato: "Thank you! The bill is settled. See you soon!",
    tavoloBloccato: "Your bill is open at this table. To change tables, ask the waiter.",
    pagaTit: "Pay", pagaOnline: "Pay online", oppure: "or",
  },
  it: {
    apri: "Apri un conto", apriSotto: "Ordina adesso, paga alla fine. I tuoi amici si uniscono con un codice.",
    apriSolo: "Paga sul posto", apriSoloSotto: "Ordina adesso, paga alla fine.",
    aggiungi: "Aggiungi al conto", invio: "Invio…",
    giaAperto: "C’è già un conto aperto su questo tavolo ({i}). Inserisci il suo codice per unirti.",
    codice: "Codice del conto", codicePh: "2 cifre", unisciti: "Unisciti",
    errCodice: "Il codice non è quello giusto.", errBloccato: "Troppi tentativi. Riprova tra qualche minuto, o chiedi al cameriere.",
    errGenerico: "Non è possibile adesso. Riprova.",
    nonNostro: "Non è il nostro tavolo", nonNostroTesto: "Chiedi a un cameriere: libera lui il tavolo.",
    sulConto: "Sei sul conto di questo tavolo: il tuo ordine si aggiunge.",
    mia: "Conto", titolo: "Il vostro conto",
    attesa: "Il vostro ordine aspetta la conferma del cameriere. Potete ancora aggiungere o togliere i vostri piatti.",
    aperta: "Conto aperto: i vostri ordini vanno in cucina.",
    invita: "Codice per i tuoi amici", invitaTesto: "Inquadrano questo QR code, o scrivono il codice sulla pagina del tavolo.",
    ordinato: "{n}/{p} hanno ordinato", invioN: "Invio {k}", inCucina: "in cucina", inAttesa: "in attesa",
    togli: "Togli", errTogli: "Troppo tardi: è già in cucina. Chiedi al cameriere.",
    totale: "Totale", vuoto: "Ancora niente sul conto.",
    chiedi: "Chiedi il conto", chiesto: "Fatto: il cameriere porta il conto.",
    errChiedi: "La richiesta non è partita. Fate un cenno a un cameriere.",
    ancora: "Ordina altro",
    chiuso: "Il vostro conto è stato chiuso dal cameriere.",
    paga: "Paga il conto", pagaMio: "Quello che ho ordinato", pagaParte: "Una parte uguale", pagaResto: "Tutto il resto",
    pagaMancia: "Mancia", pagaNessuna: "Nessuna", pagaBtn: "Paga {x}", pagaIndietro: "Indietro",
    giaPagato: "Già pagato", resta: "Resta da pagare", inCorso: "Pagamento in corso: {x}",
    errInCorso: "Questa parte è già in pagamento. Riprovate tra un attimo.",
    errNiente: "Non resta niente da pagare con questa scelta.",
    errPaga: "Il pagamento non è partito. Riprovate, o chiedete al cameriere.",
    pagatoOk: "Grazie! Il pagamento è arrivato.",
    saldato: "Grazie! Il conto è saldato. A presto!",
    tavoloBloccato: "Il vostro conto è aperto su questo tavolo. Per cambiare tavolo, chiedete al cameriere.",
    pagaTit: "Paga", pagaOnline: "Paga online", oppure: "oppure",
  },
  nl: {
    apri: "Rekening openen", apriSotto: "Bestel nu, betaal op het einde. Je vrienden doen mee met een code.",
    apriSolo: "Ter plaatse betalen", apriSoloSotto: "Bestel nu, betaal op het einde.",
    aggiungi: "Toevoegen aan de rekening", invio: "Verzenden…",
    giaAperto: "Aan deze tafel is al een rekening open ({i}). Geef de code in om mee te doen.",
    codice: "Code van de rekening", codicePh: "2 cijfers", unisciti: "Meedoen",
    errCodice: "Dat is niet de juiste code.", errBloccato: "Te veel pogingen. Probeer over enkele minuten opnieuw, of vraag het aan de ober.",
    errGenerico: "Nu niet mogelijk. Probeer opnieuw.",
    nonNostro: "Dit is niet onze tafel", nonNostroTesto: "Vraag het aan een ober: die maakt de tafel vrij.",
    sulConto: "Je zit op de rekening van deze tafel: je bestelling wordt toegevoegd.",
    mia: "Rekening", titolo: "Jullie rekening",
    attesa: "Jullie bestelling wacht op de bevestiging van de ober. Je kunt nog gerechten toevoegen of verwijderen.",
    aperta: "Rekening open: jullie bestellingen gaan naar de keuken.",
    invita: "Code voor je vrienden", invitaTesto: "Ze scannen deze QR-code, of geven de code in op de pagina van de tafel.",
    ordinato: "{n}/{p} hebben besteld", invioN: "Ronde {k}", inCucina: "in de keuken", inAttesa: "wacht",
    togli: "Verwijderen", errTogli: "Te laat: het is al in de keuken. Vraag het aan de ober.",
    totale: "Totaal", vuoto: "Nog niets op de rekening.",
    chiedi: "Rekening vragen", chiesto: "Genoteerd: de ober brengt de rekening.",
    errChiedi: "De vraag is niet verstuurd. Wenk even een ober.",
    ancora: "Nog iets bestellen",
    chiuso: "Jullie rekening is door de ober afgesloten.",
    paga: "De rekening betalen", pagaMio: "Wat ik bestelde", pagaParte: "Een gelijk deel", pagaResto: "Alles wat overblijft",
    pagaMancia: "Fooi", pagaNessuna: "Geen", pagaBtn: "{x} betalen", pagaIndietro: "Terug",
    giaPagato: "Al betaald", resta: "Nog te betalen", inCorso: "Betaling bezig: {x}",
    errInCorso: "Dit deel wordt al betaald. Probeer het zo meteen opnieuw.",
    errNiente: "Met deze keuze is er niets meer te betalen.",
    errPaga: "De betaling kon niet starten. Probeer opnieuw, of vraag het de ober.",
    pagatoOk: "Bedankt! Uw betaling is ontvangen.",
    saldato: "Bedankt! De rekening is betaald. Tot binnenkort!",
    tavoloBloccato: "Uw rekening staat open op deze tafel. Vraag de ober om van tafel te wisselen.",
    pagaTit: "Betalen", pagaOnline: "Online betalen", oppure: "of",
  },
  es: {
    apri: "Abrir una cuenta", apriSotto: "Pida ahora, pague al final. Sus amigos se unen con un código.",
    apriSolo: "Pagar en el local", apriSoloSotto: "Pida ahora, pague al final.",
    aggiungi: "Añadir a la cuenta", invio: "Enviando…",
    giaAperto: "Ya hay una cuenta abierta en esta mesa ({i}). Introduzca su código para unirse.",
    codice: "Código de la cuenta", codicePh: "2 cifras", unisciti: "Unirse",
    errCodice: "Ese no es el código correcto.", errBloccato: "Demasiados intentos. Inténtelo en unos minutos, o pregunte al camarero.",
    errGenerico: "No es posible ahora. Inténtelo de nuevo.",
    nonNostro: "No es nuestra mesa", nonNostroTesto: "Pregunte a un camarero: él libera la mesa.",
    sulConto: "Está en la cuenta de esta mesa: su pedido se añade.",
    mia: "Cuenta", titolo: "Su cuenta",
    attesa: "Su pedido espera la confirmación del camarero. Aún puede añadir o quitar sus platos.",
    aperta: "Cuenta abierta: sus pedidos van a la cocina.",
    invita: "Código para sus amigos", invitaTesto: "Escanean este código QR, o introducen el código en la página de la mesa.",
    ordinato: "{n}/{p} han pedido", invioN: "Envío {k}", inCucina: "en cocina", inAttesa: "en espera",
    togli: "Quitar", errTogli: "Demasiado tarde: ya está en cocina. Pregunte al camarero.",
    totale: "Total", vuoto: "Aún nada en la cuenta.",
    chiedi: "Pedir la cuenta", chiesto: "Hecho: el camarero trae la cuenta.",
    errChiedi: "La petición no se envió. Haga una seña a un camarero.",
    ancora: "Pedir algo más",
    chiuso: "El camarero ha cerrado su cuenta.",
    paga: "Pagar la cuenta", pagaMio: "Lo que pedí", pagaParte: "Una parte igual", pagaResto: "Todo lo que queda",
    pagaMancia: "Propina", pagaNessuna: "Ninguna", pagaBtn: "Pagar {x}", pagaIndietro: "Volver",
    giaPagato: "Ya pagado", resta: "Queda por pagar", inCorso: "Pago en curso: {x}",
    errInCorso: "Esta parte ya se está pagando. Inténtelo de nuevo en un momento.",
    errNiente: "Con esta opción no queda nada por pagar.",
    errPaga: "El pago no pudo empezar. Inténtelo de nuevo, o pregunte al camarero.",
    pagatoOk: "¡Gracias! Hemos recibido su pago.",
    saldato: "¡Gracias! La cuenta está pagada. ¡Hasta pronto!",
    tavoloBloccato: "Su cuenta está abierta en esta mesa. Para cambiar de mesa, pregunte al camarero.",
    pagaTit: "Pagar", pagaOnline: "Pagar en línea", oppure: "o",
  },
};
