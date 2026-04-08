// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — Review report prompt
// Call this first. The model returns a structured issue report, no TSV.
// ─────────────────────────────────────────────────────────────────────────────
function buildDoubleCheckStep1Prompt(data, tsvData) {
  const lang         = data.lang        || "Francais";
  const moduleName   = data.module      || "-";
  const wilaya       = data.wilaya      || "-";
  const year         = data.year        || "-";
  const level        = data.level       || "-";
  const period       = data.period      || "-";
  const rotation     = data.rotation    || "-";
  const nQst         = data.nQst        || "?";
  const missingPos   = Array.isArray(data.missingPos)  ? data.missingPos  : [];
  const schemaQsts   = Array.isArray(data.schemaQsts)  ? data.schemaQsts  : [];
  const subcategories = Array.isArray(data.subcategories) ? data.subcategories : [];
  const expectedRows = typeof nQst === "number" ? nQst - missingPos.length : "?";
  const missingSummary = missingPos.length > 0  ? missingPos.join(", ")  : "aucune";
  const schemaSummary  = schemaQsts.length > 0  ? schemaQsts.join(", ")  : "aucune";
  const subcategoryNote = subcategories.length > 0
    ? subcategories.map(sc => `${sc.name}: questions ${sc.range}`).join(", ")
    : "aucune";
  const levelValue = String(level || "").trim();
  const moduleValue = String(moduleName || "").trim().toLowerCase();
  const isResidanat = levelValue === "7" || moduleValue === "résidanat";
  const examType = isResidanat ? "Résidanat" : "Externat";
  const twoColNote     = data.isTwoColumn
    ? "OUI — verifier l'ordre inter-colonnes explicitement"
    : "NON";

  return `Tu es le second modele auditeur pour un projet de numerisation d'examens medicaux algeriens.

Tu recois :
1. le PDF original de l'examen
2. le TSV produit par le premier modele

Ta mission dans cette etape est de produire UNIQUEMENT un rapport de revue structure et compact.
Tu ne dois produire AUCUN TSV final dans cette etape.
Tu ne dois pas emettre de verdict VALIDATION PASSED ou VALIDATION FAILED dans cette etape.

═══════════════════════════════════════════
CONTEXTE DE L'EXAMEN
═══════════════════════════════════════════
- Langue              : ${lang}
- Module              : ${moduleName}
- Wilaya              : ${wilaya}
- Annee               : ${year}
- Nombre de QCMs declares  : ${nQst}
- Nombre de lignes attendues : ${expectedRows}
- Corrige Type present : ${data.hasCT ? "OUI" : "NON"}
- Cas cliniques presents : ${data.hasCas ? "OUI" : "NON"}
- Questions d'association : ${data.hasComb ? "OUI" : "NON"}
- Questions declarees manquantes : ${missingSummary}
- Questions avec schema/image : ${schemaSummary}
- Examen deux colonnes : ${twoColNote}

TSV A AUDITER
${tsvData}

═══════════════════════════════════════════
COMPORTEMENT GENERAL — SILENT FIX VS REPORT
═══════════════════════════════════════════
Tu as trois modes d'action possibles pour chaque probleme detecte :

SILENT FIX (ne pas lister dans le rapport)
- Problemes purement cosmetiques dont tu es certain a 100% :
  casse initiale, espace double, coupure de mot PDF evidente.
- Ces corrections seront appliquees silencieusement en etape 2.
- N'encombre pas le rapport avec eux.

DECISION INLINE (lister dans le rapport avec ta decision deja remplie)
- Marqueurs [INCERTAIN] que tu peux resoudre avec certitude en comparant au PDF.
- Marqueurs [SWAP] que tu peux confirmer ou infirmer avec certitude.
- Erreurs detectees (symbole, chiffre, proposition) dont la correction est evidente depuis le PDF.
- Pour ces cas : remplis toi-meme la colonne "Decision membre" avec ta correction. Le membre n'a qu'a valider ou modifier.

BLOQUANT (lister dans le rapport, decision membre obligatoire)
- Tout ce que tu ne peux pas resoudre seul avec certitude depuis le PDF.
- Toute suspicion de swap confirme, proposition deplacee, decalage CT.
- Tout [INCERTAIN] pour lequel deux reconstructions sont egalement plausibles.
- Ces lignes ont la colonne "Decision membre" vide. Le membre DOIT remplir.

═══════════════════════════════════════════
FAMILLES D'ERREURS A SURVEILLER EN PRIORITE
═══════════════════════════════════════════
Ces familles d'erreurs sont les plus frequentes et les plus dangereuses. Verifie-les systematiquement.

1. PROPOSITIONS DEPLACEES OU REMPLACEES
   - Verifie que le texte de chaque proposition (A, B, C, D, E) correspond exactement au PDF.
   - Verifie qu'aucune proposition n'a ete deplacee d'une colonne vers une autre.
   - Verifie qu'aucune proposition n'a ete reformulee, tronquee ou inventee.
   - Si une proposition du TSV ne correspond pas visuellement a la meme position dans le PDF : BLOQUANT.

2. DRIFT SYMBOLES ET CHIFFRES
   - Verifie chaque symbole grec : α, β, γ, μ, etc. — un remplacement par une lettre latine est une erreur silencieuse grave.
   - Verifie chaque valeur numerique : 84 ≠ 85, 0.5 ≠ 5, 120 ≠ 12.
   - Verifie chaque unite : mg/dL, mmol/L, UI/L, bpm, mmHg.
   - Si un chiffre ou symbole du TSV differe du PDF meme d'un caractere : DECISION INLINE ou BLOQUANT selon ta certitude.

3. DRIFT DE NOTATION (ASSOCIATIONS ET COMBINAISONS)
   - Verifie que les combinaisons de reponses dans Hint sont notees exactement comme le PDF les exprime apres mapping.
   - Ex : "A et B" ne devient pas "I et II", "1 et 2" ne devient pas "A, B".
   - Si une notation de combinaison a change de forme : DECISION INLINE si tu peux corriger depuis le PDF, sinon BLOQUANT.

4. INTEGRITE DU CORRIGE TYPE (CT)
${data.hasCT
  ? `   - Verifie que chaque valeur dans la colonne Correct correspond exactement au CT du PDF.
   - Verifie qu'aucune reponse CT n'a ete deplacee vers une autre question (decalage).
   - Verifie qu'aucune reponse CT n'a ete deduite ou corrigee par logique medicale.
   - Si une reponse CT est absente du TSV alors qu'elle est visible dans le PDF : BLOQUANT.
   - Si le CT semble decale (ex : reponse de Q5 assignee a Q6) : BLOQUANT.
   INTERDICTIONS ABSOLUES POUR TOI AUSSI :
   - Ne jamais proposer de corriger le CT par logique medicale.
   - Ne jamais deplacer une reponse CT d'une question vers une autre.
   - Ne jamais reecrire les lettres CT parce que l'ordre des options te semble incorrect.
   - Si le placement d'une reponse CT est douteux, reporter comme BLOQUANT pour decision membre.`
  : `   - Aucun CT present. Verifie que la colonne Correct est entierement vide dans le TSV.
   - Si une cellule Correct est renseignee, signale-la comme BLOQUANT.`
}

