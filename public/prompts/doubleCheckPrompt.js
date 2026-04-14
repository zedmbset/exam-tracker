// ─────────────────────────────────────────────────────────────────────────────
//  doubleCheckPrompt.js  —  Comparaison deux JSON + JSON final
//
//  NOUVELLE APPROCHE :
//    - Le meme prompt de digitisation est envoye a DEUX modeles independants.
//    - Chaque modele produit son propre JSON (json1 et json2).
//    - Un TROISIEME modele recoit les deux JSON et compare les divergences
//      question par question, sans avoir besoin du PDF.
//    - Le rapport liste les divergences avec JSON1, JSON2 et JSONF.
//    - Step 2 : le troisieme modele applique STRICTEMENT JSONF et produit le JSON final.
//
//  Exports :
//    generateDoubleCheckPrompt(data, json1, json2)                      → rapport (Step 1)
// ─────────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────────
// TAXONOMY — Source unique de verite pour tous les types de divergences.
// ─────────────────────────────────────────────────────────────────────────────

const TAXONOMY = {

  // ── SECTION A : DIVERGENCES TEXTUELLES ────────────────────────────────────
  A: [
    {
      code: "SPELL",
      mode: "INLINE",
      description: "Mot mal orthographie ou coquille — divergence entre JSON1 et JSON2.",
      qualifies: [
        "JSON1 dit 'protozoaite', JSON2 dit 'protozoaire' → JSONF = protozoaire",
        "JSON1 dit 'Fluconasole', JSON2 dit 'Fluconazole' → JSONF = Fluconazole",
      ],
      never: [
        "Ne signaler que si les deux JSON divergent sur ce mot.",
        "Ne jamais corriger si les deux JSON ont la meme valeur, meme incorrecte.",
      ],
      howToReport:
        "REGLE DE MISE EN EVIDENCE OBLIGATOIRE : entourer le mot divergent de crochets [] dans JSON1, JSON2 ET JSONF.\n" +
        "JSON1  : '...Les antigenes sont [reconnues] seulement par les [HCR]'\n" +
        "JSON2  : '...Les antigenes sont [reconnus] seulement par les [BCR]'\n" +
        "JSONF  : '...Les antigenes sont [reconnus] seulement par les [BCR]'\n" +
        "Objectif : la verification humaine repere immediatement le mot corrige sans relire toute la phrase.",
    },
    {
      code: "DIGIT",
      mode: "INLINE_OR_BLOQUANT",
      description: "Chiffre, valeur clinique, dose, unite numerique ou mesure differente entre JSON1 et JSON2.",
      qualifies: [
        "JSON1 dit '50%', JSON2 dit '30%'",
        "JSON1 dit '1.2 millions', JSON2 dit '2,4 millions'",
        "JSON1 dit '84 ans', JSON2 dit '78 ans'",
        "JSON1 dit '95/46', JSON2 dit '95/50'",
      ],
      never: [
        "Ne jamais signaler si la difference est uniquement typographique et ne change pas la valeur.",
        "Exemple a ignorer : '10%' vs '10 %' si le nombre est identique.",
        "Ne jamais trancher par logique medicale — la verification humaine tranche dans le PDF.",
      ],
      modeRule: "INLINE si un des deux est evidemment une coquille OCR sans ambiguite. BLOQUANT si les deux valeurs sont plausibles, cliniquement significatives ou modifient une mesure.",
      suggestion: "JSONF: propose la valeur qui s'integre le mieux dans le contexte clinique de la question (ex: dose standard, valeur biologique normale, seuil diagnostique). ??? si les deux valeurs sont egalement plausibles.\nMismatch Note: 1-2 phrases — identifie les deux valeurs et explique pourquoi elles divergent (ex: 'JSON1 indique 10 mg, JSON2 indique 100 mg. Les deux doses sont cliniquement plausibles dans ce contexte.').",
    },
    {
      code: "SYMBOL",
      mode: "INLINE",
      description: "Caractere grec, symbole mathematique ou signe clinique different entre JSON1 et JSON2 et susceptible de changer le sens.",
      qualifies: [
        "JSON1 dit 'b', JSON2 dit 'β' → JSONF = β",
        "JSON1 dit 'mm3', JSON2 dit 'mm³' → JSONF = mm³",
        "JSON1 dit 'Ca2+', JSON2 dit 'Ca²⁺' → JSONF = Ca²⁺",
      ],
      never: [
        "Ne jamais signaler la typographie francaise autour des signes ': ; ? !'.",
        "Ne jamais signaler un espace avant ou apres un symbole si le sens reste strictement identique.",
        "Ne jamais modifier si les deux JSON ont le meme symbole.",
        "Ne jamais signaler une difference de type de tiret (trait d'union '-' vs tiret demi-cadrat '–' vs tiret cadratin '—')" +
        " si le tiret joue uniquement un role separateur ou de liaison dans la phrase et ne porte pas de valeur mathematique ou clinique" +
        " (ex: 'neutrophile – matrice' vs 'neutrophile - matrice' → SILENT FIX, ne pas signaler)." +
        " Seul cas reportable : le tiret represente un signe moins ou une plage de valeurs cliniques (ex: '3-5 g/dL' vs '3–5 g/dL'" +
        " dans un contexte de valeur biologique).",
      ],
    },
    {
      code: "UNIT",
      mode: "INLINE",
      description: "Unite de mesure differente entre JSON1 et JSON2.",
      qualifies: [
        "JSON1 dit 'mg/dl', JSON2 dit 'mg/dL' → JSONF = mg/dL",
      ],
      never: [],
    },
    {
      code: "ACRONYM",
      mode: "INLINE",
      description: "Casse d'un sigle differente entre JSON1 et JSON2.",
      qualifies: [
        "JSON1 dit 'Dress', JSON2 dit 'DRESS' → JSONF = DRESS",
      ],
      never: [],
    },
    {
      code: "PREFIX_NUM",
      mode: "INLINE",
      description: "Numero de question present en prefixe dans le champ 'text' d'un seul des deux JSON.",
      qualifies: [
        'JSON1.text = "6. Intertrigo a dermatophytes", JSON2.text = "Intertrigo a dermatophytes"',
      ],
      never: [],
    },
    {
      code: "PREFIX_PROP",
      mode: "INLINE",
      description: "Prefixe de proposition mal forme dans un seul des deux JSON.",
      qualifies: [
        'JSON1.b = "(b) Debute de facon...", JSON2.b = "Debute de facon..."',
      ],
      never: [
        "INTERDICTION ABSOLUE : ne jamais signaler une difference de prefixe entre lettre JSON et prefixe PDF.",
      ],
    },
  ],

  // ── SECTION B : DIVERGENCES STRUCTURELLES ─────────────────────────────────
  B: [
    {
      code: "PROP_DIVERGE",
      mode: "BLOQUANT",
      description: "Le texte d'une proposition differe entre JSON1 et JSON2.",
      qualifies: [
        "JSON1.b = 'Inhibe la voie du complement', JSON2.b = 'Active la voie du complement'",
        "JSON1.d = 'Texte A', JSON2.d = 'Texte completement different'",
      ],
      never: [
        "INTERDICTION ABSOLUE : ne jamais trancher par logique medicale.",
        "Ne pas signaler si les deux JSON sont identiques sur ce champ.",
        "REGLE ANTI-BANAL : avant de signaler une PROP_DIVERGE, verifier que les deux textes" +
        " restent differents apres avoir ignore tous les elements de la liste SILENT FIX" +
        " (point final, casse initiale, espaces, ponctuation cosmetique, variantes typographiques)." +
        " Si la seule difference visible est un point final, une majuscule initiale ou un espace cosmétique" +
        " → NE PAS SIGNALER. Appliquer le SILENT FIX mentalement et ignorer entierement cette divergence.",
      ],
      howToReport:
        "Reference : [Num].[champ]  ex: 12.d\n" +
        "JSON1 : texte complet de la proposition dans JSON1\n" +
        "JSON2 : texte complet de la proposition dans JSON2\n" +
        "JSONF : [valeur proposee par le Modele 3, ou ??? si indecidable]",
      suggestion:
        "JSONF: propose la valeur la plus complete ou la plus coherente selon le cas :\n" +
        "  - Verbes opposes (Inhibe/Active) : ??? — les deux sont plausibles, impossible de trancher sans PDF.\n" +
        "  - Une version plus longue/precise : propose la version plus longue si elle contient un complement absent de l'autre.\n" +
        "  - Contenus incompatibles : ??? — une seule version correspond au PDF.\n" +
        "Mismatch Note: 1-2 phrases — decrit la nature de l'ecart (ex: 'JSON1 dit Inhibe, JSON2 dit Active. Les deux verbes sont cliniquement plausibles.' ou 'JSON2 inclut les definitions RF/RJ. JSON1 ne les inclut pas.').",
    },
    {
      code: "PROP_ORDER",
      mode: "BLOQUANT",
      description: "Les propositions sont dans un ordre different entre JSON1 et JSON2 — meme contenu, positions echangees.",
      qualifies: [
        "JSON1: a=X b=Y c=Z, JSON2: a=Y b=X c=Z — le texte de X et Y est echange",
      ],
      never: [
        "Ne pas confondre avec PROP_DIVERGE (texte different).",
        "PROP_ORDER = meme texte, mauvaise position dans l'un des deux JSON.",
      ],
      howToReport:
        "Reference : [Num].props\n" +
        "JSON1 : ordre JSON1 — a='debut...' b='debut...' c='debut...' d='debut...' e='debut...'\n" +
        "JSON2 : ordre JSON2 — a='debut...' b='debut...' c='debut...' d='debut...' e='debut...'\n" +
        "JSONF : ??? (ordre visuel uniquement — verification PDF requise)",
      suggestion: "JSONF: ??? toujours — l'ordre correct ne peut etre determine que visuellement dans le PDF.\nMismatch Note: 1-2 phrases — decrit les propositions concernees et comment leurs positions different (ex: 'JSON1 place [texteX] en a et [texteY] en b. JSON2 les inverse. L'ordre d'impression dans le PDF est la seule reference.').",
    },
    {
      code: "PROP_SWAP",
      mode: "BLOQUANT",
      description: "Deux propositions ont le meme contenu mais echange de position entre JSON1 et JSON2.",
      qualifies: [
        "JSON1: d='Stimulateur IgE' e='Assure IFN-α', JSON2: d='Assure IFN-α' e='Stimulateur IgE' — textes identiques, positions echangees.",
      ],
      never: [
        "Ne pas confondre avec PROP_DIVERGE (texte different).",
        "Ne pas confondre avec PROP_ORDER (plus de deux propositions concernees ou ordre global different).",
        "Si plus de deux propositions sont impliquees ou si elles ne sont pas consecutives → utiliser QCM_SHIFT.",
      ],
      howToReport:
        "Reference : [Num].[champ1]-[champ2]  ex: 7.d-e\n" +
        "JSON1 : [champ1]='texte complet' [champ2]='texte complet'\n" +
        "JSON2 : [champ1]='texte complet' [champ2]='texte complet'\n" +
        "JSONF : [champ1]=[valeur proposee ou ???] / [champ2]=[valeur proposee ou ???]",
      suggestion: "JSONF: si les deux textes echanges suivent une progression logique ou alphabetique claire (ex: A avant B, posologie croissante), propose l'ordre coherent. Sinon ??? si les deux ordres sont egalement plausibles.\nMismatch Note: 1-2 phrases — nomme les deux champs et leurs textes dans chaque JSON (ex: 'JSON1 place [texteX] en d et [texteY] en e. JSON2 les inverse. L'ordre logique/alphabetique suggere [ordre] mais le PDF reste la reference finale.').",
    },
    {
      code: "QCM_SHIFT",
      mode: "BLOQUANT",
      description: "Le QCM entier (text + plusieurs ou toutes les propositions) differe entre JSON1 et JSON2 — decalage structurel majeur.",
      qualifies: [
        "JSON1.text contient les options en titre, JSON2.text contient l'enonce correct — le modele a capture la mauvaise zone du PDF.",
        "JSON1 et JSON2 ont des enonces et des propositions completement differents pour la meme question.",
        "Plusieurs propositions (3+) ont toutes des divergences de contenu pour la meme question.",
      ],
      never: [
        "Ne pas signaler champ par champ si la question entiere est decalee — utiliser une seule ligne QCM_SHIFT.",
        "Ne pas trancher par logique medicale.",
      ],
      howToReport:
        "Reference : [Num].QCM\n" +
        "Type : QCM_SHIFT | [autres codes si applicable, ex: FIELD_MISSING]\n" +
        "JSON1 : reconstruction complete du QCM depuis JSON1 (text + a + b + c + d + e)\n" +
        "JSON2 : reconstruction complete du QCM depuis JSON2 (text + a + b + c + d + e)\n" +
        "JSONF : reconstruction ligne par ligne avec la meilleure valeur proposee ou ??? par champ :\n" +
        "  Text: [valeur proposee ou ???]\n" +
        "  A: [valeur proposee ou ???]\n" +
        "  B: [valeur proposee ou ???]\n" +
        "  C: [valeur proposee ou ???]\n" +
        "  D: [valeur proposee ou ???]\n" +
        "  E: [valeur proposee ou ???]\n" +
        "(le verificateur valide chaque valeur proposee ou remplace ??? par la valeur correcte du PDF)\n" +
        "Mismatch Note : liste toutes les raisons individuelles separees par ' + '",
      suggestion: "JSONF champ par champ: propose la reconstruction la plus coherente en prioritisant le JSON dont l'enonce correspond mieux a la zone correcte du PDF. ??? sur chaque champ ou les deux JSON divergent egalement.\nMismatch Note: 1-2 phrases — explique la nature du decalage (ex: 'JSON1 a capture l'enonce correct mais JSON2 contient les options en titre. Decalage structurel probable — l'un des modeles a capture la mauvaise zone du PDF.').",
    },
    {
      code: "PROP_TRUNCATED",
      mode: "BLOQUANT",
      description: "Une proposition est presente dans les deux JSON mais tronquee (coupee en cours de phrase) dans l'un d'eux.",
      qualifies: [
        "JSON1.b = 'Le lipopolysaccharide (LPS) des bacteries Gram', JSON2.b = 'Le lipopolysaccharide (LPS) des bacteries Gram negatif' — JSON1 est tronque.",
        "JSON1.a = 'Est declenchee par la fixation d IgM ou IgG sur un', JSON2.a = 'Est declenchee par la fixation d IgM ou IgG sur un antigene'",
      ],
      never: [
        "Ne pas confondre avec PROP_DIVERGE (contenu completement different).",
        "Ne pas corriger par deduction — la verification humaine verifie le texte complet dans le PDF.",
      ],
      howToReport:
        "Reference : [Num].[champ]  ex: 12.b\n" +
        "JSON1 : texte tronque depuis JSON1\n" +
        "JSON2 : texte complet depuis JSON2\n" +
        "JSONF : [version non tronquee proposee — valider ou corriger dans le PDF]",
      suggestion: "JSONF: propose la version non tronquee (la plus longue). Si les deux versions semblent tronquees differemment, propose la plus longue des deux et signale que verification dans le PDF reste necessaire.\nMismatch Note: 1-2 phrases — identifie lequel est tronque et ou la coupure se produit (ex: 'JSON1 est tronque apres le mot [mot]. JSON2 contient la phrase complete. Verifiez la fin de la proposition dans le PDF.').",
    },
    {
      code: "CT_DIVERGE",
      mode: "BLOQUANT",
      description: "Valeur du champ 'correct' differente entre JSON1 et JSON2.",
      qualifies: [
        "JSON1.correct = 'ACD', JSON2.correct = 'ABC'",
        "JSON1 a un champ 'correct', JSON2 ne l'a pas",
      ],
      never: [
        "Ne jamais trancher par logique medicale.",
      ],
      suggestion: "JSONF: si les deux valeurs partagent une majorite de lettres et que seule une lettre differe, propose la valeur majoritaire si une seule question est concernee. ??? si le doute persiste ou si plusieurs questions sont affectees.\nMismatch Note: 1-2 phrases — identifie les lettres qui different (ex: 'JSON1 a ACD, JSON2 a ABC. La lettre D est presente dans JSON1, la lettre B dans JSON2. Verifiez quelle reponse est cochee dans le CT du PDF.').",
    },
    {
      code: "CT_DRIFT",
      mode: "BLOQUANT",
      description: "Reponse CT decalee : dans un JSON la reponse d'une question est assignee a une autre.",
      qualifies: [
        "JSON1: Q5=ACD Q6=B, JSON2: Q5=B Q6=ACD",
      ],
      never: [
        "Ne corriger qu'apres verification humaine.",
      ],
      suggestion: "JSONF: si un alignement de majorite est visible dans le CT (ex: JSON1 et JSON2 concordent sur Q5 mais pas Q6 dans le contexte global), propose la valeur alignee avec la majorite des CT. ??? si les deux alignements sont egalement plausibles ou si plusieurs questions sont impactees.\nMismatch Note: 1-2 phrases — decrit les questions concernees et le decalage observe (ex: 'JSON1 assigne ACD a Q5 et B a Q6. JSON2 fait l'inverse. Decalage CT probable entre ces deux questions.').",
    },
    {
      code: "CT_SPACING",
      mode: "INLINE",
      description: "Espacement interne d'une valeur CT different entre les deux JSON.",
      qualifies: [
        "JSON1.correct = 'BC E', JSON2.correct = 'BCE' → JSONF = BCE",
      ],
      never: [
        "Ne jamais introduire un espace dans une valeur CT.",
      ],
    },
    {
      code: "HINT_DIVERGE",
      mode: "INLINE_OR_BLOQUANT",
      description: "Valeur du champ 'hint' differente entre JSON1 et JSON2.",
      qualifies: [
        'JSON1.hint = "ABCD, ABCDE, ABCE, ACDE, BCDE", JSON2.hint = "ABCD, ABCDE, ABCE, BCDE, ACDE"',
      ],
      never: [
        "Le format attendu est toujours base sur des lettres A-G separees par virgule, jamais des chiffres ni des chiffres romains.",
      ],
      modeRule: "INLINE si un des deux est evidemment incorrect. BLOQUANT si les deux sont plausibles.",
      suggestion: "JSONF: ??? toujours — les tables de combinaisons de type ABCD/ABCE ne peuvent etre confirmees que par lecture directe du PDF.\nMismatch Note: 1-2 phrases — decrit les combinaisons qui different entre les deux JSON (ex: 'JSON1 inclut ACDE dans la table de combinaisons, JSON2 ne l'inclut pas. Les tables sont differentes sur ce point.').",
    },
    {
      code: "SWAP_DIVERGE",
      mode: "BLOQUANT",
      description: "Un modele a pose un marqueur [SWAP] sur une question, l'autre non.",
      qualifies: [
        "JSON1.correct = '[SWAP: ordre suspect D-A-C-B-E]', JSON2.correct = 'ACD'",
      ],
      never: [
        "Ne pas signaler si les deux JSON ont le meme marqueur [SWAP].",
      ],
      suggestion: "JSONF: ??? toujours — le marqueur [SWAP] indique un doute sur l'ordre des propositions qui ne peut etre resolu que visuellement dans le PDF.\nMismatch Note: 1-2 phrases — indique quel modele a pose le marqueur et quelle est la suspicion d'echange (ex: 'JSON1 signale un [SWAP] suspect sur l'ordre D-A-C-B-E. JSON2 n'a pas ce marqueur. L'ordre visuel dans le PDF est a verifier.').",
    },
    {
      code: "CAS_DIVERGE",
      mode: "BLOQUANT",
      description: "Champ 'cas' present dans un JSON mais absent dans l'autre, ou texte different.",
      qualifies: [
        "JSON1 a 'cas' renseigne pour Q12, JSON2 ne l'a pas.",
      ],
      never: [],
      suggestion: "JSONF: propose le texte du cas le plus complet entre les deux JSON si l'un d'eux contient un texte et l'autre non. ??? si les deux textes sont presents mais divergent.\nMismatch Note: 1-2 phrases — explique la nature de la divergence (ex: 'JSON1 contient un champ cas pour Q12, JSON2 ne l'a pas. Le texte introductif pourrait etre un cas partage ou appartenir a une seule question.' ou 'Les deux JSON ont un texte de cas different pour Q12.').",
    },
    {
      code: "ROW_COUNT",
      mode: "BLOQUANT",
      description: "Nombre d'objets 'questions' different entre les deux JSON ou different du nombre attendu.",
      qualifies: [
        "JSON1 a 20 questions, JSON2 en a 19.",
      ],
      never: [
        "Ne pas signaler si l'ecart est explique par les questions declarees manquantes.",
      ],
      suggestion: "JSONF: ??? toujours — la difference de nombre de questions necessite un alignement manuel question par question dans le PDF.\nMismatch Note: 1-2 phrases — indique le compte dans chaque JSON et la cause probable (ex: 'JSON1 a 20 questions, JSON2 en a 19. Une question a probablement ete sautee ou fusionnee par l'un des modeles.').",
    },
    {
      code: "FIELD_MISSING",
      mode: "BLOQUANT",
      description: "Un champ obligatoire present dans un JSON est absent dans l'autre.",
      qualifies: [
        "JSON1 a le champ 'e' pour Q7, JSON2 ne l'a pas.",
        "JSON1 a 'correct' pour Q3, JSON2 n'a pas ce champ.",
      ],
      never: [
        "Ne pas signaler les champs derives (categoryId, year, tag, exp) — derivations du contexte.",
      ],
      suggestion: "JSONF: ??? toujours — un champ manquant ne peut pas etre deduit sans consultation du PDF.\nMismatch Note: 1-2 phrases — identifie le champ manquant et dans quel JSON il est absent (ex: 'Le champ correct est present dans JSON1 mais absent dans JSON2. Verifiez la reponse CT pour la question [Num] dans le PDF.' ou 'La proposition e est presente dans JSON1 mais absente dans JSON2. Verifiez si cette proposition existe dans le PDF pour cette question.').",
    },
    {
      code: "AUDIT_ONLY",
      mode: "INLINE_OR_BLOQUANT",
      description: "Incertitude CRITICAL ou HIGH presente dans audit d'un seul JSON — informative ou bloquante selon le champ impacte.",
      qualifies: [
        "JSON1.audit.uncertainties a un riskLevel CRITICAL sur Q5.b, JSON2 ne l'a pas logge.",
        "JSON2.audit.uncertainties a un riskLevel HIGH sur 'correct' pour Q43, JSON1 ne l'a pas logge.",
      ],
      never: [
        "Ne pas signaler les entrees identiques dans les deux audits.",
        "Ne pas signaler les entrees LOW ou MEDIUM sauf si elles concernent le champ 'correct'.",
        "Ne pas laisser en INLINE une incertitude HIGH ou CRITICAL qui touche 'correct', 'cas' ou la structure du QCM.",
      ],
      modeRule: "BLOQUANT si le champ impacte est 'correct', 'cas', une valeur clinique ou la structure du QCM. INLINE sinon.",
      suggestion: "JSONF: ne pas modifier — cette ligne signale une incertitude d'audit uniquement. JSONF reste la valeur issue du JSON le plus fiable sur ce champ (ou vide si aucune valeur n'est disponible). Aucune reconstruction n'est attendue.\nMismatch Note: 1-2 phrases — decrit l'incertitude signalee par le modele et le champ concerne (ex: 'JSON2 a signale une incertitude CRITICAL sur le champ correct de Q43. La valeur reconstruite [reconstructed] est peut-etre incorrecte. Verifiez ce champ directement dans le PDF.').",
    },
  ],

  silentFix: [
    "Espacement avant ponctuation double — typographie francaise valide.",
    "Espacement avant ': ; ? !' — difference purement typographique.",
    "Presence ou absence d'un deux-points final dans un intitule — cosmetique.",
    "Presence ou absence d'un point final de phrase — cosmetique.",
    "Casse initiale d'une proposition — cosmetique.",
    "Accentuation d'une majuscule quand le mot reste lexicalement identique (ex: Etat vs État).",
    "Ligature ou variante typographique sans changement de sens (ex: Oedeme vs Œdème).",
    "Double espace ou coupure de mot — cosmetique.",
    "Difference de separateur decimal ou de symbole de pourcentage uniquement typographique si la valeur numerique reste identique.",
    "Valeurs de champs derives (categoryId, year, tag, exp, tagSuggere) — jamais a auditer.",
    "Differences mineures dans le champ 'exp' — champ derive, ignorer.",
  ],
};


