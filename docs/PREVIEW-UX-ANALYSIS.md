# Analisi di riferimento UX: contrast-grid e Contrast-Finder

> Documento di analisi interno. Registra cosa fanno due progetti esterni, cosa abbiamo verificato su di essi e quali idee sono entrate nella preview e nel tuning di Smart Colors. Non è una nota di rilascio e non è una certificazione di accessibilità. Le funzionalità qui derivate sono **Unreleased, verificate dai test dell'agente** (vedi [Stato](#7-stato-unreleased-verificato)) e **non fanno parte della release `v0.4.0`**. Per il comportamento rilasciato si veda [`REFERENCE.md`](./REFERENCE.md).

Metodo: sola lettura. Entrambi i progetti sono stati consultati tramite endpoint pubblici GitHub (URL e revisioni in [Fonti](#fonti)). Nessun repository è stato clonato dentro il package, nessuno script è stato eseguito, nessun file è stato scritto a partire da essi. **Non è stato riusato codice di alcuno dei due progetti**, non è stata aggiunta alcuna dipendenza e quindi **non viene ereditato alcun notice di terze parti**.

## 1. Licenze verificate

| Progetto | Licenza verificata | Evidenza | Uso in questo progetto |
| --- | --- | --- | --- |
| `DirectedEdges/contrast-grid` | **MIT** | `LICENSE` nella root: `MIT License` / `Copyright (c) 2017 EightShapes` (blob `ae1dc731e81b876f790a3a70c9897466c2aee40d`). GitHub API `license.spdx_id = "mit"`. `package.json`: `"license": "MIT"`, `version 1.0.0`. | Solo riferimento UX. Nessun riuso di codice, nessuna dipendenza. |
| `Tanaguru/Contrast-Finder` | **AGPL-3.0** | File di root `LICENCE.txt` (grafia britannica), contenuto = testo integrale della *GNU Affero General Public License v3* (blob `cc51e70c65d0ddc7b5505b63b3c94ab684a6830b`). GitHub API `license.spdx_id = "agpl-3.0"`. | Solo riferimento UX, **senza riuso di codice**. Nessuna dipendenza. |

Nota prudente. La scelta è operativa e non pretende di interpretare in modo assoluto gli obblighi di una licenza copyleft: in questo progetto non viene riusato codice di nessuno dei due progetti, non vengono aggiunte dipendenze e non vengono importati frammenti. Le idee (forma della matrice, tipo di riscontro, trasparenza) sono riprogettate sul motore Smart Colors esistente, così da non duplicare algoritmo né introdurre debito.

## 2. contrast-grid (MIT) — cosa fa

**Flusso.** Due `<textarea>`, un colore per riga con suffisso `, etichetta` opzionale (`color_form.njk`). `color_form.js` li interpreta con una regex esadecimale, deduplica e normalizza in maiuscolo, e ridisegna con un debounce `typeWatch` di 500 ms. Di default la stessa lista alimenta righe e colonne; un link passa a liste distinte con un espediente `data-persisted-text`. Lo stato vive nell'URL (`history.pushState` + `jquery.deserialize`) con un campo `version=1.1.0` usato per la migrazione.

**Matrice.** Una vera `<table>`: intestazioni di colonna = foreground, prima colonna = background, ogni cella dipinge `background-color: bg; color: fg` con rapporto e pill di esito (`contrast_grid.js`, `generateContentRows`). Righe e colonne sono riordinabili via drag, i colori si rimuovono per chip, la densità è S/M/L.

**Riscontro.** Le soglie sono **fisse 7 / 4.5 / 3** → pill `AAA / AA / AA18 / DNP`, con legenda e link alla Understanding di WCAG 2.0. Ogni cella mostra **anche il rapporto numerico** (non solo il colore). Due dettagli fini: `setKeySwatchLabelColors()` inverte l'etichetta in "dark label" quando il contrasto verso il bianco è `< 4.0` (o `== 1`, che aggiunge anche un bordo) per mantenerla leggibile sul campione; `truncateContrastDisplayValues()` accorcia la stringa del rapporto mostrata.

**Algoritmo.** Luminanza relativa WCAG 2.0 standard (`0.2126 / 0.7152 / 0.0722`, soglia `0.03928`, `(L1 + .05) / (L2 + .05)`), arrotondata a una cifra. `rgb2hex` legge il colore **calcolato** da `getComputedStyle`, cioè misura ciò che viene effettivamente reso. Ambito **solo WCAG 2.0**.

**Export.** Genera uno snippet HTML+CSS statico della matrice (rimuove gli hook interattivi, riconverte gli stili inline `rgb()` in hex, `html_beautify`, copia con Clipboard).

**Accessibilità e responsive — osservazioni.** Nel template i `<th>` non dichiarano `scope` e le celle non espongono un nome accessibile con l'identità foreground/background. Va letto come **possibile miglioramento semantico**, non come prova che uno screen reader non associ l'intestazione alla cella: una tabella può inferire la relazione dalla struttura, e senza test con tecnologia assistiva non si dichiara un errore accertato. Il comportamento responsive è `overflow: auto` sul contenitore con tile a dimensione fissa, senza media o container query.

## 3. Contrast-Finder (AGPL-3.0) — cosa fa

**Flusso.** Un form lato server con un campo esadecimale più tre input numerici RGB sincronizzati (`sample.color.js`, con stato invalido e `aria-invalid`), una select del rapporto **3 / 4.5 / 7**, un radio "modifica testo o sfondo" e un radio per l'algoritmo **HSV / Rgb**. `ColorModelValidator` accetta rapporto tra 1 e 21, esadecimale interpretabile e algoritmo in `{HSV, Rgb}`. La pagina risultato mostra la riga del contrasto attuale, una tabella di suggerimenti ordinabile e i retry "prova l'altro algoritmo" / "cambia componente".

**Algoritmo.** Una ricerca a passi in HSV (`STEP 0.1`, `0.01` nella variante "Psycho") con un `hueBounder` (5–10) e, in RGB, passi di 1 su R/G/B entro `maxMove = 60`. L'obiettivo è il **cambiamento minimo**: vengono accettati solo contrasti `< target + maxCoefficient` (`≈ 0.001`), cioè "appena sufficiente". Espone `numberOfTestedColors` (trasparenza) e una distanza euclidea RGB usata per ordinare i risultati.

**Accessibilità.** Costruisce `role=grid`, `aria-readonly`, `aria-sort`, testo offscreen, una caption `role=log` + `aria-live=assertive`, `tabindex` sulle intestazioni ordinabili e ordinamento con spazio/invio — ma avvolge la tabella in `role="application"`, un pattern che preferiamo non replicare.

**Ambito.** WCAG 2.x (con citazioni RGAA 3.0); nessun APCA, nessun WCAG 3.

## 4. Tabella comparativa

| Dimensione | contrast-grid (MIT) | Contrast-Finder (AGPL-3.0) | Scelta in questo progetto |
| --- | --- | --- | --- |
| Metrica di contrasto | WCAG 2.0, rapporto a 1 cifra | WCAG 2.x, arrotondamento a 5 cifre, più distanza euclidea RGB | Un solo core condiviso (`createVerificationCore`); **nessuna distanza euclidea RGB** |
| Ambito | solo WCAG 2.0 | WCAG 2.x / RGAA | Resta WCAG 2.x; alpha, gradienti e `forced-colors` fuori scope e fail-closed |
| Correzione | assente (solo report) | ricerca a passi HSV o RGB, overshoot minimo | Ricerca **solo sulla luminosità** in OKLCH; nessuna nuova autocorrezione su chroma/hue in questa iterazione |
| Soglie | fisse 7 / 4.5 / 3 | select 3 / 4.5 / 7 | Restano `minimum`/`target` configurabili per `kind`; non si torna a soglie fisse |
| Input | righe hex libere + etichetta, con debounce | hex + RGB, rapporto, componente, algoritmo | Si modificano i controlli pubblici dichiarati; nessuna matrice da hex incollato in questa iterazione |
| Output / export | snippet HTML+CSS statico, URL condivisibile | tabella risultato lato server, link di retry | Export manuale con distinzione completo / patch / non disponibile; nessun permalink in questa iterazione |
| Accessibilità | rapporto numerico + pill, ma senza `scope` né nome per cella | semantica di griglia ricca, ma `role="application"` | Semantica nativa della tabella, nome accessibile per cella, regole di focus esistenti |
| Responsive | `overflow:auto`, tile fisse, nessuna query | griglia Bootstrap | Comportamento legato al contenitore, campioni impilati su contenitori stretti |
| Dipendenze | jQuery, jQuery UI, clipboard, js-beautify, … | stack Java/Spring/Maven | **Nessuna aggiunta** |

## 5. Fuori scope in questa iterazione

Idee delle reference che **non** entrano in questa iterazione (nessuna è un giudizio sul loro valore; restano opzioni future):

- **Input hex libero incollato come percorso primario.** Si mantengono i controlli pubblici e il catalogo dichiarato come fonte di verità; una matrice da hex arbitrario inventerebbe coppie che lo strumento non ha dichiarato.
- **Autocorrezione su chroma/hue.** La correzione resta sulla sola luminosità, con chroma e hue fissi e verifica dopo la serializzazione.
- **Permalink condivisibile dello stato.** Lo stato non viene codificato in un URL.
- **`role="application"` / `aria-live="assertive"` importati.** Si mantengono la semantica nativa della tabella e la gestione del focus esistente.

Idee entrate invece nell'iterazione: matrice semantica live, disclosure di esplorazione read-only, modifica della luminosità per token, rimozione dell'override con tombstone, export onesto — tutte descritte in [Stato](#7-stato-unreleased-verificato).

## 6. Vocabolario, soglie ed export

**Vocabolario.** Il "minimo raggiunto" non è il target del progetto. La correzione cerca la luminosità **quanto basta** per raggiungere il **minimo dichiarato** della coppia, non il target del progetto, e non cerca il colore percettivamente più vicino (nessuna minimizzazione di ΔE). Nella matrice gli stati testuali sono `minimo raggiunto`, `sotto il minimo`, `sotto il target`, `non misurato`, con il criterio per tipo (testo AA 4,5:1; testo su riempimento AA 4,5:1; non testo 3:1, SC 1.4.11). Ogni cella mostra la misura live quando il runtime ne ha una per quella coppia e quella vista, altrimenti una **stima dello snapshot di build**, sempre etichettata; le due viste seguono tema e variante del confronto attivo (generato / personalizzato / bozza).

**Fuori scope e non-certificazione.** Alpha, gradienti e `forced-colors` sono fuori dall'ambito misurato e fail-closed. Nessun risultato è una certificazione di accessibilità del sito: sono misure contestuali su coppie di token dichiarate.

**Contratto di export** (`exportTuningFile` → `{ css, mode, warnings, removed, unmatched }`):

- `mode: "complete"` = **intero CSS sorgente preservato** con una patch controllata e **source-aware**. Il testo salvato viene analizzato nella sua struttura e modificato **solo nel valore** delle dichiarazioni interessate: la posizione e il testo delle dichiarazioni esistenti restano quelli del file. Sono ammessi **più blocchi `:root` top-level** (macro + elevazione) **solo se il controllo editato è globalmente unico** in tutto il file. Le dichiarazioni **nuove** vengono aggiunte in coda all'**ultimo** `:root` top-level. Senza modifiche, `complete` restituisce i byte salvati **esatti**, anche quando l'analisi non interpreta il file: in quel caso resta un **warning**, che **non è una verifica**. `complete` **non è un certificato di validità CSS**: è la sorgente preservata con una patch controllata.
- `mode: "fragment"` = **solo delta/patch della bozza da integrare manualmente**: il frammento `:root` dei soli override della bozza. È **sempre solo il delta** e **non rimuove né riscrive il file sorgente**. Viene restituito con un warning quando la patch non è sicura: dichiarazione **duplicata**, dichiarazione **condizionale o annidata** (fuori da un `:root` top-level), **escape attivi** nel CSS, **`!important`**, **commento interno** alla dichiarazione, o struttura non interpretabile.
- `mode: "unavailable"` = payload non disponibile.
- `removed` elenca gli override rimossi (tombstone): in `complete` la dichiarazione viene tolta dal file preservato; in `fragment` la rimozione **non** è applicata e viene solo segnalata. `unmatched` elenca gli override salvati non più corrispondenti a un controllo corrente, **segnalati e non cancellati**.
- `exportTuning()` resta il frammento legacy della bozza non salvata e non emette mai un tombstone.
- La UI distingue tuning completo (`colors-tuning.css`), patch (`colors-tuning.patch.css`) e non disponibile, e non scrive nel progetto.

## 7. Stato: Unreleased verificato

Stato **Unreleased**, non rilasciato (`v0.4.0` resta la release). Nei sorgenti, **verificati dal codice e dai test dell'agente**:

- **Runtime.** `setLightness(control, L)` (controllo colore per token, `L` finito in `0..1`, frame misurato montato; legge C/H calcolati e passa da `setOverride`); `removeOverride(control)` (tombstone `initial`, verifica che il valore calcolato resti vuoto e segnala un blocco da dichiarazione più forte); `explorationPairs(theme)` / `measureExploration(theme)` (advisory, on-demand, sola lettura); `exportTuningFile()` con i modi e i campi sopra. Ogni misura porta **metadata OKLCH** di foreground e background (`foregroundOklch` / `backgroundOklch`) calcolati dallo **stesso motore** (`core.parseComputedColor`) per i browser che serializzano in RGB: **nessuna seconda conversione o matematica del colore nella UI**. Un eventuale fallback nella UI (lettura della sola `L` dalla serializzazione calcolata) non converte il colore né deriva C/H: la matematica resta nel core.
- **UI.** Overview "Abbinamenti" con ricerca e filtro per esito; **a contenitore ≥64rem** il workspace diventa due colonne con l'overview accanto al pannello principale (inspector), mentre la matrice conserva le sue **tre colonne** (uso + le due viste) che rifluiscono su contenitori stretti; su contenitori stretti l'overview è un **`<details>` nativo collassato**. La colonna "live" si popola dalle misure del runtime per la coppia/vista, altrimenti mostra una stima di build etichettata. Disclosure di esplorazione "Tutte le combinazioni dei colori base" (max 24 famiglie, coppie non self, sola lettura), controlli manuali con luminosità e "Rimuovi personalizzazione", export che distingue completo/patch/non disponibile.

**Gate finali verificati.** Definitivi e certi, dalla coorte di validazione e dal parent:

- Package: **930 test — 891 pass, 39 skip, 0 fail**.
- Root consumer: **22/22 pass**.
- Native mirato: **131/131 pass, 0 skip**.
- `pnpm check`: **188 file, 0 error, 0 warning, 58 hint**.
- Astro build: **13 pagine, pass**.
- Preview reale su 3 browser (UI, **Chromium / Firefox / WebKit**, `CFFIXED_USER_HOME` temporaneo solo per Firefox): light/dark, `L` / remove / export multi-`root` / reset / exploration, responsive **320 / 390 / 768 / 1440**, **noJS** — **PASS**.
- Budget automazione root: **785014 / 786432 byte** (margine **1418**), **limite non alzato**.
- **SHA delle sorgenti** (`palette` / `tuning` / `colors`) **identici prima/dopo**.

Evidenza nei log del repo consumer: `reports/preview-ux-final/{colors-test.log, package-native-gates.log, astro-check.log, astro-build.log, budget-root.txt, validation.json}`, **non** file spediti nel package.

**Pending esplicito.** Un server HTTP `smart-colors preview` che serva la preview e stampi un URL locale cliccabile **non è implementato**. Finché non esiste, nessun documento o output mostra porte, host o URL fittizi: la preview resta il file `reports/smart-colors-preview.html` aperto da `file://`. La copertura degli **alias** non è ampliata e non si promette la verifica di **tutte** le combinazioni di token.

## Fonti

Verificate tramite endpoint pubblici il 2026-10-22 (sola lettura; nessun clone).

contrast-grid (`DirectedEdges/contrast-grid`, branch `master`, commit `91a5d99f9595f9c8ce3f97ebe4f8514b3cb2c1b9`, 2026-09-01):

- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/LICENSE` (MIT, `Copyright (c) 2017 EightShapes`)
- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/package.json` (`version 1.0.0`, `license: MIT`)
- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/src/components/contrast_grid/contrast_grid.js`
- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/src/components/color_form/color_form.js`
- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/src/components/contrast_grid/contrast_grid.njk`
- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/src/components/color_form/color_form.njk`
- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/src/components/contrast_grid/contrast_grid.scss`
- `https://raw.githubusercontent.com/DirectedEdges/contrast-grid/master/src/components/code_snippet/code_snippet.js`
- `https://api.github.com/repos/DirectedEdges/contrast-grid` (metadati: `license.spdx_id = mit`, `default_branch = master`)

Contrast-Finder (`Tanaguru/Contrast-Finder`, branch `master`, tree `927716729f7cb1768be67b382d2fe0401b279a3c`, ultimo push 2022-12-16, `pom.xml` versione 0.3.5) — riferimento UX, licenza verificata, nessun riuso di codice:

- `https://raw.githubusercontent.com/Tanaguru/Contrast-Finder/master/LICENCE.txt` (testo AGPL-3.0)
- `https://raw.githubusercontent.com/Tanaguru/Contrast-Finder/master/README.md`
- `https://raw.githubusercontent.com/Tanaguru/Contrast-Finder/master/pom.xml`
- `https://api.github.com/repos/Tanaguru/Contrast-Finder` (metadati: `license.spdx_id = agpl-3.0`, `default_branch = master`)

Sorgenti interni verificati (nessuna modifica): `src/contrast-workbench-runtime.mjs`, `src/contrast-workbench-view.mjs`, `src/verification-core.mjs`, `src/contrast-advice.mjs`, `src/cli.mjs`.
