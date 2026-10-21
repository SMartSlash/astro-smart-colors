# Preview interattiva e personalizzazioni dei colori

Appunto concordato con Simone il 21 ottobre 2026.
Stato: da implementare quando sarà disponibile il generatore/HTML della preview attualmente conservato in locale sul suo PC. Questo documento descrive il comportamento desiderato, non certifica le funzionalità attuali del repository.

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

## CLI

- Conservare gli alert testuali e usare gli stessi nomi dei token e criteri della preview.
- Stampare un riepilogo di generazione, coppie sotto soglia e personalizzazioni attive.
- Prevedere `smart-colors preview` per servire la preview e stampare l'URL locale effettivo cliccabile.
- Stampare un link HTTP soltanto quando il server è attivo; non mostrare porte o indirizzi fittizi. Gestire la porta occupata e riportare quella realmente usata.
- La build può generare l'HTML senza avviare un processo persistente. In questo caso deve indicare il percorso del file e il comando per aprire la preview servita.
- Il collegamento deve restare comprensibile anche come testo normale nei terminali che non supportano hyperlink dedicati.

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

## Ripresa del lavoro e criteri di completamento

- [ ] Recuperare dal PC di Simone il generatore e l'HTML attuali, confrontandoli con il codice del repository prima di intervenire.
- [ ] Verificare il contratto reale di palette, token, temi, alias e cascata e adattare il piano senza perdere le responsabilità descritte sopra.
- [ ] Implementare la generazione della preview e il comando con URL funzionante.
- [ ] Implementare matrice semantica, temi, regolazione manuale e ripristino.
- [ ] Implementare esportazione del tuning preservando il lavoro preesistente.
- [ ] Verificare che una nuova build conservi palette e tuning e che preview e CSS effettivo producano gli stessi valori e contrasti.
- [ ] Verificare ripristino, riapertura del tuning, alert coerenti, uso da tastiera e layout su schermi piccoli.

La richiesta corrente è soltanto registrare questo piano; l'implementazione riprenderà quando Simone tornerà al PC.
