# Obsidian Mass Edit — Design Document

> Implementační specifikace pro Claude Code. Cílem je plugin pro hromadné vyhledávání a editaci poznámek napříč vaultem, s důrazem na výkonný query builder, bezpečnost (záloha + undo) a čistý Catppuccin Mocha (mauve) vzhled.

---

## 1. Cíl a rozsah

**Účel:** Otevřít v hlavním okně nástroj, kde uživatel poskládá vyhledávací pravidla (tagy, frontmatter, tělo, název, cesta, umístění), získá seznam poznámek a hromadně na nich provede editační operace — bezpečně, s možností vrátit zpět.

### V rozsahu (v1)
- Vizuální query builder se zanořenými AND/OR skupinami + NOT.
- Dvoufázový vyhledávací engine (metadata → obsah) kvůli výkonu na stovkách/tisících poznámek.
- Editace: frontmatter (set / add / delete / append-to-list), frontmatter tagy (add / remove), tělo append/prepend, tělo find & replace (regex).
- Výběr výsledků (checkboxy), defaultně všechny vybrané.
- Souhrn dopadu změn před aplikací.
- Záloha dotčených souborů + undo (transakce = jeden běh).
- Layout: jedna plocha na desktopu, dvě záložky na mobilu.
- Catppuccin Mocha (mauve accent).

### Mimo rozsah (v1)
- Inline `#tagy` řešené jako tagy (v1 spadají pod find & replace v těle).
- Editace ne-markdown souborů.
- Ukládání/načítání pojmenovaných dotazů (kandidát na v2).
- Full diff všech poznámek najednou.

---

## 2. Architektura

### 2.1 Tech stack
- Standardní Obsidian plugin (TypeScript + esbuild).
- **UI: Svelte** — reaktivní builder se zanořenými skupinami a živým počítadlem je v čistém DOM bolestivý; Svelte je v Obsidian ekosystému idiomatický. (Fallback: plain DOM, pokud se Svelte nezavede.)
- Žádné runtime závislosti navíc kromě Svelte kompilovaného do bundlu.

### 2.2 Moduly
```
src/
  main.ts                 // Plugin entry, registrace view + settings
  view/MassEditView.ts    // ItemView v hlavním leaf
  query/
    types.ts              // Rule, Group, Query, Field/Operator enums
    operators.ts          // definice operátorů per pole + jejich eval fce
    engine.ts             // dvoufázový evaluator (tříhodnotová logika)
  edit/
    operations.ts         // typy edit operací
    applier.ts            // aplikace operací na soubor (přes oficiální API)
  backup/
    backupManager.ts      // záloha, manifest, undo, retence
  ui/                     // Svelte komponenty (viz §6)
  settings.ts             // SettingsTab + defaults
  styles.css              // Catppuccin Mocha skin
manifest.json
esbuild.config.mjs
tsconfig.json
package.json
```

---

## 3. Vyhledávací engine (jádro)

### 3.1 Princip: dvoufázové vyhodnocení
Klíč k rychlosti je nemíchat levné a drahé operace:

- **Fáze 1 (metadata):** čte se výhradně z `app.metadataCache` (frontmatter, tagy, odkazy, nadpisy) + `TFile` atributy (název, cesta, ctime/mtime). Instantní, v paměti.
- **Fáze 2 (obsah):** jen pro kandidáty z fáze 1 se čte tělo přes `app.vault.cachedRead(file)`. Drahé, proto až na konci a jen kde je to nutné.

Pole se dělí na:
- **Metadata pole:** `tag`, `frontmatter`, `name`, `path`, `location`, `created`, `modified`
- **Obsahové pole:** `body`

### 3.2 Tříhodnotová (Kleene) logika
Aby šlo vyhodnotit AND/OR strom bez čtení těla tam, kde metadata už rozhodnou, používá evaluator hodnoty `true | false | unknown`:

- **AND:** `false` pokud kterýkoli člen `false`; jinak `unknown` pokud je nějaký `unknown`; jinak `true`.
- **OR:** `true` pokud kterýkoli člen `true`; jinak `unknown` pokud je nějaký `unknown`; jinak `false`.
- **NOT:** prohodí `true`/`false`, `unknown` zůstává.

**Postup:**
1. Nad všemi `getMarkdownFiles()` vyhodnoť strom; obsahová pravidla (`body`) vrací `unknown` (tělo se ještě nečetlo).
2. Soubor s výsledkem `false` → zahoď. Výsledek `true` nebo `unknown` → kandidát.
3. Pro kandidáty s `unknown` přečti tělo a přehodnoť `body` pravidla → finální `true`/`false`.

Tím se tělo čte jen tam, kde metadata sama o sobě nerozhodla.

### 3.3 Datový model
```ts
type LogicOp = 'AND' | 'OR';

type FieldType =
  | 'tag' | 'frontmatter' | 'body'
  | 'name' | 'path' | 'location'
  | 'created' | 'modified';

interface Rule {
  id: string;
  field: FieldType;
  key?: string;        // povinné pro 'frontmatter' (název klíče)
  op: string;          // viz tabulka operátorů §3.4
  value?: unknown;     // typ dle operátoru
  negate?: boolean;
}

interface Group {
  id: string;
  logic: LogicOp;
  negate?: boolean;
  children: Array<Rule | Group>;
}

type Query = Group; // kořen je vždy skupina
```

### 3.4 Pole a operátory

| Pole | Fáze | Operátory | Hodnota |
|------|------|-----------|---------|
| `tag` | meta | `has`, `hasNot`, `matchesGlob` | tag / glob (`project/*`) |
| `frontmatter` (`key`) | meta | `exists`, `notExists`, `equals`, `contains`, `regex`, `gt`, `lt`, `gte`, `lte`, `isEmpty` | dle typu (string/number/date) |
| `body` | content | `contains`, `regex` | string / regex |
| `name` | meta | `contains`, `equals`, `regex` | string |
| `path` | meta | `contains`, `regex` | string |
| `location` | meta | `inFolder`, `notInFolder` | složka + toggle *včetně podsložek* |
| `created` / `modified` | meta | `before`, `after`, `between` | datum / rozsah |

Poznámky:
- `tag` čte přes `getAllTags(cache)` (sloučí frontmatter i inline pro účely **vyhledávání**; editace tagů se ale týká jen frontmatteru — viz §5).
- `location` = dedikovaný filtr se složkovým pickerem a přepínačem rekurze; interně porovnává `file.path` prefixem.
- `frontmatter` numerické/datumové operátory bezpečně parsují hodnotu; při nekompatibilním typu vrací `false`.