5. MARQUEURS [INCERTAIN] RESTANTS
   - Chaque [INCERTAIN: ...] du TSV doit etre traite.
   - Compare la suggestion du premier modele au PDF original.
   - Si tu confirmes ou corriges avec certitude : DECISION INLINE (remplis ta correction).
   - Si le doute reste entier : remplace par [REVIEW: raison] et classe BLOQUANT.

6. MARQUEURS [SWAP] RESTANTS
   - Chaque [SWAP: ...] du TSV doit etre traite.
   - Relis l'ordre visuel des options dans le PDF.
   - Si tu confirmes le swap : BLOQUANT, propose l'ordre correct dans "Correction proposee".
   - Si tu infirmes le swap : DECISION INLINE, confirme que l'ordre imprime est standard.

7. COMPTAGE ET NUMEROTATION
   - Verifie que le nombre de lignes TSV (hors en-tete) = ${expectedRows}.
   - Verifie qu'aucune question n'est dupliquee ou fusionnee.
   - Verifie que les tags ["No. X"] correspondent aux numeros originaux du PDF.
   - Verifie que les questions declarees manquantes (${missingSummary}) sont bien absentes du TSV.

8. QUESTIONS D'ASSOCIATION
${data.hasComb
  ? `   - Verifie le format des marqueurs source (numerique ou alphabetique minuscule).
   - Verifie que le mapping vers les colonnes majuscules A, B, C, D... est correct et complet.
   - Verifie que la colonne Hint traduit correctement les combinaisons source vers les majuscules.
   - Ne confonds jamais les propositions source en minuscules (a, b, c) avec les colonnes (A, B, C, D, E).`
  : `   - Aucune question d'association declaree. Signale si tu en detectes une dans le TSV.`
}

