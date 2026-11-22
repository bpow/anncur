# Tables

Case reports often give each individual's details only in a table, with one column per individual and one row per feature. On a saved web page, every cell becomes a passage of its own: the row label, then one passage per cell, row by row.

- **Rows that can be read safely.** A blank cell produces no passage. A row can therefore be matched to the columns only when it has a value in every column, meaning as many cell passages as the table has individuals. Read the header row first, to know the column order and their count.
- **Quotes.** A cell's text (`+`, `-`, `F`, `3460C>T`) is too short, or too common, to quote. For a fact from a fully filled row, quote the row's label cell, such as "Macrocephaly". Name the individuals whose cell says it applies, and make a second fact with `caseNotHpos` for those whose cell says it does not.
- **When a label is not unique.** A row label may also occur elsewhere, for example in a reference title. `check` then reports it as occurring more than once, and there is no way to quote more of a cell. Leave that row out, and say so under `notInBatch`.
- **Rows with blank cells.** List them under `notInBatch` for the curator to read from the table itself. Never guess which column a value belongs to.
- **Text and table disagree.** Record what each states, each on its own quote, and say in `variantEvidence` (or the field concerned) that the other source differs. Also list the disagreement under `notInBatch`.
- **Labels and footnotes.**
  - Abbreviations in the header (M, F, m, yrs) are explained in the table's footnotes. Use the words in `case`: "male, 4 months".
  - A footnote such as "RefSeq accession number NM_020297.2 was used in naming mutations" gives the transcript for the table's variants.
