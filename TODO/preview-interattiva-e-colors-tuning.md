# Preview interattiva e personalizzazioni dei colori

Appunto concordato con Simone il 21 ottobre 2026.
Stato: **Unreleased, implementato e verificato dai test dell'agente**. Non è una release: `v0.4.0` resta l'ultimo tag. Il generatore e l'HTML della preview citati nella prima versione di questo documento sono stati **recuperati** e vivono nel repository (`src/contrast-workbench-runtime.mjs`, `src/contrast-workbench-view.mjs`, `src/diagnostic-*`, `src/format-report-*`). Questo documento registra i test dell'agente; **non attribuisce competenza umana** e non richiede una validazione umana per essere aggiornato.

> Nota storica. La versione precedente apriva con «da implementare quando sarà disponibile il generatore/HTML della preview attualmente conservato in locale sul suo PC» e includeva, tra i criteri di completamento, il recupero di quei sorgenti. La premessa è superata: i sorgenti sono nel repository. Il criterio di recupero è chiuso come storico, non come attività.

Analisi delle due reference esterne, licenze verificate e decisioni: [`docs/PREVIEW-UX-ANALYSIS.md`](../docs/PREVIEW-UX-ANALYSIS.md).

## Obiettivo

Affiancare agli alert della CLI una preview HTML generata, raggiungibile con un link cliccabile dal terminale. La preview deve permettere di comprendere gli abbinamenti, verificare i contrasti e personalizzare i token.