9. CAS CLINIQUES
${data.hasCas
  ? `   - Verifie que le texte du cas clinique est correctement copie dans la colonne Cas.
   - Verifie que toutes les questions partageant un cas ont bien la colonne Cas renseignee avec le meme texte.
   - Verifie qu'aucune question independante n'a un cas invente.`
  : `   - Aucun cas clinique declare. Signale si la colonne Cas est renseignee pour une question.`
}

10. IMAGES ET SCHEMAS
${schemaQsts.length > 0
  ? `   - Verifie que les questions ${schemaSummary} ont bien la colonne Image renseignee.
   - Verifie que le nom du fichier image suit le format attendu.`
  : `   - Aucune image declaree. Signale si la colonne Image est renseignee pour une question.`
}

${data.isTwoColumn ? `
11. LECTURE DEUX COLONNES
   - Verifie que l'ordre des questions respecte la lecture colonne-gauche-puis-colonne-droite.
   - Verifie qu'aucune question de la colonne droite n'a ete interposee entre deux questions de la colonne gauche.
   - Verifie qu'aucun cas clinique initie dans la colonne gauche n'a ete coupe avant d'etre rattache aux questions de la colonne droite.
   - Si une anomalie d'ordre inter-colonnes est detectee : BLOQUANT.
` : ""}

═══════════════════════════════════════════
FORMAT DU RAPPORT DE REVUE
═══════════════════════════════════════════
Retourne un seul bloc \`\`\`text ... \`\`\` contenant :

Ligne 1 exacte : REVIEW REPORT
Ligne 2 exacte : ---

Puis le tableau de revue avec ces colonnes exactes separees par des pipes :
  N° | Reference | Colonne | Trouve dans TSV | Correction proposee | Severite | Decision membre

Details des colonnes :
- N°                  : numero sequentiel du probleme (1, 2, 3...)
- Reference           : tag de la question concernee, ex : ["No. 3"] ou ["No. 24"]
- Colonne             : nom de la colonne concernee (Text, Correct, A, B, C, D, E, Cas, Hint, Image)
- Trouve dans TSV     : contenu exact de la cellule telle qu'elle apparait dans le TSV (avec marqueur si present)
- Correction proposee : ta proposition de texte corrige, propre, sans marqueur — ou vide si tu ne peux pas decider
- Severite            : BLOQUANT ou DECISION INLINE ou SILENT FIX
- Decision membre     : 
    * Si SILENT FIX : "AUTO" (le membre ne lira meme pas cette ligne)
    * Si DECISION INLINE : ta correction deja remplie — le membre valide ou modifie
    * Si BLOQUANT : laisser vide — le membre DOIT remplir

REGLES DE CONCISION DU RAPPORT :
- N'inclus pas les SILENT FIX dans le tableau sauf si tu veux attirer l'attention du membre.
- Une ligne par probleme. Pas de prose. Pas d'explication longue.
- La colonne "Correction proposee" doit etre courte : le texte corrige uniquement, pas de justification.

Si aucun probleme n'est detecte, ecris une seule ligne apres "---" :
  Aucun probleme detecte. Pret pour etape 2.

Termine le rapport par ces lignes exactes :
  ---
  TOTAL BLOQUANTS : [nombre]
  TOTAL DECISIONS INLINE : [nombre]
  INSTRUCTION MEMBRE : Verifiez et completez la colonne "Decision membre" pour chaque ligne BLOQUANT. Validez ou modifiez les DECISION INLINE. Renvoyez ce rapport complet pour l'etape 2.

INTERDICTIONS DANS CETTE ETAPE
- Aucun TSV dans cette reponse.
- Aucun verdict VALIDATION PASSED ou VALIDATION FAILED.
- Aucun texte libre en dehors du bloc.
- Aucune prose explicative avant ou apres le bloc.`;
}


// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Final TSV prompt
// Call this after the member has filled in their decisions in the review report.
// Pass the original data, the original TSV, and the completed review report.
// ─────────────────────────────────────────────────────────────────────────────
function buildDoubleCheckStep2Prompt(data, tsvData, reviewReport) {
  const lang         = data.lang        || "Francais";
  const moduleName   = data.module      || "-";
  const wilaya       = data.wilaya      || "-";
  const year         = data.year        || "-";
  const level        = data.level       || "-";
  const period       = data.period      || "-";
  const rotation     = data.rotation    || "-";
  const nQst         = data.nQst        || "?";
  const missingPos   = Array.isArray(data.missingPos)  ? data.missingPos  : [];
  const schemaQsts   = Array.isArray(data.schemaQsts)  ? data.schemaQsts  : [];
  const subcategories = Array.isArray(data.subcategories) ? data.subcategories : [];
  const expectedRows = typeof nQst === "number" ? nQst - missingPos.length : "?";
  const missingSummary = missingPos.length > 0  ? missingPos.join(", ")  : "aucune";
  const schemaSummary  = schemaQsts.length > 0  ? schemaQsts.join(", ")  : "aucune";
  const subcategoryNote = subcategories.length > 0
    ? subcategories.map(sc => `${sc.name}: questions ${sc.range}`).join(", ")
    : "aucune";
  const levelValue = String(level || "").trim();
  const moduleValue = String(moduleName || "").trim().toLowerCase();
  const isResidanat = levelValue === "7" || moduleValue === "résidanat";
  const examType = isResidanat ? "Résidanat" : "Externat";

  return `Tu es le second modele auditeur pour un projet de numerisation d'examens medicaux algeriens.

Tu recois dans cette etape :
1. le PDF original de l'examen
2. le TSV du premier modele (ci-dessous)
3. le rapport de revue de l'etape 1, complete avec les decisions du membre (ci-dessous)

Ta mission est d'appliquer toutes les corrections approuvees et de produire le TSV final propre,
sans aucun marqueur [INCERTAIN], [SWAP] ou [REVIEW].

═══════════════════════════════════════════
CONTEXTE DE L'EXAMEN
═══════════════════════════════════════════
- Langue              : ${lang}
- Module              : ${moduleName}
- Wilaya              : ${wilaya}
- Annee               : ${year}
- Nombre de QCMs declares  : ${nQst}
- Nombre de lignes attendues : ${expectedRows}
- Corrige Type present : ${data.hasCT ? "OUI" : "NON"}
- Cas cliniques presents : ${data.hasCas ? "OUI" : "NON"}
- Questions d'association : ${data.hasComb ? "OUI" : "NON"}
- Questions declarees manquantes : ${missingSummary}
- Questions avec schema/image : ${schemaSummary}

TSV DU PREMIER MODELE
${tsvData}

RAPPORT DE REVUE AVEC DECISIONS DU MEMBRE
${reviewReport}

═══════════════════════════════════════════
REGLES D'APPLICATION DES CORRECTIONS
═══════════════════════════════════════════
1. Lis chaque ligne du rapport de revue.

2. Pour chaque ligne BLOQUANT :
   - Si Decision membre = texte de remplacement fourni : applique exactement ce texte dans le TSV final.
   - Si Decision membre = "confirmer" ou similaire : applique la Correction proposee du rapport.
   - Si Decision membre = "rejeter" ou similaire : garde le texte original du premier TSV, sans marqueur.
   - Si Decision membre est vide : ARRETE et retourne VALIDATION FAILED avec reference de la ligne bloquante.

3. Pour chaque ligne DECISION INLINE :
   - Si Decision membre est vide ou "valider" : applique la Correction proposee du rapport.
   - Si Decision membre contient un texte different : applique le texte du membre, pas la correction proposee.

4. Pour chaque ligne SILENT FIX (AUTO) : applique la correction proposee sans la signaler.

5. Supprime tous les marqueurs [INCERTAIN: ...], [SWAP: ...] et [REVIEW: ...] du TSV final.
   - Si un marqueur [INCERTAIN], [SWAP] ou [REVIEW] subsiste sans decision dans le rapport : VALIDATION FAILED.

6. Ne modifie aucune cellule qui n'est pas listee dans le rapport, sauf les SILENT FIX cosmetiques.

7. Apres application de toutes les corrections, verifie une derniere fois :
   - Aucun marqueur [INCERTAIN], [SWAP] ou [REVIEW] ne subsiste.
   - Le nombre de lignes = ${expectedRows}.
   - Aucune cellule Correct ne contient une deduction medicale.
   - Le TSV est propre, professionnel, sans \\n inutile.

INTERDICTIONS ABSOLUES POUR LE TSV FINAL
- Ne jamais inventer une correction non approuvee par le membre.
- Ne jamais modifier une cellule qui n'est pas listee dans le rapport.
- Ne jamais utiliser tes connaissances medicales pour corriger une reponse CT.
- Ne jamais deplacer une reponse CT d'une question vers une autre.
- Ne jamais reformuler un texte meme s'il te semble maladroit, sauf si le membre l'a explicitement demande.
- Ne jamais deplacer ou reordonner les propositions A, B, C, D, E.

═══════════════════════════════════════════
CAS 1 — TOUT EST RESOLU : VALIDATION PASSED
═══════════════════════════════════════════
Si toutes les lignes BLOQUANT ont une decision membre valide et que le TSV final est propre :

Retourne un seul bloc \`\`\`text ... \`\`\` contenant exactement :

VALIDATION PASSED
Module              : ${moduleName} [confirme]
Nombre de questions : ${expectedRows} attendu / [X detecte apres corrections]
Corrige Type        : ${data.hasCT ? "[compatible / probleme — preciser]" : "non applicable"}
Cas cliniques       : ${data.hasCas ? "[compatible / probleme — preciser]" : "non applicable"}
Questions d'association : ${data.hasComb ? "[compatible / probleme — preciser]" : "non applicable"}
Images / schemas    : ${schemaQsts.length > 0 ? "[compatible / probleme — preciser]" : "non applicable"}
Marqueurs residuels : aucun
Corrections appliquees : [nombre total de corrections appliquees]
Conclusion audit    : tableau final valide pour construction du CSV
----- FINAL TSV -----
[TSV final complet, propre, sans aucun marqueur]

Regles de format du TSV final :
- Propre et professionnel : majuscule initiale corrigee quand necessaire, ponctuation propre.
- Aucun marqueur [INCERTAIN], [SWAP] ou [REVIEW].
- Une cellule = une ligne sauf si plusieurs parties reelles du contenu imposent un \\n.
- Aucun texte libre avant VALIDATION PASSED ni apres la derniere ligne du TSV.
- Un seul bloc.

═══════════════════════════════════════════
CAS 2 — BLOCAGE RESIDUEL : VALIDATION FAILED
═══════════════════════════════════════════
Si au moins une ligne BLOQUANT n'a pas de decision membre valide, ou si un marqueur subsiste
sans resolution, ou si une inconsistance irresolvable est detectee :

Retourne un seul bloc \`\`\`text ... \`\`\` contenant exactement :

VALIDATION FAILED
Raison : [description precise du blocage residuel]
References bloquantes : [liste des N° de problemes non resolus du rapport]
Action requise : Completer les decisions manquantes et relancer l'etape 2.

- Aucun TSV dans ce cas.
- Aucune version partielle.
- Aucun texte libre en dehors du bloc.`;
}


// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate the Step 1 prompt (review report, no TSV).
 * @param {object} data    - exam metadata
 * @param {string} tsvData - TSV string from the first model
 * @returns {string}
 */
function generateDoubleCheckStep1Prompt(data, tsvData) {
  return buildDoubleCheckStep1Prompt(data || {}, tsvData || "");
}

/**
 * Generate the Step 2 prompt (final TSV after member decisions).
 * @param {object} data          - exam metadata (same object as step 1)
 * @param {string} tsvData       - original TSV from the first model (re-injected for full context)
 * @param {string} reviewReport  - the completed review report with member decisions filled in
 * @returns {string}
 */
function generateDoubleCheckStep2Prompt(data, tsvData, reviewReport) {
  return buildDoubleCheckStep2Prompt(data || {}, tsvData || "", reviewReport || "");
}

// ─── Legacy compatibility shims ───────────────────────────────────────────────
// These preserve backward compatibility if existing app code still calls the
// old function names. They route to Step 1 by default.
// Remove these once the app has been updated to use the two-step API above.

function buildDoubleCheckPrompt(data, tsvData) {
  return buildDoubleCheckStep1Prompt(data, tsvData);
}

function generateDoubleCheckPromptFromContext(data, tsvData) {
  return buildDoubleCheckStep1Prompt(data || {}, tsvData || "");
}

function generateDoubleCheckPrompt(arg1, arg2) {
  if (typeof arg2 === "string") {
    return buildDoubleCheckStep1Prompt(arg1 || {}, arg2);
  }
  return buildDoubleCheckStep1Prompt({}, arg1 || "");
}