// ─────────────────────────────────────────────────────────────────────────────
// HELPER — Injecte la taxonomie en texte dans le prompt.
// ─────────────────────────────────────────────────────────────────────────────

function injectTaxonomy() {
  const lines = [];
  lines.push("═══════════════════════════════════════════");
  lines.push("TAXONOMIE DES DIVERGENCES REPORTABLES");
  lines.push("═══════════════════════════════════════════");
  lines.push("REGLE FONDAMENTALE : Tu ne peux signaler que des divergences dont le type");
  lines.push("correspond exactement a un code de cette taxonomie.");
  lines.push("Si une observation ne correspond a aucun code → SILENT FIX ou ignorer.");
  lines.push("");

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("SECTION A — DIVERGENCES TEXTUELLES");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const entry of TAXONOMY.A) {
    lines.push(`[${entry.code}] — mode: ${entry.mode} — ${entry.description}`);
    lines.push("  Qualifie :");
    for (const q of entry.qualifies) lines.push(`    • ${q}`);
    if (entry.modeRule) lines.push(`  Regle de mode : ${entry.modeRule}`);
    if (entry.howToReport) lines.push(`  Comment reporter : ${entry.howToReport}`);
    lines.push("  Ne jamais signaler :");
    for (const n of entry.never) lines.push(`    ✗ ${n}`);
    if (entry.suggestion) {
      lines.push("  Guidance JSONF / Mismatch Note :");
      for (const l of entry.suggestion.split("\n")) lines.push(`    ${l}`);
    }
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("SECTION B — DIVERGENCES STRUCTURELLES");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const entry of TAXONOMY.B) {
    lines.push(`[${entry.code}] — mode: ${entry.mode} — ${entry.description}`);
    lines.push("  Qualifie :");
    for (const q of entry.qualifies) lines.push(`    • ${q}`);
    if (entry.modeRule) lines.push(`  Regle de mode : ${entry.modeRule}`);
    if (entry.howToReport) {
      lines.push("  Comment reporter :");
      for (const l of entry.howToReport.split("\n")) lines.push(`    ${l}`);
    }
    if (entry.never.length > 0) {
      lines.push("  Ne jamais signaler :");
      for (const n of entry.never) lines.push(`    ✗ ${n}`);
    }
    if (entry.suggestion) {
      lines.push("  Guidance JSONF / Mismatch Note :");
      for (const l of entry.suggestion.split("\n")) lines.push(`    ${l}`);
    }
    lines.push("");
  }

  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  lines.push("SILENT FIX — Ne jamais inclure dans le rapport");
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  for (const s of TAXONOMY.silentFix) lines.push(`  ✗ ${s}`);
  lines.push("");

  return lines.join("\n");
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Rapport de comparaison JSON1 vs JSON2
// ─────────────────────────────────────────────────────────────────────────────

