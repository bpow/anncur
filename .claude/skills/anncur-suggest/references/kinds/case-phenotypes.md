# case-phenotypes

Phenotypes present or explicitly absent in the individuals, with their course. Quote the sentence that states them.

- **`casePresentingHpos`**: phenotypes the article says the individual has.
  - Give each one as an HPO term label, such as "Syncope", "Asymmetric septal hypertrophy" or "Palpitations".
  - Use the term that matches the article's meaning, not a broader or narrower one. When unsure, run `terms hp "<words>"` and pick a returned label.
  - Keep phenotypes with no fitting term as the article's own words.
- **`caseNotHpos`**: only phenotypes the article says are absent, normal or not seen ("no seizures", "normal echocardiogram"). Never list a phenotype as absent because it is not mentioned.
- **`course`**: onset, progression or resolution, as stated, for example "Onset at 12 years; progressive dyspnea".

Several facts of this kind for one individual are fine: one per passage that describes phenotypes. A table row of features is one fact quoted from that row.

Do not:

- infer phenotypes from a diagnosis name: "hypertrophic cardiomyopathy" alone is a `case-disease` fact, not a list of features;
- give HPO ids yourself.
