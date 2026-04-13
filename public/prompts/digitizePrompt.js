// ─────────────────────────────────────────────────────────────────────────────
//  digitizePrompt.js  —  Modele 1 : extraction + audit JSON
//  Export : generateDigitizePrompt
//  Changement majeur : sortie JSON enrichi (questions + audit) au lieu de TSV brut.
//  Le bloc "audit" fournit au second modele tous les marqueurs d'incertitude et
//  les nettoyages effectues, chacun avec un score de risque chiffre.
// ─────────────────────────────────────────────────────────────────────────────

function generateDigitizePrompt(data) {
  const moduleName  = data.module  || "[Preciser l'unite]";
  const year        = String(data.year   || "").trim();
  const yearShort   = year ? year.slice(-2) : "XX";
  const period      = String(data.period || "").replace(/\s+/g, "");
  const imagePrefix = `${moduleName}_${yearShort}${period || String(data.rotation || "").trim()}`;

  const levelValue  = String(data.level  || "").trim();
  const moduleValue = String(data.module || "").trim().toLowerCase();
  const isResidanat = levelValue === "7" || moduleValue === "résidanat";
  const examType    = isResidanat ? "Résidanat" : "Externat";

  const subcategoryNote = data.subcategories && data.subcategories.length > 0
    ? `- Sous-categories et leurs plages de questions :\n${data.subcategories.map(sc => `    * ${sc.name}: questions ${sc.range}`).join('\n')}`
    : "- Aucune sous-categorie definie.";
  const composedSubmoduleNote = data.isComposedExam && data.composedSubmodules && data.composedSubmodules.length > 0
    ? `- Examen compose : assigne le champ "categoryId" selon ces sous-modules fixes et leurs plages de questions :\n${data.composedSubmodules.map(item => `    * ${item.name} -> ${item.categoryId} : questions ${item.range}`).join('\n')}`
    : `- categoryId par question : utilise le categoryId unique de l'examen (${data.categoryId || "[categoryId manquant]"}).`;

  const missingNote = Array.isArray(data.missingPos) && data.missingPos.length > 0
    ? `- Questions declarees manquantes : ${data.missingPos.join(", ")}.`
    : "- Aucune question declaree manquante.";

  const schemaNote = Array.isArray(data.schemaQsts) && data.schemaQsts.length > 0
    ? `- Questions avec schema/image declarees : ${data.schemaQsts.join(", ")}.`
    : "- Aucune question avec schema/image declaree.";

  const twoColumnWarning = data.isTwoColumn
    ? `- CET EXAMEN EST EN DEUX COLONNES. Lis colonne gauche en entier de haut en bas, puis colonne droite en entier de haut en bas. Ne melange jamais les lignes des deux colonnes. Ne saute pas d'une colonne a l'autre en cours de lecture.`
    : `- Format de page : colonne unique, lecture de haut en bas.`;

  const tagTemplate = isResidanat
    ? `["${examType} ${data.wilaya || '[Wilaya]'}", "<tagSuggere> ${year}", "No. <num>", "${data.hasCT ? 'Corrigé type' : 'Corrigé proposé'}"]`
    : `["${examType} ${data.wilaya || '[Wilaya]'}", "${period ? period + ' ' : ''}${year}", "No. <num>", "${data.hasCT ? 'Corrigé type' : 'Corrigé proposé'}"]`;

  return `Tu es un assistant specialise en extraction d'examens medicaux.
Ta mission est double :
  1. Extraire fidelement tout le contenu de l'examen source avec une rigueur absolue.
  2. Produire un objet JSON enrichi, directement exploitable par le second modele auditeur.

La sortie JSON contient DEUX blocs de premier niveau :
  "questions" → tableau structure de toutes les questions (equivalent enrichi du TSV precedent).
  "audit"     → rapport complet des incertitudes et nettoyages effectues, avec scores de risque.

Ce JSON est le seul livrable. Il remplace entierement le TSV brut precedent.

══════════════════════════════════════════════════════
CONTEXTE DE L'EXAMEN
══════════════════════════════════════════════════════
- Langue            : ${data.lang || "Francais"}
- Unite             : ${moduleName}
- Annee             : ${year}
- Niveau            : ${data.level || "[Preciser le niveau]"}
${period ? `- Periode           : ${period}` : ""}
${data.rotation ? `- Rotation          : ${data.rotation}` : ""}
- Type d'examen     : ${examType}
- Nombre total QCMs : ${data.nQst || "[Preciser le nombre]"}
- Corrige Type (CT) : ${data.hasCT ? "OUI — present dans ce PDF" : "NON — absent"}
- Cas Cliniques     : ${data.hasCas ? "OUI" : "NON"}
- Questions assoc.  : ${data.hasComb ? "OUI" : "NON"}
${subcategoryNote}
${composedSubmoduleNote}
${missingNote}
${schemaNote}
${twoColumnWarning}

══════════════════════════════════════════════════════
⛔ VERIFICATION PREALABLE — OBLIGATOIRE AVANT TOUTE EXTRACTION
══════════════════════════════════════════════════════
Avant de toucher la moindre question, execute ces 5 verifications dans l'ordre.
Si une verification CRITICAL echoue → genere UNIQUEMENT le bloc d'erreur ci-dessous et ARRETE.
N'extrais aucune question, ne produis aucun tableau "questions".

CHECK 1 — COMPTAGE DES QUESTIONS
  Balaye le PDF en entier. Releve tous les numeros de questions presentes.
  nQst declare : ${data.nQst || "?"}
  Positions manquantes declarees : ${Array.isArray(data.missingPos) && data.missingPos.length > 0 ? data.missingPos.join(", ") : "aucune"}
  Objets attendus apres exclusion des manquantes : ${(Number(data.nQst) || 0) - (Array.isArray(data.missingPos) ? data.missingPos.length : 0)}
  Regle de tolerance (stricte) :
    - L'ecart entre le nombre de questions trouvees dans le PDF et le nQst declare doit etre explique
      EXACTEMENT par les positions manquantes declarees. Aucune tolerance supplementaire.
    - Si le nombre de questions trouvees differe du nombre declare d'une quantite non justifiee
      par les positions manquantes → CRITICAL.

CHECK 2 — CORRIGE TYPE
  Balaye les dernieres pages du PDF pour trouver une section CT (en-tete "Corrige Type", tableau de reponses, grille de bulles).
  ${data.hasCT ? "hasCT=OUI declare. Si AUCUN CT trouve → CRITICAL." : "hasCT=NON declare. Si un CT est clairement present → CRITICAL (risque d'hallucination de reponses)."}

CHECK 3 — CAS CLINIQUES
  Balaye le PDF pour trouver un cas clinique (paragraphe introductif partage par un groupe de questions).
  ${data.hasCas ? "hasCas=OUI declare. Si aucun cas clinique detecte → WARNING." : "hasCas=NON declare. Si un cas clinique est present → WARNING."}

CHECK 4 — QUESTIONS D'ASSOCIATION
  Balaye le PDF pour trouver des questions avec items numerotes + tableau de combinaisons.
  ${data.hasComb ? "hasComb=OUI declare. Si aucune question d'association detectee → WARNING." : "(Pas de verification necessaire — hasComb=NON.)"}

CHECK 5 — POSITIONS MANQUANTES
  ${Array.isArray(data.missingPos) && data.missingPos.length > 0
    ? `Positions declarees manquantes : ${data.missingPos.join(", ")}. Si une de ces questions apparait dans le PDF → WARNING (le membre a peut-etre saisi les mauvaises positions manquantes).`
    : "Aucune position manquante declaree — pas de verification necessaire."}

DECISION APRES VERIFICATIONS :
  → Si au moins un CHECK CRITICAL echoue : output UNIQUEMENT le bloc d'erreur JSON ci-dessous — pas de questions.
  → Si uniquement des WARNINGS : log dans audit.summary.warnings, puis poursuis l'extraction normalement.
  → Si tout passe : poursuis l'extraction normalement.

FORMAT DU BLOC D'ERREUR (sortie exclusive si CRITICAL) :
Un seul bloc \`\`\`json ... \`\`\` contenant cet objet — RIEN D'AUTRE :
{
  "error": "METADATA_MISMATCH",
  "checks": [
    {
      "field": "<nQst | hasCT | hasCas | hasComb | missingPos>",
      "declared": <valeur declaree>,
      "detected": <valeur detectee dans le PDF>,
      "severity": "CRITICAL",
      "message": "<description claire de l'ecart en francais, avec instruction de correction pour l'utilisateur>"
    }
  ],
  "instruction": "Corrigez les informations de l'examen (Etape 1) puis relancez la numerisation."
}
  → Liste uniquement les verifications CRITICAL dans le tableau "checks".
  → Ne jamais inclure un tableau "questions" aux cotes du bloc d'erreur.
  → Ne jamais continuer l'extraction si au moins un CRITICAL est signale.

FORMAT DES WARNINGS (si aucun CRITICAL) :
  Ajoute un tableau "warnings" dans audit.summary :
  "warnings": [
    {
      "field": "<hasCas | hasComb | isTwoColumn | missingPos>",
      "declared": <valeur declaree>,
      "detected": <valeur detectee dans le PDF>,
      "message": "<description courte de l'ecart>"
    }
  ]
  Si aucun warning : omets le tableau "warnings" de audit.summary.

══════════════════════════════════════════════════════
REGLES DE FIDELITE AU DOCUMENT
══════════════════════════════════════════════════════
La fidelite au contenu medical prime toujours sur la normalisation cosmetique.

Tu es autorise a corriger UNIQUEMENT :
  - la casse initiale d'une phrase ou d'une proposition (minuscule → majuscule en debut)
  - les espaces doubles ou manquants autour de la ponctuation
  - les coupures de mot dues a un mauvais rendu PDF (ex : "hyper- tension" → "hypertension")
  - les erreurs de lecture OCR evidentes qui ne modifient pas le sens medical
    (ex : "vore" → "voie", "classes on" → "classes en", "comne" → "comme", "l'infarctus" mal coupé → reconstitué)
    Critere d'application : la correction doit etre linguistiquement certaine ET medicalement neutre.
    En cas de doute sur le sens medical → ne corrige pas, documente dans audit.uncertainties.

Tu n'es PAS autorise a :
  - reformuler, simplifier ou reordonner le texte d'une question ou d'une proposition
  - corriger une faute d'orthographe medicale si tu n'es pas certain a 100 % qu'il s'agit d'une coquille
  - changer le sens d'une phrase meme si elle te semble maladroite
  - reordonner les options A, B, C, D, E selon une logique medicale
  - deduire ou deviner la reponse correcte depuis tes connaissances medicales

L'ordre visuel imprime dans le PDF est la seule reference valide. Toujours.

NETTOYAGE DU BRUIT VISUEL :
Ignore et supprime tout texte qui ne fait pas partie de la question ou des propositions.
Cela inclut sans s'y limiter :
  - les numeros de page (ex : "— 3 —", "Page 4/8")
  - les noms d'auteurs, codes d'examen ou references en en-tete/pied de page
  - les marqueurs de lecture automatique (petits carres noirs, codes QR, codes-barres)
  - les annotations manuscrites d'etudiants (coches, croix, notes de brouillon)
  - les noms de fichier ou chemins qui apparaissent en marge
Chaque suppression de bruit doit etre documentee dans audit.cleanings avec le type NOISE_REMOVED.

INTERDICTIONS ABSOLUES SUR LES PROPOSITIONS :
- Ne jamais deplacer le texte d'une proposition vers une autre colonne.
- Ne jamais reordonner les options selon ta logique medicale.
- Ne jamais reassigner une proposition parce que son contenu ressemble a une autre question.
- Si l'ordre visuel semble suspect : utilise [SWAP: ordre visuel suspect X-Y-Z] dans "correct"
  et preserve l'ordre visuel imprime tel quel.

VIGILANCE SYMBOLES, CHIFFRES ET NOTATIONS :
- Copie chaque symbole exactement : α, β, γ, μ, ±, ≥, ≤, →, ↑, ↓.
  Ne jamais remplacer un symbole grec par une lettre latine (α ≠ a, β ≠ b).
- Copie chaque chiffre exactement. Ne jamais arrondir ni corriger.
- Copie chaque unite exactement : mg/dL, mmol/L, UI/L, bpm, mmHg.
- Si un chiffre, symbole ou unite est partiellement illisible → place ta reconstruction dans le champ et declare-la dans audit.uncertainties.
- Ne jamais corriger un chiffre qui te semble biologiquement improbable.

══════════════════════════════════════════════════════
MARQUEURS D'INCERTITUDE
══════════════════════════════════════════════════════
INCERTITUDES DE LECTURE (SANS MARQUEUR TEXTUEL)
  → Pour tout mot, symbole, chiffre, formule ou expression difficile a lire avec certitude.
  → N'insere JAMAIS de balise d'incertitude entre crochets dans le texte d'un champ.
  → Ecris ta meilleure reconstruction medicalement plausible DIRECTEMENT dans le champ JSON (ex: "120 mg/dL", "hypertension").
  → Documente OBLIGATOIREMENT cette incertitude dans le bloc "audit.uncertainties" avec un riskScore.
  → Si une question est entierement illisible et irrecuperable : saute-la sans creer d'objet.

[SWAP: raison_breve]
  → Ordre visuel des options suspecte dans le PDF.
  → Place dans le champ "correct" (ou "hint" si correct absent, ou fin de "text" sinon).
  → Preserve l'ordre visuel imprime et signale le doute.
  → Exemple : [SWAP: ordre visuel suspect D-A-C-B-E]

Le marqueur [SWAP] et tes textes reconstruits (incertitudes) doivent alimenter le bloc "audit.uncertainties".
Chaque doute de lecture que tu as eu DOIT avoir une entree correspondante dans "audit.uncertainties".

INTERDICTIONS SUR LES MARQUEURS ET INCERTITUDES :
- Aucune balise d'incertitude entre crochets dans les valeurs textuelles.
- Pas de liste des incertitudes en dehors du bloc audit JSON.
- Pas de commentaire prose sur tes doutes.
- Pas de [SWAP] en dehors de "correct", "hint" ou fin de "text".

══════════════════════════════════════════════════════
FORMAT DE SORTIE — OBJET JSON UNIQUE
══════════════════════════════════════════════════════
Produis UNIQUEMENT un bloc \`\`\`json ... \`\`\` contenant l'objet decrit ci-dessous.
Aucun texte, titre, commentaire ni rapport en dehors du bloc JSON.
Un seul bloc. Pas de deuxieme bloc.
EXCEPTION : si une verification prealable CRITICAL a echoue, la sortie est le bloc d'erreur JSON decrit dans la section VERIFICATION PREALABLE — pas de tableau "questions", pas de bloc "audit".

──────────────────────────────────────────────────────
STRUCTURE DE "questions"  (tableau d'objets)
──────────────────────────────────────────────────────
Chaque objet represente une question. Inclus uniquement les champs non-null
SAUF pour les champs obligatoires (num, text, categoryId, year, tag).
Omets un champ si sa valeur est null ET qu'il n'est pas obligatoire.

Schema d'un objet question :
{
  "cas"             : "texte integral du cas clinique partage, ou omis si absent",
  "num"             : <entier — numero original du PDF>,
  "text"            : "texte pur de la question sans numero ni propositions",
  "a"               : "texte proposition A sans son prefixe lettre",
  "b"               : "texte proposition B sans son prefixe lettre",
  "c"               : "texte proposition C sans son prefixe lettre",
  "d"               : "texte proposition D sans son prefixe lettre",
  "e"               : "texte proposition E sans son prefixe lettre",
  "f"               : "texte proposition F — utilise quand la question comporte 6 propositions ou plus (quel que soit le type de question)",
  "g"               : "texte proposition G — utilise quand la question comporte 7 propositions (quel que soit le type de question)",
  "correct"         : "lettres CT sans separateur ex: 'ACD', ou [SWAP:...] si suspect, ou omis si absent",
  "exp"             : "Based on official course support (official pdf course) the right answer is \\"<correct>\\" please generate explanation based on those right answers (propositions) — ou omis si correct absent",
  "hint"            : "combinaisons d'association traduites en lettres A-G — ou omis",
  "categoryId"      : "${data.categoryId || "[categoryId manquant]"}",
  "tagSuggere"      : "nom de la sous-categorie si examen mappe, sinon omis",
  "year"            : "${year}",
  "tag"             : ${tagTemplate}
}

Regles specifiques par champ :
- "num"      : numero original du PDF. Ne jamais renumeroter.
- "text"     : texte pur. Supprime tout prefixe de question ("1.", "Q1.", "1)", etc.).
               Si se termine par ":" avant les propositions : conserve ce ":".
- "correct"  : ${data.hasCT
    ? `CT uniquement — jamais de deduction medicale personnelle.
               Copie les lettres exactement telles qu'elles apparaissent dans le CT, meme ordre.
               Plusieurs reponses : lettres sans separateur ex: "ACD".
               Si CT absent/illisible pour cette question : omets le champ.
               Si decalage CT suspect : omets le champ "correct" pour les questions affectees. Documente dans audit.uncertainties avec type "SWAP", riskLevel "CRITICAL", description "Decalage CT suspecte — position N".`
    : `Omis pour toutes les questions — jamais remplir depuis tes connaissances medicales.`}
- "exp"      : derive de "correct". Omis si "correct" est absent.
               Template intentionnellement en anglais — ne pas traduire.
               Remplace <correct> par la valeur exacte du champ "correct".
- "hint"     : uniquement pour questions d'association. Traduis CHAQUE combinaison du tableau en lettres A-G en utilisant la correspondance item→lettre, puis joins toutes les combinaisons avec ", ".
               Exemple : tableau A(1,2,3,4) B(1,2,3,4,5) C(1,2,3,5) D(1,3,4,5) E(2,3,4,5) → hint = "ABCD, ABCDE, ABCE, ACDE, BCDE".
               Ne jamais stocker les lettres de combinaison (A, B, C, D, E) seules — toujours traduire les items numerotes.
- "categoryId" : obligatoire pour chaque question.
               ${data.isComposedExam
                 ? 'Examen compose — attribue le categoryId exact du sous-module dont la plage contient le numero de question.'
                 : 'Examen simple — utilise le meme categoryId unique pour toutes les questions.'}
- "tag"      : tableau de 4 elements. Remplace <num> par la valeur du champ "num".
               ${isResidanat
                 ? 'Pour Résidanat : remplace <tagSuggere> par la valeur reelle de "tagSuggere".'
                 : 'Pour Externat : utilise periode et annee fournies dans le contexte.'}
- "f", "g"   : omis si la question comporte 5 propositions ou moins.
- "hint"     : omis si aucune question d'association dans l'examen.
- "tagSuggere" : omis si examen non mappe (pas de subcategories definies).

${data.hasComb ? `
══════════════════════════════════════════════════════
QUESTIONS D'ASSOCIATION — REGLES SPECIFIQUES
══════════════════════════════════════════════════════
Une question d'association contient deux parties :
  1. Un corps de question ("text") suivi de N enonces numerotes (1 a 7 maximum).
  2. Un tableau de combinaisons en bas : A(…) B(…) C(…) D(…) E(…).
     Chaque combinaison liste les numeros des enonces inclus dans cette reponse.

CORRESPONDANCE ITEM → LETTRE (toujours dans cet ordre) :
  enonce 1 → champ "a" → lettre A
  enonce 2 → champ "b" → lettre B
  enonce 3 → champ "c" → lettre C
  enonce 4 → champ "d" → lettre D
  enonce 5 → champ "e" → lettre E
  enonce 6 → champ "f" → lettre F  (seulement si 6 enonces ou plus)
  enonce 7 → champ "g" → lettre G  (seulement si 7 enonces)

CHAMP "hint" — tableau de combinaisons traduit :
  Traduis CHAQUE combinaison du tableau en remplacant les numeros par les lettres
  correspondantes (A=1, B=2, C=3, D=4, E=5, F=6, G=7).
  Joins toutes les combinaisons converties avec ", ".
  Exemple :
    Tableau PDF : A(1,2,3,4)  B(1,2,3,4,5)  C(1,2,3,5)  D(1,3,4,5)  E(2,3,4,5)
    → hint = "ABCD, ABCDE, ABCE, ACDE, BCDE"
  ⚠ Ne stocke JAMAIS les lettres de combinaison (A, B, C, D, E) seules dans "hint".
    Toujours traduire les numeros d'items.

CHAMP "correct" — combinaison correcte traduite en propositions :
  Ne stocke PAS la lettre de la combinaison marquee dans le CT (ex: "D").
  Traduis les numeros d'items de cette combinaison en lettres de propositions.
  Exemple : CT marque D, D=(1,3,4,5) → correct = "ACDE" (items 1→A, 3→C, 4→D, 5→E).

EXEMPLE JSON COMPLET D'UNE QUESTION D'ASSOCIATION :
{
  "num": 14,
  "text": "La toxicologie environnementale s'interesse a :",
  "a": "Le devenir des contaminants chimiques dans l'environnement ;",
  "b": "Les interactions entre les contaminants biologiques dans l'environnement ;",
  "c": "Les interactions entre les contaminants chimiques dans l'environnement ;",
  "d": "Les effets sur la biodiversite ;",
  "e": "Les perturbations des ecosystemes.",
  "hint": "ABCD, ABCDE, ABCE, ACDE, BCDE",
  "correct": "ACDE"
}

AUTO-VERIFICATION ASSOCIATION :
  → Chaque question d'association doit avoir un champ "hint" non vide.
  → Le champ "hint" contient uniquement des lettres A-G et des virgules/espaces.
  → Le champ "correct" contient uniquement des lettres A-G sans separateur.
  → Le nombre de lettres dans "correct" correspond au nombre d'items de la combinaison marquee.
` : ""}

${data.isTwoColumn ? `
EXAMEN DEUX COLONNES — REGLES STRICTES
- Lis integralement la colonne gauche du haut vers le bas AVANT de commencer la colonne droite.
- Ne melange jamais une ligne de la colonne gauche avec une ligne de la colonne droite.
- Si une question semble continuer d'une colonne vers l'autre : ecris ta meilleure reconstruction dans "text" et documente dans audit.uncertainties avec riskLevel "HIGH", description "Continuite inter-colonnes incertaine — zone de jonction entre colonnes".
- Si l'ordre numerique est incohérent avec la lecture visuelle : conserve l'ordre visuel imprime et documente dans audit.uncertainties avec riskLevel "HIGH", description "Ordre inter-colonnes suspect — numerotation incoherente avec la position visuelle".
- Verifie que chaque question de la colonne droite ne fait pas partie d'un cas clinique initie dans la colonne gauche.
` : `
EXAMEN COLONNE UNIQUE
- Lecture strictement de haut en bas.
- Si une question est physiquement coupee par un saut de page : reconstitue-la en un seul objet.
`}
- Ne fusionne jamais deux questions distinctes dans un seul objet.
- Ne coupe jamais une question en plusieurs objets.
- Si le numero saute : verifie les questions declarees manquantes. Ne cree pas d'objet de remplacement.

──────────────────────────────────────────────────────
STRUCTURE DE "audit"  (rapport complet pour le second modele)
──────────────────────────────────────────────────────
L'objet "audit" est obligatoire meme si tout est propre (les tableaux seront alors vides).

{
  "summary": {
    "totalQuestions"    : <entier>,
    "uncertainCount"    : <entier — nombre d'incertitudes loggees>,
    "swapCount"         : <entier — nombre de marqueurs [SWAP] poses>,
    "cleaningCount"     : <entier — nombre de nettoyages effectues>,
    "criticalRiskCount" : <entier>,
    "highRiskCount"     : <entier>,
    "mediumRiskCount"   : <entier>,
    "lowRiskCount"      : <entier>,
    "warnings"          : [ /* omis si aucun warning — voir schema ci-dessous */ ]
  },
  "uncertainties" : [ /* voir schema ci-dessous */ ],
  "cleanings"     : [ /* voir schema ci-dessous */ ]
}

Schema d'un objet "warnings" (dans audit.summary.warnings) :
{
  "field"    : "<hasCas | hasComb | isTwoColumn | missingPos>",
  "declared" : <valeur declaree dans le contexte>,
  "detected" : <valeur detectee dans le PDF>,
  "message"  : "<description courte de l'ecart>"
}

━━━━ "uncertainties" — un objet par incertitude de lecture ou [SWAP] pose ━━━━

{
  "qNum"         : <entier — numero de la question>,
  "field"        : "<nom du champ JSON concerne : text | a | b | c | d | e | f | g | correct | hint>",
  "type"         : "INCERTAIN" ou "SWAP",
  "description"  : "description courte de ce qui est incertain ou suspect",
  "reconstructed": "contenu exact reconstruit dans le champ JSON",
  "riskScore"    : <entier 1-100>,
  "riskLevel"    : "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "riskReason"   : "explication courte du score : pourquoi ce niveau de risque ?"
}

Grille de riskScore pour "uncertainties" :
  CRITICAL (75-100) : chiffre medical critique (dosage, seuil, valeur biologique, unite),
                      reponse CT illisible ou decalage CT suspect, cas clinique corrompu,
                      proposition entierement illisible ou irreconstituable.
  HIGH     (50-74)  : symbole medical ambigu (α/β/μ/→/↑/↓), chiffre partiellement lisible,
                      texte de question partiellement reconstruit sur >3 mots,
                      [SWAP] d'ordre d'options suspect.
  MEDIUM   (25-49)  : mot medical incertain (coquille possible), coupure de mot reconstruite
                      sur un terme medical complexe, ponctuation ou expression ambigue.
  LOW      (1-24)   : element non medical incertain, correction cosmetique mineure.

━━━━ "cleanings" — un objet par modification autorisee effectuee ━━━━

{
  "qNum"        : <entier ou null si correction globale>,
  "field"       : "<nom du champ JSON modifie>",
  "cleaningType": "CASE_FIX" | "SPACE_FIX" | "HYPHEN_FIX" | "OCR_FIX" | "NOISE_REMOVED" | "PREFIX_REMOVED" | "SYMBOL_ENCODING_FIX" | "OTHER_AUTHORIZED",
  "before"      : "texte original tel qu'extrait du PDF avant correction",
  "after"       : "texte apres correction",
  "ruleApplied" : "citation exacte et courte de la regle du prompt qui autorise ce nettoyage",
  "riskScore"   : <entier 1-100>,
  "riskLevel"   : "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "riskReason"  : "explication si riskLevel > LOW : pourquoi cette correction pourrait etre contestee"
}

Grille de riskScore pour "cleanings" :
  CRITICAL (75-100) : correction qui modifie un chiffre, un symbole, une unite medicale,
                      ou qui change potentiellement le sens d'une phrase.
  HIGH     (50-74)  : HYPHEN_FIX ou OCR_FIX sur un terme medical complexe (risque d'erreur de reconstruction),
                      SYMBOL_ENCODING_FIX sur un caractere ambigu.
  MEDIUM   (25-49)  : CASE_FIX sur un terme potentiellement technique (sigle, acronyme, nom propre),
                      OCR_FIX sur un mot dont la correction medicale reste incertaine.
  LOW      (1-24)   : SPACE_FIX ou CASE_FIX sur du texte clairement non ambigu,
                      PREFIX_REMOVED (prefixe de question supprime — sans ambiguite),
                      NOISE_REMOVED (bruit visuel supprime — aucun impact sur le contenu medical),
                      OCR_FIX sur un mot generique sans valeur medicale.

Types de cleaningType autorises :
  CASE_FIX            → casse initiale corrigee (minuscule → majuscule en debut de phrase/proposition)
  SPACE_FIX           → espace double ou manquant autour de la ponctuation corrige
  HYPHEN_FIX          → coupure de mot due au rendu PDF reconstituee (ex: "hyper- tension" → "hypertension")
  OCR_FIX             → erreur de lecture OCR evidente corrigee sans modification du sens medical (ex: "vore" → "voie")
  NOISE_REMOVED       → texte parasite supprime (numero de page, en-tete, marqueur OCR, annotation etudiant)
  PREFIX_REMOVED      → prefixe de question supprime ("1.", "Q1.", "1)", "1-", etc.)
  SYMBOL_ENCODING_FIX → caractere corrompu PDF remplace par le symbole correct
  OTHER_AUTHORIZED    → autre correction explicitement autorisee par une regle du prompt

IMPORTANT : Ne documente PAS les remplissages de champs derives (categoryId, year, tag, exp,
tagSuggere). Ces valeurs sont des derivations du contexte, pas des nettoyages du PDF.
Ne documente PAS les absences normales de champs optionnels.

${data.hasCT ? `
══════════════════════════════════════════════════════
CORRIGE TYPE — LOCALISATION ET FORMATS
══════════════════════════════════════════════════════
Le Corrige Type (CT) apparait TOUJOURS a la FIN du PDF, apres toutes les questions.
Signaux qui identifient la section CT :
  - Un en-tete "Corrige Type", "Corrige-Type", "Correction", "Reponses" en haut de page.
  - Un tableau ou une grille listant des numeros de questions avec des lettres de reponse.
  - Une page separee (parfois intitulee "page 1/1") apres le corps de l'examen.
⚠ OBLIGATOIRE : Parcours le PDF jusqu'a la derniere page avant d'extraire les valeurs CT.
  Ne tente jamais d'extraire le CT depuis le corps de l'examen.

FORMAT A — Tableau imprime (format le plus courant, lecture directe)
  Apparence : un tableau propre avec colonnes "N°" et "Reponse" ou "Alternatives".
  Chaque ligne : numero de question | une ou plusieurs lettres capitales (A–E ou combinaisons).
  Valeurs valides : D, B, ABE, ACDE, ABCDE.
  Regle : copie les lettres exactement telles qu'imprimees, sans separateur entre plusieurs lettres.

FORMAT B — Grille a cocher / OMR (format a plus haut risque de lecture)
  Apparence : grille ou chaque question a 5 colonnes labellisees A B C D E.
  Chaque colonne contient une petite case carree.
  Case cochee/barree (✕, asterisque epais, marque pleine) = cette lettre est correcte.
  Case vide ou non marquee = cette lettre n'est PAS correcte.
  Regle : identifie chaque case marquee et enregistre la lettre correspondante.
          Joins les lettres en ordre alphabetique sans separateur.
  Exemple : A=vide, B=marque, C=vide, D=marque, E=vide → correct = "BD".
  ⚠ RISQUE ELEVE : les grilles a cocher sont frequemment mal lues par l'OCR.
    → Documente CHAQUE reponse extraite d'une grille dans audit.uncertainties
      avec riskLevel "HIGH" et description "Reponse extraite d'une grille a cocher — risque de lecture erronee".
    → Exception : si la marque est claire, non ambigue et isolee → riskLevel "MEDIUM".

COLONNES ALTERNATIVES (Format A uniquement)
  Certains tableaux CT ont deux colonnes de reponse : "Alternative 1" et "Alternative 2".
  Cela signifie que deux ensembles de reponses sont acceptes pour cette question.
  Regle : stocke TOUJOURS l'alternative avec le PLUS GRAND nombre de lettres correctes dans "correct".
  Exemples :
    Alt1 = "BD"  (2 lettres), Alt2 = "B"   (1 lettre)  → correct = "BD"
    Alt1 = "AC"  (2 lettres), Alt2 = "ACD" (3 lettres) → correct = "ACD"
  Documente l'alternative ecartee dans audit.uncertainties :
    type: "INCERTAIN", riskLevel: "MEDIUM",
    description: "CT fournit deux alternatives — Alt1=[x] Alt2=[y] — retenu: [choix]"

DETECTION DU DECALAGE CT
  Un decalage CT se produit quand les reponses sont decalees d'une question a l'autre.
  Signaux d'alerte a surveiller :
    - La derniere question de l'examen n'a pas d'entree CT, mais une reponse supplementaire apparait.
    - La reponse pour la question N dans le CT semble appartenir visuellement a la question N+1.
    - Le nombre total de reponses CT differe du nombre total de questions.
  Si un de ces signaux est detecte : omets le champ "correct" pour TOUTES les questions affectees.
  Documente chaque position concernee dans audit.uncertainties :
    type: "SWAP", riskLevel: "CRITICAL", description: "Decalage CT suspecte — position N"

LETTRES CT IMPOSSIBLES
  Si le CT contient une lettre qui n'a pas de proposition correspondante (ex: "F" pour une question
  a 5 choix, ou un chiffre au lieu d'une lettre) :
    - Ne copie PAS la valeur invalide dans "correct".
    - Omets le champ "correct" pour cette question.
    - Documente dans audit.uncertainties : riskLevel: "CRITICAL",
      description: "CT contient une lettre invalide pour cette question: [valeur]"
` : ""}

══════════════════════════════════════════════════════
AUTO-VERIFICATION AVANT SORTIE
══════════════════════════════════════════════════════
Avant d'ecrire le JSON, verifie mentalement :
0. Si une verification prealable CRITICAL a echoue, la sortie est un bloc error JSON — pas de tableau "questions". Les verifications suivantes ne s'appliquent qu'a la sortie normale.
1. Nombre d'objets dans "questions" = ${data.nQst || "?"} declares - questions manquantes declarees.
   Si different : verifie si tu as oublie une question ou fusionne deux questions.
2. Aucun champ "correct" ne contient une deduction medicale personnelle.
3. Chaque incertitude loggee contient une reconstruction plausible, pas du bruit OCR brut.
4. Chaque [SWAP] est dans "correct" (ou "hint" / fin de "text" si correct absent).
5. Chaque objet dans "audit.cleanings" reference une regle exacte du prompt dans "ruleApplied".
6. Chaque marqueur [SWAP] ou doute de lecture a une entree correspondante dans "audit.uncertainties".
7. Les riskScore sont coherents avec la grille ci-dessus.
8. "audit.summary" reflette exactement les comptages reels.
9. Aucune proposition n'a ete deplacee d'un champ vers un autre.
10. Aucun symbole, chiffre ou unite n'a ete substitue ou normalise silencieusement.
11. Chaque champ "tag" contient exactement 4 elements dans le bon ordre.
12. Chaque champ "exp" contient le template anglais exact avec la valeur "correct" interpolee.
${data.isTwoColumn ? "13. L'ordre des questions respecte la lecture colonne-gauche-puis-colonne-droite." : ""}
${data.hasComb ? "14. Chaque question d'association a un champ 'hint' non vide contenant uniquement des lettres A-G separees par virgule." : ""}
15. Aucune valeur dans aucun champ ne contient de balise d'incertitude entre crochets — toutes ces balises sont interdites dans les valeurs textuelles.

══════════════════════════════════════════════════════
SORTIE FINALE OBLIGATOIRE
══════════════════════════════════════════════════════
- Un seul bloc \`\`\`json ... \`\`\`
- Aucun texte, titre, commentaire ni rapport en dehors du bloc JSON
- CAS NORMAL (aucun CRITICAL) : l'objet JSON contient exactement deux cles de premier niveau : "questions" et "audit".
  Le second modele lira ce JSON avec le PDF pour produire son rapport de verification.
- CAS ERREUR (au moins un CRITICAL detecte) : l'objet JSON contient exactement trois cles de premier niveau : "error", "checks", "instruction".
  Aucun tableau "questions". Aucun bloc "audit".`;
}

// ─── Export ───────────────────────────────────────────────────────────────────
if (typeof module !== "undefined") module.exports = { generateDigitizePrompt };
if (typeof window !== "undefined") window.generateDigitizePrompt = generateDigitizePrompt;