function buildDoubleCheckPrompt(data, json1, json2) {
  const lang           = data.lang        || "Francais";
  const moduleName     = data.module      || "-";
  const wilaya         = data.wilaya      || "-";
  const year           = data.year        || "-";
  const nQst           = data.nQst        || "?";
  const missingPos     = Array.isArray(data.missingPos)    ? data.missingPos    : [];
  const schemaQsts     = Array.isArray(data.schemaQsts)    ? data.schemaQsts    : [];
  const expectedRows   = typeof nQst === "number" ? nQst - missingPos.length : "?";
  const missingSummary = missingPos.length > 0 ? missingPos.join(", ") : "aucune";
  const schemaSummary  = schemaQsts.length > 0 ? schemaQsts.join(", ") : "aucune";
  const twoColNote     = data.isTwoColumn ? "OUI" : "NON";

  return `Tu es le troisieme modele arbitre pour un projet de numerisation d'examens medicaux algeriens.

⛔⛔⛔ REGLES ABSOLUES — LIRE AVANT TOUT ⛔⛔⛔
CETTE ETAPE = RAPPORT DE COMPARAISON UNIQUEMENT.
- INTERDICTION TOTALE de produire un TSV dans cette etape.
- INTERDICTION TOTALE d'ecrire VALIDATION PASSED ou VALIDATION FAILED.
- INTERDICTION TOTALE de trancher par logique medicale.
- Ton unique livrable est le bloc \`\`\`text\`\`\` du rapport de comparaison.
- La reponse est INVALIDE si le REVIEW REPORT n'est pas entierement a l'interieur d'un unique bloc \`\`\`text\`\`\`.
- La reponse est INVALIDE si tu ajoutes du texte avant ou apres ce bloc \`\`\`text\`\`\`.
- Termine ta reponse apres la section "CONTRAT TOUR SUIVANT MODELE". Rien d'autre apres.
⛔⛔⛔ FIN DES REGLES ABSOLUES ⛔⛔⛔

Tu recois :
1. JSON1 — produit par le premier modele de digitisation (ci-dessous)
2. JSON2 — produit par le second modele de digitisation independant (ci-dessous)

Tu NE recois PAS le PDF. Tu travailles exclusivement depuis les deux JSON.
Ta mission : identifier toutes les divergences entre JSON1 et JSON2, les classer,
et produire un rapport structure pour que la verification humaine tranche en consultant le PDF.

OBJECTIF PRIORITAIRE :
- Le but n'est PAS de maximiser le nombre de differences trouvees.
- Le but est de MINIMISER la charge de verification humaine tout en preservant la securite.
- Tu dois donc remonter uniquement les divergences serieuses, structurelles, cliniquement significatives ou liees au champ "correct".
- Les differences purement cosmetiques ou typographiques doivent etre absorbees par normalisation mentale puis ignorees.

IMPORTANT — FLUX SUR DEUX TOURS AVEC LE MEME MODELE :
- Tour 1 (ce message) : compare JSON1 et JSON2 puis retourne UNIQUEMENT le REVIEW REPORT.
- Ensuite, la verification humaine corrige JSONF directement dans ce rapport.
- Tour 2 (message suivant dans la meme conversation) : si tu recois le REVIEW REPORT complete avec JSONF finalise,
  tu dois alors appliquer JSONF strictement et retourner VALIDATION PASSED + le JSON final propre.
- N'anticipe jamais le Tour 2 dans cette reponse. Ici, tu dois seulement produire le REVIEW REPORT.

══════════════════════════════════════════════════════
CONTEXTE DE L'EXAMEN
══════════════════════════════════════════════════════
- Langue                         : ${lang}
- Module                         : ${moduleName}
- Wilaya                         : ${wilaya}
- Annee                          : ${year}
- Nombre de QCMs declares        : ${nQst}
- Nombre d'objets attendus       : ${expectedRows}
- Corrige Type present           : ${data.hasCT  ? "OUI" : "NON"}
- Cas cliniques presents         : ${data.hasCas  ? "OUI" : "NON"}
- Questions d'association        : ${data.hasComb ? "OUI" : "NON"}
- Questions declarees manquantes : ${missingSummary}
- Questions avec schema/image    : ${schemaSummary}
- Examen deux colonnes           : ${twoColNote}

JSON1 — PREMIER MODELE DE DIGITISATION
${json1}

JSON2 — SECOND MODELE DE DIGITISATION
${json2}

${data.hasComb ? `══════════════════════════════════════════════════════
QUESTIONS D'ASSOCIATION — INSTRUCTIONS SPECIFIQUES
══════════════════════════════════════════════════════
Cet examen contient des questions d'association. Ces questions comportent les champs specifiques suivants :
- \`hint\`    : combinaisons du tableau traduites en lettres A-G et jointes par ", " (ex: "ABCD, ABCDE, ABCE, ACDE, BCDE")
- \`correct\` : lettres des propositions de la combinaison correcte (ex: "ACDE") — meme format qu'un QCM standard multi-reponses.
- \`f\`, \`g\`  : present si la question comporte 6 ou 7 propositions — comparer comme toute proposition standard.

Regles de comparaison pour ces champs :
- Si \`hint\` est present dans un JSON mais absent dans l'autre → FIELD_MISSING.
- Si \`hint\` differe entre les deux JSON → HINT_DIVERGE (jamais PROP_DIVERGE).
- Les champs \`f\` et \`g\`, si presents, sont compares comme n'importe quelle proposition (PROP_DIVERGE, PROP_TRUNCATED, etc.).
- Le champ \`correct\` pour une question d'association contient des lettres de propositions (ex: "ACDE") et se compare exactement comme un \`correct\` de QCM standard — aucun traitement special.

` : ""}══════════════════════════════════════════════════════
ETAPE OBLIGATOIRE AVANT TOUT CLASSEMENT — PRE-FILTRE
══════════════════════════════════════════════════════
Pour chaque divergence detectee entre JSON1 et JSON2, tu dois executer ce pre-filtre avant
d'ouvrir la taxonomie et avant d'attribuer un code :

  NORMALISE les deux valeurs mentalement :
    (a) Supprime tout point final de phrase dans les deux textes.
    (b) Ignore la casse initiale (majuscule vs minuscule en debut de proposition).
    (c) Normalise les espaces multiples et les espaces avant ponctuation.
    (d) Remplace tout tiret separateur (- / – / —) par un tiret neutre si son role est
        purement syntaxique (liaison, separateur de phrase) et non mathematique ou clinique.
    (e) Ignore les variantes cosmetiques d'accent sur majuscules et les ligatures cosmetiques.

  → Si les deux textes sont IDENTIQUES apres normalisation :
      DISCARD — ne pas ajouter au rapport, ne pas attribuer de code.
  → Si une difference reelle subsiste apres normalisation :
      Continuer vers la taxonomie ci-dessous pour classer la divergence.

  Exemples de discards obligatoires :
    "migration par creation d'un pseudopode" vs "migration par creation d'un pseudopode."
    → point final supprime → textes identiques → DISCARD (PROP_DIVERGE interdit).
    "neutrophile – matrice extracellulaire" vs "neutrophile - matrice extracellulaire"
    → tiret separateur non clinique → textes equivalents → DISCARD (SYMBOL interdit).