### 3.5 Živé počítadlo
- Debounce ~200 ms po každé změně builderu.
- Zobraz počet kandidátů z **fáze 1** okamžitě (label „až N poznámek"), plný výsledek (s obsahovými pravidly) dopočítej při stisku *Hledat* nebo s delším debounce. Prakticky rychlé i pro velké vaulty.

---

## 4. Editační operace

### 4.1 Typy operací
```ts
type EditOp =
  | { kind: 'fm-set';    key: string; value: unknown; valueType: 'string'|'number'|'boolean'|'list' }
  | { kind: 'fm-add';    key: string; value: unknown; valueType: ... }  // jen pokud klíč chybí
  | { kind: 'fm-delete'; key: string }
  | { kind: 'fm-list-append'; key: string; value: string }              // do YAML listu, bez duplicit
  | { kind: 'tag-add';    tag: string }        // frontmatter tags[]
  | { kind: 'tag-remove'; tag: string }
  | { kind: 'body-regex'; pattern: string; flags: string; replacement: string }
  | { kind: 'body-append';  text: string }
  | { kind: 'body-prepend'; text: string };
```
V jednom běhu lze zařadit více operací.

### 4.2 Pevné pořadí aplikace (per soubor)
1. Frontmatter (`fm-*`)
2. Tagy (`tag-*`)
3. Regex (`body-regex`)
4. Append / Prepend (`body-*`)

Deterministické a zdokumentované, aby kombinace operací měly předvídatelný výsledek.

### 4.3 Bezpečná implementace přes oficiální API
- **Frontmatter + tagy:** výhradně `app.fileManager.processFrontMatter(file, fm => { ... })`. Nikdy neparsovat YAML ručně. Tagy (`fm.tags`) normalizovat na pole (může být string, list, nebo chybět); u `tag-add` bez duplicit, u `tag-remove` odstranit i variantu s/bez `#`.
- **Tělo (regex/append/prepend):** `app.vault.process(file, content => { ... })` (novější atomické API; fallback `vault.modify`).
- **Prepend musí vkládat AŽ ZA frontmatter blok** — jinak rozbije YAML. Konec frontmatteru zjistit z `metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset` a text vložit za něj (na začátek těla). Append jde na konec souboru.
- **Regex scope:** defaultně jen **tělo** (obsah za frontmatterem) — pokrývá i inline `#tagy`. Nastavitelné (`regexScope`) na *celý soubor*, ale s varováním kvůli riziku poškození YAML.
- Regex: podpora flagů `g`/`i`/`m`, capture groups v náhradě (`$1`, `$2`).

### 4.4 Aplikační flow
1. Vyřeš seznam vybraných souborů (checkboxy; default všechny).
2. **Vytvoř běh (run):** unikátní `runId`, záloha všech vybraných souborů → manifest (§7).
3. Pro každý soubor aplikuj operace v pořadí §4.2. Chyby izoluj per soubor (try/catch), pokračuj, sbírej do reportu.
4. Ulož post-edit hash každého souboru do manifestu.
5. Zapiš běh do historie (pro undo) a zobraz výsledný souhrn (úspěchy / selhání).

---

## 5. Náhled / souhrn dopadu

Před aplikací zobraz **souhrn** (potvrzeno jako dostatečné):
- Počet dotčených poznámek.
- Rozpis per operace: „147× set `status`", „12× append", „320 regex nahrazení v 89 souborech".
- U regexu: počet matchů a upozornění, pokud je nula (pravděpodobně špatný vzor) nebo naopak extrémně mnoho.
- Validace: pokud je regex nevalidní, seznam prázdný, nebo žádná operace nedefinovaná → tlačítko *Aplikovat* je disabled.

*(Řádkový diff není v rozsahu v1 — souhrn stačí. On-demand diff je kandidát na v2.)*

---

## 6. UI / UX

### 6.1 Aktivace
- `ItemView` registrovaná pod vlastní `VIEW_TYPE`; otevírá se do hlavního leaf (ne sidebar).
- Ribbon ikona + command *„Mass Edit: Open"*.

### 6.2 Desktop — jedna plocha
Tři sekce vedle sebe / pod sebou v jednom panelu:
1. **Query builder** (nahoře) — kořenová skupina, tlačítka *+ Pravidlo*, *+ Skupina*, přepínač AND/OR na každé skupině, NOT toggle, mazání. Živé počítadlo.
2. **Výsledky** (uprostřed) — virtualizovaný seznam s checkboxy (default zaškrtnuto), název + cesta, „vybrat vše / nic". 
3. **Editor operací + Aplikovat** (dole/vpravo) — přidávání operací, souhrn, tlačítko *Aplikovat* (mauve) a přístup k historii/undo.

### 6.3 Mobil — dvě záložky
Detekce `Platform.isMobile`. Dvě přepínatelné záložky:
- **Záložka 1:** Filtr + výsledky.
- **Záložka 2:** Edit operace + souhrn + Aplikovat.

### 6.4 Komponenty (Svelte)
```
ui/
  QueryBuilder.svelte     // rekurzivní: renderuje Group → GroupNode
  GroupNode.svelte        // AND/OR přepínač, NOT, děti (rekurze), + Rule / + Group
  RuleRow.svelte          // pole → operátor → hodnota (operátory dle pole)
  ResultsList.svelte      // virtualizace, checkboxy
  OperationsPanel.svelte  // seznam edit operací + editor
  SummaryBar.svelte       // souhrn dopadu + Aplikovat
  HistoryPanel.svelte     // seznam běhů + Undo
```

---

## 7. Záloha a undo

### 7.1 Umístění záloh
- **Default:** složka pluginu — `${this.manifest.dir}/backups/` (tj. `.obsidian/plugins/<id>/backups/`). Přístupná primárně z pluginu, není v běžném file exploreru.
- **Nastavitelné** na libovolnou cestu ve vaultu (setting `backupFolder`).
- Zápis/čtení přes `app.vault.adapter` (read/write/mkdir/list/remove), protože cesty jsou mimo běžné `TFile`.
- **Tradeoff k zdokumentování v README:** složka pluginu se nemusí synchronizovat a reinstalace pluginu ji může smazat. Pro trvalé zálohy zvol cestu ve vaultu.

### 7.2 Struktura běhu
```
<backupFolder>/
  <runId>/                       // runId = ISO timestamp + krátký hash
    manifest.json
    files/
      <relativní/cesta/k/poznámce.md>   // 1:1 kopie originálu před editací
```

`manifest.json`:
```json
{
  "runId": "2026-07-02T10-15-03_a1b2c3",
  "timestamp": 1751449503000,
  "querySnapshot": { /* serializovaný Query */ },
  "operations": [ /* seznam EditOp */ ],
  "files": [
    { "path": "...", "backupPath": "...", "hashBefore": "...", "hashAfter": "..." }
  ]
}
```

### 7.3 Undo
- Historie běhů v `data.json` (nebo čtená z manifestů). Panel s tlačítkem *Vrátit zpět* per běh.
- Undo = obnova souborů z `files/` daného běhu.
- **Detekce driftu:** před obnovou porovnej aktuální hash souboru s `hashAfter`. Pokud se liší (soubor byl mezitím ručně změněn), varuj a nabídni per soubor: *přeskočit / přepsat*.
- **Transakční model:** jeden běh = jedna jednotka undo. Undo je primárně zásobníkové (poslední běhy). Undo staršího běhu, jehož soubory zasáhly novější běhy, hlásí konflikt a vyžaduje potvrzení.

### 7.4 Retence
- Setting `backupRetention` (počet posledních běhů, default např. 20). Při překročení ořezávej nejstarší běhy (smaž složku + záznam).

---

## 8. Nastavení (SettingsTab)

| Klíč | Typ | Default | Popis |
|------|-----|---------|-------|
| `backupFolder` | string | `` (= složka pluginu) | Kam ukládat zálohy |
| `backupRetention` | number | 20 | Počet uchovaných běhů |
| `confirmBeforeApply` | boolean | true | Potvrzovací dialog před aplikací |
| `defaultSelectAll` | boolean | true | Výchozí zaškrtnutí výsledků |
| `regexScope` | `'body'` \| `'whole'` | `'body'` | Rozsah regex operací |
| `liveCountDebounceMs` | number | 200 | Debounce živého počítadla |

---

## 9. Edge cases a bezpečnost

- **Poznámky bez frontmatteru:** `fm-*` a prepend musí korektně frontmatter vytvořit / vložit před tělo (`processFrontMatter` to řeší; u prepend hlídat `frontmatterPosition`).
- **Tagy jako string vs list:** normalizovat před úpravou.
- **Nevalidní regex:** validovat při zadání, disable *Aplikovat*, chybová hláška.
- **Catastrophic backtracking / pomalý regex:** per-soubor try/catch; při selhání soubor přeskočit a zaznamenat do reportu.
- **Soubor změněn během běhu:** `vault.process` pracuje nad aktuálním obsahem (čte čerstvě), takže edit je konzistentní; drift se řeší až u undo (§7.3).
- **Prázdný výsledek / žádná operace:** *Aplikovat* disabled.
- **Jen markdown:** `getMarkdownFiles()`, ostatní soubory ignorovat.
- **Chybějící/přesunutá záloha při undo:** ošetřit chybu, nezhroutit se.
- **Velký vault:** fáze 1 z metadataCache + debounce; virtualizovaný seznam výsledků.

---

## 10. Vzhled — Catppuccin Mocha (mauve)

Respektuj Obsidian layout CSS proměnné (kompatibilita s tématem uživatele), ale vlastní prvky pluginu naskinuj Catppuccin Mocha s **mauve accentem**.

```css
/* Catppuccin Mocha */
-- me-base:     #1e1e2e;
--me-mantle:   #181825;
-- me-crust:    #11111b;
-- me-surface0: #313244;
-- me-surface1: #45475a;
--me-surface2: #585b70;
-- me-overlay0: #6c7086;
-- me-text:     #cdd6f4;
--me-subtext0:  #a6adc8;
--me-accent:    #cba6f7;  /* mauve — primární akcent, tlačítka, aktivní stavy */
--me-red:       #f38ba8;  /* destruktivní: delete, undo varování */
--me-green:     #a6e3a1;  /* úspěch */
--me-yellow:    #f9e2af;  /* upozornění */
--me-blue:      #89b4fa;
```
- Primární tlačítka (*Hledat*, *Aplikovat*) a aktivní přepínače: mauve.
- Destruktivní akce (smazat pravidlo, delete klíč, undo): red accent.
- AND/OR přepínače a NOT badge výrazně odlišené barvou pro rychlou čitelnost stromu.

---

## 11. Fáze implementace (doporučené pořadí)

1. **Skeleton:** manifest, esbuild, `main.ts`, prázdná `MassEditView`, ribbon + command, SettingsTab.
2. **Query jádro:** `types.ts`, `operators.ts`, `engine.ts` s tříhodnotovou logikou + unit testy nad mockovaným cache.
3. **Builder UI:** rekurzivní Svelte komponenty + živé počítadlo (fáze 1).
4. **Výsledky:** virtualizovaný seznam + výběr (default vše).
5. **Edit operace:** `operations.ts`, `applier.ts` přes oficiální API + pořadí + normalizace tagů/prepend.
6. **Backup + undo:** `backupManager.ts`, manifest, retence, drift detekce.
7. **Souhrn + aplikační flow:** SummaryBar, validace, potvrzení.
8. **Styling + mobil:** Catppuccin skin, `Platform.isMobile` dvě záložky.
9. **Polish:** edge cases, error reporty, README (vč. tradeoffu záloh).

---

## 12. Testovací scénáře (akceptační)

- Query: `(tag has project/* AND fm.status = "todo") OR name contains "TODO"` → správná množina, tělo se nečte.
- Přidání `fm.status = done` na 150 poznámek → všechny mají klíč, ostatní frontmatter netknutý.
- Regex `\bfoo\b` → `bar` na 300 poznámkách → nahrazení jen v těle, YAML netknutý.
- Prepend banneru → text je AŽ za frontmatterem, ne před `---`.
- `tag-add` na poznámky, kde `tags` chybí / je string / je list → korektní pole bez duplicit.
- Undo běhu → soubory obnoveny; ručně změněný soubor mezi tím → varování + volba.
- Nevalidní regex → *Aplikovat* disabled, srozumitelná chyba.
- Prázdný výsledek → nelze aplikovat.

---

## 13. Poznámky pro implementaci
- Plugin id návrh: `mass-edit` (display „Mass Edit"). Klidně přejmenuj na tematický název ve stylu vaultu.
- Žádné ruční parsování YAML ani ruční skládání frontmatter stringů — vždy `processFrontMatter`.
- Všechny operace nad tělem přes `vault.process` (atomické), ne `read` + `modify` odděleně.
- Kód komentovat česky/anglicky dle zvyklostí; identifikátory anglicky.
