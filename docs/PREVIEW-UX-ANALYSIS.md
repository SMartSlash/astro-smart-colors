# Preview Smart Colors: scelte UX e limiti

Documento interno sulle scelte della preview e del tuning di Smart Colors. È un documento **storico**: descrive la fase di sviluppo che è poi diventata la release `v0.5.0` (2026-10-25). Le funzionalità qui raccontate sono oggi spedite in `v0.5.0`, non più «Unreleased»; per il comportamento corrente si veda [`REFERENCE.md`](./REFERENCE.md). Conserva il contratto di export e la [validazione storica](#4-stato-storico-validazione-della-fase-unreleased), con i conteggi dei test e il budget registrati allora. Non è una nota di rilascio né una certificazione di accessibilità.

## 1. Scelte di progetto

| Dimensione | Scelta in Smart Colors |
| --- | --- |
| Metrica di contrasto | Un solo core condiviso (`createVerificationCore`); nessuna distanza euclidea RGB. |
| Ambito | WCAG 2.x su coppie dichiarate; alpha, gradienti e `forced-colors` fuori scope, senza esito positivo quando la misura non è supportata. |
| Correzione | Ricerca sulla sola luminosità in OKLCH, senza autocorrezione su chroma o hue. |
| Soglie | `minimum` e `target` distinti e configurabili per tipo d'uso. |
| Input | Controlli pubblici dichiarati e catalogo delle coppie; nessuna matrice da colori hex incollati. |
| Output ed export | Export manuale distinto in completo, patch o non disponibile; nessun permalink. |
| Accessibilità | Semantica nativa della tabella, nome accessibile per cella e gestione esplicita del focus. |
| Responsive | Comportamento legato al contenitore e campioni impilati su contenitori stretti. |
| Dipendenze | Nessuna dipendenza aggiuntiva per queste funzionalità. |

## 2. Fuori scope in questa iterazione

Funzionalità escluse dall'iterazione descritta:

- **Input hex libero incollato come percorso primario.** Si mantengono i controlli pubblici e il catalogo dichiarato come fonte di verità; una matrice da hex arbitrario inventerebbe coppie che lo strumento non ha dichiarato.
- **Autocorrezione su chroma/hue.** La correzione resta sulla sola luminosità, con chroma e hue fissi e verifica dopo la serializzazione.
- **Permalink condivisibile dello stato.** Lo stato non viene codificato in un URL.
- **Uso di `role="application"` / `aria-live="assertive"`.** Si mantengono la semantica nativa della tabella e la gestione del focus esistente.

L'iterazione ha introdotto una matrice semantica live, l'esplorazione in sola lettura, la modifica della luminosità per token, la rimozione dell'override con tombstone e l'export con modalità esplicite; sono tutte nella release `v0.5.0`. Lo stato di allora è riportato nella [validazione storica](#4-stato-storico-validazione-della-fase-unreleased).

## 3. Vocabolario, soglie ed export

**Vocabolario.** Il "minimo raggiunto" non è il target del progetto. La correzione cerca la luminosità **quanto basta** per raggiungere il **minimo dichiarato** della coppia, non il target del progetto, e non cerca il colore percettivamente più vicino (nessuna minimizzazione di ΔE). Nella matrice gli stati testuali sono `minimo raggiunto`, `sotto il minimo`, `sotto il target`, `non misurato`, con il criterio per tipo (testo AA 4,5:1; testo su riempimento AA 4,5:1; non testo 3:1, SC 1.4.11). Ogni cella mostra la misura live quando il runtime ne ha una per quella coppia e quella vista, altrimenti una **stima dello snapshot di build**, sempre etichettata; le due viste seguono tema e variante del confronto attivo (generato / personalizzato / bozza).

**Fuori scope e non-certificazione.** Alpha, gradienti e `forced-colors` sono fuori dall'ambito misurato e fail-closed. Nessun risultato è una certificazione di accessibilità del sito: sono misure contestuali su coppie di token dichiarate.

**Contratto di export** (`exportTuningFile` → `{ css, mode, warnings, removed, unmatched }`):

- `mode: "complete"` = **intero CSS sorgente preservato** con una patch controllata e **source-aware**. Il testo salvato viene analizzato nella sua struttura e modificato **solo nel valore** delle dichiarazioni interessate: la posizione e il testo delle dichiarazioni esistenti restano quelli del file. Sono ammessi **più blocchi `:root` top-level** (macro + elevazione) **solo se il controllo editato è globalmente unico** in tutto il file. Le dichiarazioni **nuove** vengono aggiunte in coda all'**ultimo** `:root` top-level. Senza modifiche, `complete` restituisce i byte salvati **esatti**, anche quando l'analisi non interpreta il file: in quel caso resta un **warning**, che **non è una verifica**. `complete` **non è un certificato di validità CSS**: è la sorgente preservata con una patch controllata.
- `mode: "fragment"` = **solo delta/patch della bozza da integrare manualmente**: il frammento `:root` dei soli override della bozza. È **sempre solo il delta** e **non rimuove né riscrive il file sorgente**. Viene restituito con un warning quando la patch non è sicura: dichiarazione **duplicata**, dichiarazione **condizionale o annidata** (fuori da un `:root` top-level), **escape attivi** nel CSS, **`!important`**, **commento interno** alla dichiarazione, o struttura non interpretabile.
- `mode: "unavailable"` = payload non disponibile.
- `removed` elenca gli override rimossi (tombstone): in `complete` la dichiarazione viene tolta dal file preservato; in `fragment` la rimozione **non** è applicata e viene solo segnalata. `unmatched` elenca gli override salvati non più corrispondenti a un controllo corrente, **segnalati e non cancellati**.
- `exportTuning()` resta il frammento legacy della bozza non salvata e non emette mai un tombstone.
- La UI distingue tuning completo (`colors-tuning.css`), patch (`colors-tuning.patch.css`) e non disponibile, e non scrive nel progetto.

## 4. Stato storico: validazione della fase Unreleased

Questa sezione conserva la fotografia della fase di sviluppo documentata in origine. Layout, conteggi dei test, budget e percorsi seguenti sono **storici**, non descrivono lo stato corrente. Le funzionalità erano **Unreleased** quando furono misurate e sono poi entrate nella release `v0.5.0`: i numeri restano quelli registrati allora e non sono il gate attuale.

- **Runtime.** `setLightness(control, L)` (controllo colore per token, `L` finito in `0..1`, frame misurato montato; legge C/H calcolati e passa da `setOverride`); `removeOverride(control)` (tombstone `initial`, verifica che il valore calcolato resti vuoto e segnala un blocco da dichiarazione più forte); `explorationPairs(theme)` / `measureExploration(theme)` (advisory, on-demand, sola lettura); `exportTuningFile()` con i modi e i campi sopra. Ogni misura porta **metadata OKLCH** di foreground e background (`foregroundOklch` / `backgroundOklch`) calcolati dallo **stesso motore** (`core.parseComputedColor`) per i browser che serializzano in RGB: **nessuna seconda conversione o matematica del colore nella UI**. Un eventuale fallback nella UI (lettura della sola `L` dalla serializzazione calcolata) non converte il colore né deriva C/H: la matematica resta nel core.
- **UI.** Overview "Abbinamenti" con ricerca e filtro per esito; **a contenitore ≥64rem** il workspace diventa due colonne con l'overview accanto al pannello principale (inspector), mentre la matrice conserva le sue **tre colonne** (uso + le due viste) che rifluiscono su contenitori stretti; su contenitori stretti l'overview è un **`<details>` nativo collassato**. La colonna "live" si popola dalle misure del runtime per la coppia/vista, altrimenti mostra una stima di build etichettata. Disclosure di esplorazione "Tutte le combinazioni dei colori base" (max 24 famiglie, coppie non self, sola lettura), controlli manuali con luminosità e "Rimuovi personalizzazione", export che distingue completo/patch/non disponibile.

**Verifiche registrate in quella fase:**

- Package: **930 test — 891 pass, 39 skip, 0 fail**.
- Root consumer: **22/22 pass**.
- Native mirato: **131/131 pass, 0 skip**.
- `pnpm check`: **188 file, 0 error, 0 warning, 58 hint**.
- Astro build: **13 pagine, pass**.
- Preview reale su 3 browser (UI, **Chromium / Firefox / WebKit**, `CFFIXED_USER_HOME` temporaneo solo per Firefox): light/dark, `L` / remove / export multi-`root` / reset / exploration, responsive **320 / 390 / 768 / 1440**, **noJS** — **PASS**.
- Budget automazione root registrato: **785014 / 786432 byte** (margine **1418**), rispetto alla soglia allora in uso.
- **SHA delle sorgenti** (`palette` / `tuning` / `colors`) **identici prima/dopo**.

Evidenza nei log del repo consumer: `reports/preview-ux-final/{colors-test.log, package-native-gates.log, astro-check.log, astro-build.log, budget-root.txt, validation.json}`, **non** file spediti nel package.

**Limiti registrati in quella fase.** Il server HTTP `smart-colors preview` non era implementato: la preview si apriva da `file://` nel percorso allora usato, `reports/smart-colors-preview.html`. La copertura degli alias non era ampliata e non veniva promessa la verifica di tutte le combinazioni di token. Per percorsi e limiti correnti si veda [`REFERENCE.md`](./REFERENCE.md).

## 5. Implementazione

- Runtime: `src/diagnostics/preview/contrast-workbench-runtime.mjs`.
- Vista e markup: `src/diagnostics/preview/contrast-workbench-view.mjs`, `src/diagnostics/preview/contrast-workbench-markup.mjs`.
- Metrica e correzioni: `src/colors/verification-core.mjs`, `src/colors/contrast-advice.mjs`.
- CLI: `src/cli.mjs`.