${injectTaxonomy()}

══════════════════════════════════════════════════════
FORMAT DU JSONF PROPOSE
══════════════════════════════════════════════════════
Pour chaque ligne BLOQUANT du tableau :
  JSONF = meilleure valeur proposee par le Modele 3, choisie parmi JSON1 et JSON2 selon les regles de la taxonomie.
  JSONF = ??? uniquement si les deux valeurs sont egalement plausibles et qu'aucune ne peut etre privilegiee sans consulter le PDF.

  Mismatch Note = 1-2 phrases courtes expliquant la nature du desaccord entre JSON1 et JSON2.
  La Mismatch Note n'est PAS une instruction ; c'est une description factuelle de la divergence.

Regles absolues pour le JSONF PROPOSE :
- Ne jamais mettre "[SUGGESTION: ...]" dans le champ JSONF — la suggestion appartient a la Mismatch Note.
- Le verificateur humain peut accepter la valeur proposee directement ou la remplacer par la valeur correcte du PDF.
- ??? dans JSONF signifie que le Modele 3 ne peut pas choisir — la verification PDF est obligatoire.
- Pour les lignes INLINE : JSONF est directement rempli avec la valeur correcte — pas de ???.

══════════════════════════════════════════════════════
PROCEDURE DE COMPARAISON
══════════════════════════════════════════════════════