Riferimento UX: [This hue shall pass — Clearleft](https://thishueshallpass.clearleft.com/?colors=23202c%2Cdae1e2%2Cffffff%2Ce1673e%2C4d3e74).
Prendere ispirazione dalla matrice, dalla leggibilità degli abbinamenti e dal riscontro immediato delle modifiche. Non copiare il design, il branding o il codice: progettare un'interfaccia originale adatta ai token semantici di smart-colors.

## Pipeline e responsabilità

| File | Responsabilità | Modifica |
| --- | --- | --- |
| `palette.css` | Colori di partenza dichiarati dal designer tramite `@property` | Designer |
| `colors.css` | Token e varianti derivati dalla palette | Generatore |
| `colors-tuning.css` | Override puntuali dei valori generati | Designer, direttamente o tramite preview |

- `palette.css` è un ingresso della build. Un eventuale comando iniziale può crearne uno di esempio, ma le build successive non devono sovrascriverlo.
- La build rigenera `colors.css` e la preview.
- Le personalizzazioni esistenti in `colors-tuning.css` devono sopravvivere alle build e agli aggiornamenti della preview.
- Cambiare la palette provoca la rigenerazione delle varianti; modificare un token nella preview personalizza soltanto il token selezionato, senza rigenerarne implicitamente i derivati.
- La preview mostra il risultato effettivo di generazione e tuning, mantenendo disponibile il valore generato per confronto e ripristino.
- Definire esplicitamente la precedenza degli override e il mapping dei token nei temi chiaro/scuro dopo aver letto l'implementazione corrente. Non presumere che basti aggiungere un foglio in fondo senza verificare cascata, registrazioni e alias.
- Il ripristino di un token rimuove il relativo override: non copia nel tuning il valore generato del momento.

## Ambito di questa iterazione (implementato e verificato)

Tratto da [`docs/PREVIEW-UX-ANALYSIS.md`](../docs/PREVIEW-UX-ANALYSIS.md). Solo idee UX: nessun riuso di codice da `contrast-grid` (MIT, EightShapes) né da `Contrast-Finder` (AGPL-3.0), nessuna nuova dipendenza.

- **Matrice semantica live**: righe/colonne dalle coppie semantiche dichiarate, alimentata dalle misurazioni del runtime (`state.views[].measurements`), senza una seconda matematica del contrasto nell'interfaccia. Ogni cella mostra la misura live quando disponibile, altrimenti una **stima di build** etichettata; le due viste seguono tema e variante del confronto attivo (generato / personalizzato / bozza).
- **Metadata OKLCH** di foreground e background (`foregroundOklch` / `backgroundOklch`) calcolati dallo **stesso motore** per i browser che serializzano in RGB: **nessuna seconda conversione o matematica del colore nella UI** (un eventuale fallback legge solo la `L` dalla serializzazione calcolata).
- **Overview a contenitore ≥64rem**: due colonne con l'overview accanto al pannello principale (inspector); la matrice conserva le sue **tre colonne** (uso + le due viste) che rifluiscono su contenitori stretti; su contenitori stretti l'overview è un **`<details>` nativo collassato**.
- **Disclosure di esplorazione in sola lettura**, bounded, con tetto di **24 famiglie** e coppie non self; resta separata dalla copertura primaria e non entra nell'esito.
- **Modifica della luminosità per token** (`setLightness(control, L)`, `L` in `0..1`) tramite il colore calcolato per C/H e la serializzazione `oklch` del core, poi `setOverride`.
- **Rimozione di un override** (`removeOverride(control)`) con tombstone vivo; `reset` resta lo scarto dell'intera bozza.
- **`exportTuningFile`** con `{ css, mode, warnings, removed, unmatched }`, `mode` in `complete`/`fragment`/`unavailable` (vedi [Export](#export-del-tuning)).

Esplicitamente **fuori scope in questa iterazione** (opzioni future, non giudizi):

- input hex libero incollato come percorso primario (restano i controlli pubblici e il catalogo dichiarato);
- autocorrezione su chroma/hue (la correzione resta sulla sola luminosità);
- permalink condivisibile dello stato della preview;
- `role="application"`/`aria-live="assertive"` importati dalle reference: restano le semantiche native della tabella e la gestione del focus esistente.

## Export del tuning

- `mode: "complete"` = **intero CSS sorgente preservato** con una patch controllata e **source-aware**: si riscrive **solo il valore** delle dichiarazioni editate (posizione e testo delle dichiarazioni esistenti invariati). Sono ammessi **più blocchi `:root` top-level solo se il controllo editato è globalmente unico**; le dichiarazioni **nuove** vanno in coda all'**ultimo** `:root` top-level. Senza modifiche restituisce i byte salvati **esatti**, anche se l'analisi non interpreta il file: resta un **warning**, che **non è una verifica**. `complete` **non è un certificato di validità CSS**.
- `mode: "fragment"` = **sempre solo il delta/patch della bozza** da integrare manualmente; **non rimuove né riscrive il file sorgente**. Restituito con warning su dichiarazione **duplicata**, dichiarazione **condizionale o annidata** (fuori da un `:root` top-level), **escape attivi**, **`!important`**, **commento interno** alla dichiarazione, o struttura non interpretabile.
- `mode: "unavailable"` = payload non disponibile.
- `removed` elenca gli override rimossi (tombstone): rimossi dal file preservato in `complete`, solo segnalati (non applicati) in `fragment`. `unmatched` elenca gli override salvati non più corrispondenti a un controllo corrente, **segnalati e non cancellati**.
- `exportTuning()` resta il frammento legacy della bozza non salvata e non emette mai un tombstone.
- La UI distingue tuning completo (`colors-tuning.css`), patch (`colors-tuning.patch.css`) e export non disponibile, e non scrive nel progetto.

## Vocabolario e non-certificazione

- Il "minimo raggiunto" **non è il target del progetto**: la correzione cerca la luminosità quanto basta per il **minimo dichiarato** della coppia, non il target, e non cerca il colore percettivamente più vicino (nessuna minimizzazione di ΔE).
- Stati testuali nella matrice: `minimo raggiunto`, `sotto il minimo`, `sotto il target`, `non misurato`, con il criterio per tipo (testo AA 4,5:1; testo su riempimento AA 4,5:1; non testo 3:1, SC 1.4.11).
- Alpha, gradienti e `forced-colors` sono **fuori dall'ambito misurato** e fail-closed. Nessun risultato è una **certificazione di accessibilità** del sito: sono misure contestuali su coppie di token dichiarate.
- La copertura degli **alias** non è ampliata e non si promette la verifica di **tutte** le combinazioni di token.

## CLI

- Conservare gli alert testuali e usare gli stessi nomi dei token e criteri della preview.
- Stampare un riepilogo di generazione, coppie sotto soglia e personalizzazioni attive.
- Prevedere `smart-colors preview` per servire la preview e stampare l'URL locale effettivo cliccabile.
- Stampare un link HTTP soltanto quando il server è attivo; non mostrare porte o indirizzi fittizi. Gestire la porta occupata e riportare quella realmente usata.
- La build può generare l'HTML senza avviare un processo persistente. In questo caso deve indicare il percorso del file e il comando per aprire la preview servita.
- Il collegamento deve restare comprensibile anche come testo normale nei terminali che non supportano hyperlink dedicati.

**Pending esplicito.** `smart-colors preview` (server HTTP locale con URL reale) **non è implementato** e non fa parte di questa iterazione. Finché non esiste, nessun documento né output deve mostrare porte, host o URL fittizi: la preview resta il file `reports/smart-colors-preview.html` aperto da `file://`.

## Prima versione della preview

1. Matrice con campioni testo/sfondo leggibili, nomi dei token e rapporti di contrasto.
2. Vista iniziale sulle coppie previste dai ruoli semantici; vista opzionale di tutte le combinazioni. Non tutte le coppie teoriche devono superare una soglia: distinguere esplorazione e problemi relativi agli usi previsti.
3. Selezione del tema chiaro/scuro, con confronto semplice tra i risultati.
4. Selezione di una coppia e apertura di un pannello di regolazione senza perdere posizione e contesto nella matrice.
5. Regolazione manuale del token, inizialmente della luminosità OKLCH, con aggiornamento delle coppie coinvolte.
6. Confronto tra valore generato e personalizzato, indicazione degli override attivi e ripristino per token.
7. Contrasto numerico, criterio applicato e stato testuale; non affidare l'esito solo al colore. Distinguere gli usi e le soglie pertinenti, senza presentare il solo contrasto come certificazione di accessibilità completa.
8. Esportazione di `colors-tuning.css` e indicazione delle modifiche non ancora esportate/salvate.

Usare lo stesso motore di calcolo e le stesse regole della generazione: evitare una seconda implementazione divergente dei contrasti o della conversione dei colori nella preview.

## Salvataggio e protezione del lavoro

- L'HTML autonomo può esportare il file; non promettere scritture dirette nel progetto.
- Il salvataggio diretto richiede un endpoint del server locale della CLI. Valutarlo come estensione distinta dall'esportazione iniziale, limitando le scritture al file di tuning previsto.
- Prima di implementare l'esportazione, stabilire come preservare override preesistenti, commenti e regole personalizzate non gestite dall'interfaccia: non perderli silenziosamente.
- Se un token personalizzato non esiste più dopo la rigenerazione, segnalarlo senza cancellarlo automaticamente.

## UI e accessibilità

- HTML semantico, CSS moderno, JavaScript leggibile; niente Tailwind.
- Matrice comprensibile con intestazioni di riga/colonna, controlli etichettati e navigazione da tastiera.
- Focus visibile, gestione coerente del focus nel pannello e risultati leggibili anche con palette a basso contrasto: i controlli dell'app non devono diventare illeggibili durante gli esperimenti.
- Su schermi piccoli mantenere l'associazione tra token, campioni e risultati; valutare una vista per coppia invece di comprimere tutta la matrice.
- Verificare compatibilità browser e documentazione aggiornata delle funzionalità scelte durante l'implementazione.

## Fuori dalla prima versione

- Correzione automatica/bacchetta: aggiungerla successivamente come proposta esplicita da valutare, mostrando gli effetti sulle altre coppie.
- Rigenerazione implicita dei derivati quando si modifica un singolo token nel tuning.

## Registrazione dei test dell'agente

Checklist dei test eseguiti dall'agente. `x` = sostenuto da test reali; `[ ]` = non ancora registrato. I gate finali sono registrati sotto.

- [x] ~~Recuperare dal PC di Simone il generatore e l'HTML attuali~~ — **chiuso come storico**: i sorgenti sono nel repository.
- [x] Matrice semantica live da `state.views[].measurements` (+ campioni computed; confronti generato / personalizzato / bozza).
- [x] Metadata OKLCH fg/bg dallo stesso motore; nessuna seconda conversione o matematica del colore nella UI.
- [x] Disclosure di esplorazione read-only, bounded, 24 famiglie, coppie non self.
- [x] `setLightness(control, L)` tramite il colore calcolato e `setOverride`.
- [x] `removeOverride(control)` con tombstone; `reset` resta lo scarto dell'intera bozza.
- [x] `exportTuningFile` `complete`/`fragment`/`unavailable`; `complete` source-aware multi-`:root` con controllo globalmente unico, no edits byte-exact, `fragment` solo delta senza rimozioni applicate.
- [x] UI di export che distingue tuning completo, patch e export non disponibile, senza scrivere nel progetto.
- [x] Preservazione palette/tuning tra build: suite basic, con **SHA della sorgente parent immutato prima/dopo**.
- [x] Preview reale su 3 browser (UI, **Chromium / Firefox / WebKit**, `CFFIXED_USER_HOME` temporaneo **solo per Firefox**): light/dark, `L`, remove, export multi-`root`, reset, exploration, responsive **320 / 390 / 768 / 1440**, **noJS** — tutti PASS.
- [x] Gate finali: package **930 test — 891 pass, 39 skip, 0 fail**; root consumer **22/22 pass**; native mirato **131/131 pass, 0 skip**; `pnpm check` **188 file, 0 error, 0 warning, 58 hint**; Astro build **13 pagine pass**; budget automazione root **785014 / 786432 byte** (margine **1418**, limite **non alzato**); **SHA di `palette`/`tuning`/`colors` identici prima/dopo**.
- [ ] Uso da tastiera: verifica dedicata non ancora registrata.
- [ ] Implementare la generazione della preview e il comando con URL funzionante (`smart-colors preview`) — **non in questa iterazione**; nessun URL fittizio nel frattempo.
- [ ] Copertura alias e verifica di tutte le combinazioni di token — non promesse.

### Evidenza (agente)

Log nel **repo consumer**: `reports/preview-ux-final/{colors-test.log, package-native-gates.log, astro-check.log, astro-build.log, budget-root.txt, validation.json}`, **non** file spediti nel package.

<!-- Spazio riservato: eventuali nuove esecuzioni, scostamenti e note. -->
