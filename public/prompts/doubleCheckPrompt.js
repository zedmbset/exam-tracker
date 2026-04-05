function buildDoubleCheckPrompt(data, tsvData) {
  const lang = data.lang || "Francais";
  const moduleName = data.module || "-";
  const wilaya = data.wilaya || "-";
  const year = data.year || "-";
  const nQst = data.nQst || "?";
  const missingPos = Array.isArray(data.missingPos) ? data.missingPos : [];
  const schemaQsts = Array.isArray(data.schemaQsts) ? data.schemaQsts : [];
  const expectedRows = typeof nQst === "number" ? nQst - missingPos.length : "?";
  const missingSummary = missingPos.length > 0 ? missingPos.join(", ") : "aucune";
  const schemaSummary = schemaQsts.length > 0 ? schemaQsts.join(", ") : "aucune";

  return `Tu es le second modele auditeur pour un projet de numerisation d'examens medicaux algeriens.

Tu recois :
1. le PDF original
2. le TSV du premier modele

MISSION
- verifier le TSV contre le PDF
- auditer explicitement chaque marqueur [INCERTAIN: ...]
- si tous les passages [INCERTAIN] sont confirmes et qu'il n'y a aucun autre blocage, retourner un bloc final combine contenant d'abord les items de validation PASSED puis le TSV final nettoye
- si au moins un passage [INCERTAIN] est dispute, retourner uniquement un tableau de revue des passages disputes, sans TSV
- verifier aussi les questions d'association, y compris le mapping des propositions et la colonne Hint

CONTEXTE
- Langue : ${lang}
- Module : ${moduleName}
- Wilaya : ${wilaya}
- Annee : ${year}
- Nombre total de QCMs declares : ${nQst}
- Nombre de lignes attendues : ${expectedRows}
- Corrige type present : ${data.hasCT ? "OUI" : "NON"}
- Cas cliniques presents : ${data.hasCas ? "OUI" : "NON"}
- Questions d'association presentes : ${data.hasComb ? "OUI" : "NON"}
- Questions declarees manquantes : ${missingSummary}
- Questions avec schema/image : ${schemaSummary}

TSV A VERIFIER
${tsvData}

REGLE SPECIALE POUR [INCERTAIN]
- chaque [INCERTAIN: ...] contient la suggestion du premier modele
- si tu confirmes la suggestion, retire simplement le marqueur et garde le texte propre dans le TSV final
- si tu n'es pas d'accord avec une suggestion, ou si le doute reste reel, ce passage est bloque
- un seul passage [INCERTAIN] dispute suffit pour interdire tout TSV final
- quand le contenu est confirme, normalise aussi la qualite de forme du TSV final : majuscule initiale evidente, ponctuation propre, suppression des petites fautes de casse non significatives

REGLE SPECIALE POUR LES QUESTIONS D'ASSOCIATION
- detecte si les propositions sources sont en format numerique (1, 2, 3...) ou alphabetique minuscule (a, b, c...)
- verifie que le premier modele a correctement mappe ces propositions vers les colonnes majuscules A, B, C, D...
- verifie que la colonne Hint traduit correctement les combinaisons source vers les lettres majuscules mappees
- ne confonds jamais les propositions en lettres minuscules (a, b, c...) avec les options de reponse en majuscules (A, B, C, D, E)
- si le mapping d'une question d'association est faux ou ambigu, c'est bloquant et tu ne dois retourner aucun TSV final

CAS 1 - TOUT EST CONFIRME
- retourne uniquement un seul bloc \`\`\`text ... \`\`\`
- la premiere ligne doit etre exactement : VALIDATION PASSED
- ajoute ensuite obligatoirement les items de validation suivants, chacun sur sa propre ligne :
  Module : [confirme]
  Nombre de questions : [attendu vs detecte]
  Corrige Type : [compatible / non applicable / probleme]
  Cas cliniques : [compatible / non applicable / probleme]
  Questions d'association : [compatible / non applicable / probleme]
  Images / schemas : [compatible / non applicable / probleme]
  Passages [INCERTAIN] : [tous confirmes et nettoyes]
  Conclusion audit : [tableau final valide pour construction du CSV]
- ajoute ensuite une ligne separatrice exacte : ----- FINAL TSV -----
- colle ensuite le TSV final complet
- le TSV doit etre propre, sans aucun marqueur [INCERTAIN]
- le TSV final doit etre harmonise et professionnel : majuscule initiale corrigee quand necessaire, petites incoherences de casse nettoyees, sans changer le sens medical
- aucun deuxieme bloc
- aucun texte libre avant VALIDATION PASSED
- aucun texte libre apres la derniere ligne du TSV

CAS 2 - AU MOINS UN [INCERTAIN] EST DISPUTE
- retourne uniquement un seul bloc \`\`\`text ... \`\`\`
- la premiere ligne doit etre exactement : VALIDATION FAILED
- aucune sortie TSV
- aucune version partielle
- un passage dispute = une ligne
- le tableau de revue doit contenir exactement ces colonnes :
  Reference | Marker from first TSV | Lecture PDF retenue | Verdict second modele
- la colonne Reference doit etre au format : ["No. X"] | Text
  ou : ["No. X"] | A
  ou : ["No. X"] | B
  etc.
- la colonne Marker from first TSV doit contenir le marqueur exact, ex: [INCERTAIN: hybride]

CAS 3 - AUTRE BLOCAGE HORS [INCERTAIN]
- retourne uniquement un seul bloc \`\`\`text ... \`\`\`
- la premiere ligne doit etre exactement : VALIDATION FAILED
- ne fournis aucun TSV

INTERDICTION
- ne jamais retourner a la fois un tableau de revue et un TSV
- ne jamais retourner un TSV si un [INCERTAIN] est dispute
- ne jamais retourner de deuxieme bloc
- ne jamais inserer \\n inutilement dans le TSV final
- dans le TSV final, garde une cellule sur une seule ligne sauf si plusieurs parties reelles du texte imposent un \\n`;
}

function generateDoubleCheckPromptFromContext(data, tsvData) {
  return buildDoubleCheckPrompt(data, tsvData);
}

function generateDoubleCheckPrompt(arg1, arg2) {
  if (typeof arg2 === "string") {
    return buildDoubleCheckPrompt(arg1 || {}, arg2);
  }
  return buildDoubleCheckPrompt({}, arg1 || "");
}