ETAPE 0 — COHERENCE METADATA
  Execute ces verifications avant tout comptage ou comparaison.
  Les verifications ratees produisent une ligne globale dans le tableau.

  CHECK CT (hasCT = ${data.hasCT ? "OUI" : "NON"}) :
  ${data.hasCT
    ? `hasCT = OUI declare.
    Si les deux JSON ont ZERO question avec un champ 'correct' :
      Reference=global | Type=FIELD_MISSING | JSON1=aucun champ 'correct' | JSON2=aucun champ 'correct'
      JSONF: ??? (correction de hasCT requise — verifiez si le CT est bien present dans le PDF)
      Mismatch Note: hasCT declare OUI mais aucun champ 'correct' extrait par les deux modeles. Relancez la numerisation si le CT est bien present dans le PDF, ou corrigez hasCT en NON.`
    : `hasCT = NON declare.
    Si les deux JSON ont AU MOINS UNE question avec un champ 'correct' :
      Reference=global | Type=FIELD_MISSING | JSON1=champs 'correct' presents | JSON2=champs 'correct' presents
      JSONF: ??? (correction de hasCT requise — verifiez si le PDF contient un CT)
      Mismatch Note: hasCT declare NON mais les deux modeles ont rempli des champs 'correct'. Risque de deduction medicale non autorisee — si le PDF ne contient pas de CT, les valeurs 'correct' doivent etre supprimees.`}

  CHECK CAS (hasCas = ${data.hasCas ? "OUI" : "NON"}) :
  ${data.hasCas
    ? `hasCas = OUI declare.
    Si les deux JSON ont ZERO champ 'cas' :
      Reference=global | Type=CAS_DIVERGE | JSON1=aucun champ 'cas' | JSON2=aucun champ 'cas'
      JSONF: ??? (correction de hasCas requise — verifiez si le cas clinique est bien present dans le PDF)
      Mismatch Note: hasCas declare OUI mais aucun champ 'cas' extrait par les deux modeles. Relancez la numerisation si le cas clinique est bien present dans le PDF, ou corrigez hasCas en NON.`
    : "(hasCas=NON — pas de verification necessaire.)"}

  CHECK ASSOCIATIONS (hasComb = ${data.hasComb ? "OUI" : "NON"}) :
  ${data.hasComb
    ? `hasComb = OUI declare.
    Si les deux JSON ont ZERO question avec un champ 'hint' :
      Reference=global | Type=FIELD_MISSING | JSON1=aucun champ 'hint' | JSON2=aucun champ 'hint'
      JSONF: ??? (correction de hasComb requise — verifiez si les questions d'association sont presentes dans le PDF)
      Mismatch Note: hasComb declare OUI mais aucun champ 'hint' extrait par les deux modeles. Verifiez si les questions d'association sont presentes dans le PDF ou corrigez hasComb en NON.`
    : "(hasComb=NON — pas de verification necessaire.)"}

  → Si toutes les verifications ETAPE 0 passent : ne rien ajouter au tableau. Passer a ETAPE 1.
  → Si une verification echoue : ajouter la ligne globale au tableau AVANT toutes les autres.

