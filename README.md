# Mass Editor

Obsidian plugin pro **hromadné vyhledávání a editaci** poznámek napříč vaultem. Postavíte si vizuální dotaz (zanořené AND/OR skupiny s NOT), získáte seznam poznámek a hromadně na nich provedete editační operace — bezpečně, se zálohou a možností vrátit zpět.

Vzhled: Catppuccin Mocha s mauve akcentem.

## Funkce

- **Vizuální query builder** se zanořenými AND/OR skupinami a NOT.
- **Dvoufázový vyhledávací engine** (metadata → obsah) s tříhodnotovou (Kleene) logikou — tělo poznámek se čte jen tam, kde metadata sama nerozhodnou. Rychlé i na tisících poznámek.
- **Pole:** tag, frontmatter (per klíč), tělo, název, cesta, umístění (složka + rekurze), datum vytvoření/úpravy.
- **Editační operace:** frontmatter set / add / delete / append-to-list, tagy add / remove, tělo append / prepend, regex najít & nahradit (capture groups `$1`).
- **Výběr výsledků** checkboxy (default vše), živé počítadlo.
- **Souhrn dopadu** před aplikací (počet poznámek, rozpis per operace, počet regex shod + varování).
- **Záloha + undo:** každý běh = jedna transakce; obnova z zálohy s detekcí driftu.
- **Layout:** jedna plocha na desktopu, dvě záložky na mobilu.

## Instalace přes BRAT

1. Nainstalujte komunitní plugin [BRAT](https://github.com/TfTHacker/obsidian42-brat).
2. V BRAT zvolte **Add Beta Plugin** a vložte repozitář: `ondreu/mass-editor`.
3. BRAT stáhne poslední release a plugin povolte v *Settings → Community plugins*.

Otevřete přes ribbon ikonu (⟳) nebo příkaz **Mass Editor: Otevřít**.

## Použití

1. **Dotaz** — poskládejte pravidla a skupiny. AND/OR přepínač je na každé skupině, NOT badge na pravidle i skupině. Živé počítadlo ukazuje odhad (`až N poznámek`, dokud nejsou vyhodnocena obsahová pravidla).
2. **Hledat** — dopočítá plný výsledek (včetně čtení těla, kde je potřeba).
3. **Výsledky** — odškrtejte poznámky, které nechcete měnit (default jsou vybrané všechny).
4. **Editační operace** — přidejte jednu či více operací.
5. **Aplikovat** — zobrazí se souhrn dopadu; po potvrzení se vytvoří záloha a operace se aplikují.

Pořadí operací je pevné a deterministické: **frontmatter → tagy → regex → append/prepend**.

## Zálohy a undo

- Každý běh editace nejdřív zazálohuje dotčené soubory a zapíše `manifest.json`.
- Historii a *Vrátit zpět* najdete pod ikonou historie v hlavičce.
- Undo obnoví soubory ze zálohy. Pokud byl soubor mezitím ručně změněn (drift), plugin varuje a nabídne *přeskočit / přepsat*.

> **Tradeoff k umístění záloh:** výchozí složka záloh je uvnitř složky pluginu (`.obsidian/plugins/mass-editor/backups/`). Ta se **nemusí synchronizovat** a **reinstalace pluginu ji může smazat**. Pro trvalé zálohy nastavte v *Settings* cestu **ve vaultu** (`backupFolder`).

## Nastavení

| Klíč | Default | Popis |
|------|---------|-------|
| Složka záloh | složka pluginu | Kam ukládat zálohy |
| Retence záloh | 20 | Počet uchovaných běhů |
| Potvrdit před aplikací | zapnuto | Potvrzovací dialog |
| Výchozí výběr všech výsledků | zapnuto | Nové výsledky jsou zaškrtnuté |
| Rozsah regexu | jen tělo | `tělo` (bezpečné) / `celý soubor` (riziko YAML) |
| Debounce živého počítadla | 200 ms | Prodleva přepočtu |

## Vývoj

```bash
npm install
npm run dev      # watch build → main.js
npm run build    # typecheck + produkční bundle
npm test         # unit testy (engine, operátory, pořadí operací)
```

Klíčové moduly: `src/query` (typy, operátory, evaluator, engine), `src/edit` (operace, applier, souhrn), `src/backup` (zálohy + undo), `src/ui` (DOM komponenty), `src/view` (hlavní view).

Bezpečnost implementace: frontmatter/tagy výhradně přes `app.fileManager.processFrontMatter`, tělo přes `app.vault.process` (atomicky). Žádné ruční parsování YAML.

## Licence

MIT — viz [LICENSE](LICENSE).