ETAPE 1 — COMPTAGE
  Compare le nombre d'objets dans JSON1.questions et JSON2.questions.
  Si different entre eux ou different de ${expectedRows} : signale ROW_COUNT (BLOQUANT).
  Si ROW_COUNT est signale, verifie immediatement s'il existe ensuite un decalage de numerotation ou un glissement de plage.

ETAPE 2 — COMPARAISON QUESTION PAR QUESTION
  Pour chaque question (en te basant sur le champ "num") :
    Compare les champs : text | a | b | c | d | e | f | g | correct | hint | cas
    → Si identiques ou cosmetiquement equivalents : OK, ne rien signaler.
    → Si divergents : une ligne dans le tableau avec le code adequat.

  REGLE CHAMP HINT : si le champ \`hint\` diverge entre JSON1 et JSON2, utiliser HINT_DIVERGE.
  Ne jamais utiliser PROP_DIVERGE pour le champ \`hint\`.

  CHAMPS A IGNORER : categoryId, tagSuggere, year, tag, exp (derives — jamais auditer).

ETAPE 3 — AUDIT
  Compare JSON1.audit.uncertainties et JSON2.audit.uncertainties.
  Signale AUDIT_ONLY si un riskLevel CRITICAL ou HIGH est dans un seul des deux JSON.

ETAPE 4 — CONCORDANCES
  Compte les questions 100% identiques entre les deux JSON (tous champs confondus).

══════════════════════════════════════════════════════
REGLES DE COMPARAISON
══════════════════════════════════════════════════════

REGLE 1 — DIVERGENCE = SEUL CRITERE DE SIGNALEMENT
  → Ne signale une ligne QUE si JSON1 et JSON2 different sur ce champ.
  → Si les deux JSON ont la meme valeur, ne rien signaler — meme si elle semble incorrecte.
  ✗ INTERDIT : corriger par logique medicale.
  ✗ INTERDIT : signaler une valeur partagee par les deux JSON.

REGLE 1B — PRE-FILTRE OBLIGATOIRE AVANT TOUT SIGNALEMENT
  ⚠ ETAPE OBLIGATOIRE : avant de classer une divergence, applique ce test a chaque paire de valeurs :

  NORMALISE mentalement les deux textes :
    (a) supprime tout point final de phrase
    (b) ignore la casse initiale (majuscule/minuscule en debut)
    (c) normalise les espaces multiples et les espaces avant ponctuation
    (d) remplace tout type de tiret separateur (- / – / —) par un tiret neutre si role non mathematique
    (e) ignore les variantes d'accent sur majuscules (Etat / État) et les ligatures cosmetiques
  → Si les deux textes sont IDENTIQUES apres normalisation : NE RIEN SIGNALER. Passe a la divergence suivante.
  → Si une difference reelle subsiste : classer dans la taxonomie.

  EXEMPLE CONCRET : JSON1 = "La migration par creation d'un pseudopode" /
                    JSON2 = "La migration par creation d'un pseudopode."
  → apres suppression du point final les deux textes sont identiques → NE PAS SIGNALER (PROP_DIVERGE interdit ici).

  EXEMPLE CONCRET : JSON1 = "adherence neutrophile [-] matrice" / JSON2 = "adherence neutrophile [–] matrice"
  → le tiret joue un role separateur sans valeur clinique → NE PAS SIGNALER (SYMBOL interdit ici).

  Si le sens reste strictement identique apres cette normalisation, ne rien signaler.

REGLE 2 — JSONF
  SECTION A (textuelles) :
    → Si un des deux JSON est evidemment correct sans ambiguite et sans logique medicale (ex: β vs b) → JSONF = valeur correcte, INLINE.
    → Si les deux sont plausibles → JSONF = meilleure valeur proposee selon les regles de la taxonomie, ou ??? si impossible de choisir. BLOQUANT.
  SECTION B (structurelles) :
    → JSONF = meilleure reconstruction proposee selon les regles de la taxonomie, ou ??? si indecidable — la verification humaine valide ou corrige apres consultation du PDF.

REGLE 2B — DIVERGENCES SERIEUSES UNIQUEMENT
  Tu dois privilegier :
  - ROW_COUNT / glissement de numerotation
  - QCM_SHIFT / PROP_ORDER / PROP_SWAP / PROP_TRUNCATED
  - CAS_DIVERGE avec valeurs cliniques
  - DIGIT quand la valeur change reellement
  - CT_DIVERGE / CT_DRIFT / SWAP_DIVERGE
  - AUDIT_ONLY HIGH/CRITICAL sur correct, cas ou structure
  Tu dois supprimer du rapport :
  - les espaces avant deux-points ou points d'interrogation
  - les accents purement cosmetiques
  - la ponctuation finale seule
  - toute micro-difference non medicale qui n'augmente pas la securite de verification

REGLE 3 — CHOISIR LE BON CODE POUR LES DIVERGENCES DE PROPOSITIONS

  PROP_DIVERGE   : texte completement different dans le meme champ (contenu incompatible).
  PROP_TRUNCATED : meme contenu mais l'un des deux est coupe en cours de phrase.
  PROP_SWAP      : exactement deux propositions avec le meme texte mais positions echangees.
  PROP_ORDER     : meme texte mais ordre global different (plus de 2 props, ou non consecutives).
  QCM_SHIFT      : text + 3 propositions ou plus divergent toutes → regrouper en une seule ligne.

  ARBRE DE DECISION :
  1. Le champ .text ET plusieurs propositions divergent toutes ? → QCM_SHIFT (une seule ligne [Num].QCM)
  1B. Si 2–3 propositions ont un contenu legerement different, aucune n'est tronquee, et le champ .text n'est pas decale ?
      → Appliquer le pre-filtre REGLE 1B sur chaque champ individuellement. Supprimer les micro-differences.
        Ne signaler que les champs dont la difference survit a la normalisation (PROP_DIVERGE par champ).
  2. Exactement deux propositions consecutives echangees (meme texte, champs inverses) ? → PROP_SWAP ([Num].[champ1]-[champ2])
  3. Meme texte, positions multiples ou non consecutives ? → PROP_ORDER ([Num].props)
  4. Proposition identique mais tronquee dans un JSON ? → PROP_TRUNCATED ([Num].[champ])
  5. Texte completement different sur un seul champ ? → PROP_DIVERGE ([Num].[champ])

REGLE 4 — GROUPEMENT QCM_SHIFT : QUAND REGROUPER
  Si une question a son .text divergent ET au moins 3 propositions divergentes → UNE SEULE LIGNE.
  Reference = [Num].QCM
  JSONF = reconstruction ligne par ligne, champ par champ, en proposant la meilleure valeur ou ??? :
    Text: [valeur du JSON dont l'enonce correspond le mieux a la zone PDF, ou ??? si les deux semblent decales]
    A: [valeur la plus coherente entre JSON1/JSON2, ou ??? si les deux divergent egalement]
    B: [idem]
    ...
  Mismatch Note = concatenation de toutes les raisons : "Decalage enonce + propositions decalees + champs manquants"
  ⚠ NE PAS emettre de lignes separees pour chaque champ quand QCM_SHIFT est utilise.

REGLE 4B — COURT-CIRCUIT STRUCTUREL
  Si ROW_COUNT est present ET qu'un decalage de plage est detecte :
  - signale le bloc structurel principal en priorite
  - utilise QCM_SHIFT ou une ligne structurelle groupee pour la zone affectee
  - n'emets pas de cascades de lignes cosmetiques dans cette zone
  - n'emets pas de micro-divergences sur les questions dont l'alignement est devenu incertain
  Objectif : une zone mal alignee doit produire peu de lignes, mais tres informatives.

REGLE 5 — PROP_SWAP : FORMAT OBLIGATOIRE
  Reference = [Num].[champ1]-[champ2]  ex: 7.d-e
  JSON1 : [champ1]='texte complet D dans JSON1' / [champ2]='texte complet E dans JSON1'
  JSON2 : [champ1]='texte complet D dans JSON2' / [champ2]='texte complet E dans JSON2'
  JSONF : [champ1]=[valeur proposee ou ???] / [champ2]=[valeur proposee ou ???]
  ⚠ NE PAS emettre deux lignes PROP_DIVERGE separees quand PROP_SWAP est detecte.

REGLE 6 — PROP_ORDER : FORMAT OBLIGATOIRE DE JSON1 ET JSON2
  JSON1 : a="8 premiers mots..." b="8 premiers mots..." c="..." d="..." e="..."
  JSON2 : a="8 premiers mots..." b="8 premiers mots..." c="..." d="..." e="..."
  Cela permet a la verification humaine de voir immediatement quel champ est echange.

REGLE 7 — SPELL : MISE EN EVIDENCE PAR CROCHETS
  Pour toute divergence de type SPELL, entourer le mot divergent de [] dans JSON1, JSON2 ET JSONF.
  JSON1  : phrase avec [mot_incorrect] entre crochets
  JSON2  : phrase avec [mot_correct] entre crochets
  JSONF  : phrase avec [mot_correct] entre crochets
  ⚠ Ne mettre entre crochets QUE le(s) mot(s) qui divergent, pas toute la phrase.

REGLE 8 — PRIORISATION DU RAPPORT
  Trie les lignes dans cet ordre :
  1. BLOQUANTS structurels (ROW_COUNT, QCM_SHIFT, FIELD_MISSING, PROP_TRUNCATED, PROP_ORDER, PROP_SWAP)
  2. BLOQUANTS de correction / valeurs cliniques (CT_DIVERGE, CT_DRIFT, CAS_DIVERGE, DIGIT serieux, AUDIT_ONLY promu BLOQUANT)
  3. INLINE a forte valeur uniquement
  Si les BLOQUANTS structurels existent, les micro-lignes cosmetiques restantes doivent etre supprimees.
  AUDIT_ONLY en mode INLINE : inclure en tier 3 uniquement si le champ impacte a une valeur clinique directe (chiffre, symbole, unite). Supprimer du rapport si le champ est purement textuel sans valeur clinique. Ne jamais laisser un AUDIT_ONLY INLINE gonfler le rapport sans valeur ajoutee pour la verification humaine.

══════════════════════════════════════════════════════
FORMAT DE SORTIE — UN SEUL BLOC \`\`\`text\`\`\`
══════════════════════════════════════════════════════

IMPORTANT :
- Tu dois retourner exactement un unique bloc \`\`\`text\`\`\` et rien d'autre.
- REVIEW REPORT, le tableau, le resume final et les instructions doivent tous etre dans ce meme bloc \`\`\`text\`\`\`.
- Si tu sors une partie du rapport hors du bloc, la reponse est invalide.
- La reponse est INVALIDE si le rapport est domine par des differences typographiques alors que des divergences structurelles, de valeurs cliniques ou de champ "correct" existent.

Ligne 1 exacte : REVIEW REPORT
Ligne 2 exacte : ---

Puis le tableau des divergences dans l'ordre des questions.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TABLEAU DES DIVERGENCES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Reference<TAB>Type<TAB>JSON1<TAB>JSON2<TAB>JSONF<TAB>Mismatch Note

COLONNES :
- Reference        : [Num].[champ]  ex: 7.b  12.correct  7.d-e (PROP_SWAP)  19.QCM (QCM_SHIFT)  25.props (PROP_ORDER)  global (ROW_COUNT)
- Type             : code exact de la taxonomie — peut contenir plusieurs codes separes par " | " si la ligne est groupee (ex: QCM_SHIFT | FIELD_MISSING)
                     Codes disponibles : SPELL | DIGIT | SYMBOL | UNIT | ACRONYM | PREFIX_NUM | PREFIX_PROP
                                         PROP_DIVERGE | PROP_TRUNCATED | PROP_SWAP | PROP_ORDER | QCM_SHIFT
                                         CT_DIVERGE | CT_DRIFT | CT_SPACING | HINT_DIVERGE | SWAP_DIVERGE
                                         CAS_DIVERGE | ROW_COUNT | FIELD_MISSING | AUDIT_ONLY
- JSON1            : valeur dans JSON1 pour ce champ. Pour QCM_SHIFT : reconstruction complete (Text / A / B / C / D / E). Pour SPELL : mot divergent entre [crochets].
- JSON2            : valeur dans JSON2 pour ce champ. Pour QCM_SHIFT : reconstruction complete. Pour SPELL : mot divergent entre [crochets].
- JSONF            : valeur correcte si INLINE | meilleure valeur proposee par le Modele 3 si BLOQUANT | ??? si le Modele 3 ne peut pas choisir.
                     Pour QCM_SHIFT : reconstruction ligne par ligne avec la meilleure valeur proposee ou ??? sur chaque champ divergent.
                     Pour SPELL : phrase complete avec le mot corrige entre [crochets].
                     Pour PROP_SWAP : [champ1]=??? / [champ2]=???
- Mismatch Note    : 1-2 phrases expliquant la nature du desaccord entre JSON1 et JSON2. Pour QCM_SHIFT : liste toutes les raisons separees par " + ".

REGLE CRITIQUE JSONF POUR PROP_DIVERGE / PROP_TRUNCATED / PROP_SWAP / PROP_ORDER / QCM_SHIFT / CT_DIVERGE / CT_DRIFT :
→ JSONF contient la meilleure valeur proposee par le Modele 3, ou ??? si indecidable.
→ Le verificateur humain valide le JSONF propose ou le remplace par la valeur correcte du PDF.
→ Une fois le rapport complete, JSONF devient la source de verite finale pour ces types.

Termine par :
---
VALIDATION STATE
TOTAL DIVERGENCES       : [nombre total]
QUESTIONS CONCORDANTES  : [nombre de questions identiques sur tous les champs]
QUESTIONS DIVERGENTES   : [nombre de questions avec au moins une divergence]
BLOQUANTS               : [nombre de lignes BLOQUANT]
JSONF PROPOSES          : [nombre de lignes BLOQUANT ou le Modele 3 a propose une valeur dans JSONF au lieu de ???]
VERIFICATIONS METADATA  : [CONFORME si ETAPE 0 passe sans anomalie / ANOMALIE + nombre de lignes globales ajoutees sinon]
ETAT FINALISATION       : [PRET POUR FINALISATION si aucun ??? ne reste dans JSONF / BLOQUE - ??? RESTANTS sinon]
CONTRAT TOUR SUIVANT MODELE
Si ce REVIEW REPORT te revient dans la meme conversation avec au moins un ??? restant dans JSONF, ou un JSONF vide sur une ligne BLOQUANT, retourne exactement un unique bloc \`\`\`text\`\`\` et rien d'autre selon ce modele :
\`\`\`text
VALIDATION FAILED
Raison              : REVIEW REPORT incomplet
Blocage             : JSONF contient encore des ??? ou une ligne BLOQUANT sans valeur finale
Action attendue     : finaliser toutes les valeurs JSONF avant de redemander le JSON final
\`\`\`
Si ce REVIEW REPORT te revient dans la meme conversation avec toutes les lignes BLOQUANT finalisees dans JSONF (aucun ??? restant), ignore JSON1 et JSON2 comme sources de verite finales, applique JSONF strictement, puis retourne exactement un seul bloc de code \`\`\`text\`\`\` et rien d'autre. Dans cet unique bloc, mets d'abord le resume de validation ci-dessous, puis une ligne exacte "JSON FINAL :", puis le tableau JSON final des questions. N'enveloppe jamais ce tableau dans un objet. N'ajoute aucun texte hors de cet unique bloc de code.
MODELE EXACT DE L'UNIQUE BLOC \`\`\`text\`\`\` FINAL :
\`\`\`text
VALIDATION PASSED
Module              : [module confirme]
Nombre de questions : [attendu] attendu / [detecte apres corrections]
Corrige Type        : [compatible / probleme / non applicable]
Cas cliniques       : [compatible / probleme / non applicable]
Questions d'association : [compatible / probleme / non applicable]
Images / schemas    : [compatible / probleme / non applicable]
Marqueurs residuels : aucun
Corrections appliquees : [nombre]
Divergences resolues : [nombre]
Conclusion          : JSON final valide
JSON FINAL :
[
  { "num": 1, "text": "...", "a": "...", "b": "...", "correct": "..." }
]
\`\`\`
FORMAT OBLIGATOIRE DU RETOUR FINAL : La reponse finale est invalide si elle ne contient pas exactement cet unique bloc \`\`\`text\`\`\`, si ce bloc ne commence pas exactement par "VALIDATION PASSED", si la ligne "JSON FINAL :" est absente, si le tableau JSON final n'est pas un tableau JSON pur, si tu utilises un objet racine comme {"questions":[...]}, ou si tu ajoutes du texte hors du bloc de code.

══════════════════════════════════════════════════════
FILTRE QUALITE FINAL — RELECTURE OBLIGATOIRE DU RAPPORT
══════════════════════════════════════════════════════
Avant de soumettre le rapport, relis chaque ligne du tableau et applique ce test :

  Q1 : Cette divergence necessite-t-elle qu'un humain ouvre le PDF pour trancher ?
       → Si NON → SUPPRIMER cette ligne du rapport.

  Q2 : Apres normalisation (REGLE 1B), la difference disparait-elle entierement ?
       → Si OUI → SUPPRIMER cette ligne du rapport.

  Q3 : S'agit-il d'une PROP_DIVERGE dont la seule difference visible est un point final, une casse initiale ou un espace cosmetique ?
       → Si OUI → SUPPRIMER cette ligne. C'est un SILENT FIX, pas une divergence.

  Q4 : S'agit-il d'un SYMBOL dont la seule difference est un type de tiret non clinique (separateur de phrase) ?
       → Si OUI → SUPPRIMER cette ligne. C'est un SILENT FIX, pas une divergence.

STANDARD PROFESSIONNEL : un rapport de qualite contient UNIQUEMENT des lignes qui bloquent la verification humaine.
Moins de lignes mais plus importantes = meilleur rapport.
Un rapport domine par des micro-differences cosmetiques est invalide selon REGLE 8.

⛔ INTERDICTIONS ABSOLUES
- JAMAIS de TSV. JAMAIS de VALIDATION PASSED/FAILED.
- JAMAIS de correction par logique medicale.
- JAMAIS de signalement d'une valeur partagee par les deux JSON.
- JAMAIS de texte libre en dehors du bloc \`\`\`text\`\`\`.
- Ta reponse se termine apres CONTRAT TOUR SUIVANT MODELE.

══════════════════════════════════════════════════════
AUTO-VERIFICATION DU RAPPORT AVANT SOUMISSION
══════════════════════════════════════════════════════
Avant de soumettre ton rapport, verifie ces points :
1. Chaque ligne BLOQUANT a un JSONF non vide : soit une valeur proposee, soit ???.
   Aucune ligne BLOQUANT ne laisse JSONF vide. "[SUGGESTION: ...]" est interdit dans JSONF.
2. Chaque ligne BLOQUANT a une Mismatch Note non vide (1-2 phrases expliquant la divergence).
3. Les lignes INLINE ont un JSONF directement rempli (valeur correcte, pas ???).
4. Le pied du rapport contient la section VALIDATION STATE avec les 7 lignes : TOTAL DIVERGENCES, QUESTIONS CONCORDANTES, QUESTIONS DIVERGENTES, BLOQUANTS, JSONF PROPOSES, VERIFICATIONS METADATA, ETAT FINALISATION.
5. ETAT FINALISATION vaut "PRET POUR FINALISATION" seulement s'il ne reste aucun ??? dans JSONF, sinon "BLOQUE - ??? RESTANTS".
6. VERIFICATIONS METADATA reflete correctement le resultat de l'ETAPE 0.
7. JSONF PROPOSES compte exactement le nombre de lignes BLOQUANT ou le Modele 3 a propose une valeur (non ???) dans JSONF.
Si un point echoue, corrige avant de retourner le rapport.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the comparison report prompt (Step 1).
 * Send to a third neutral model — no PDF needed.
 * @param {object} data  - exam metadata
 * @param {string} json1 - JSON string from model 1
 * @param {string} json2 - JSON string from model 2
 * @returns {string}
 */
function generateDoubleCheckPrompt(data, json1, json2) {
  return buildDoubleCheckPrompt(data || {}, json1 || "", json2 || "");
}

// ─── Exports ──────────────────────────────────────────────────────────────────
if (typeof module !== "undefined") {
  module.exports = { generateDoubleCheckPrompt };
}
if (typeof window !== "undefined") {
  window.generateDoubleCheckPrompt = generateDoubleCheckPrompt;
}
