# Exam.html Subcategory UI - Complete Patch

This file contains all the code changes needed to add subcategory UI to `public/exam.html`.

## File Locations

1. **HTML Section** - Add after line 1250 (after "Has Association / Combination questions")
2. **JavaScript Functions** - Add after `getExamContext()` function (around line 1363)
3. **Update `parseTags()`** - Find and update existing function
4. **Update `saveStep1()`** - Find and update existing function
5. **Update `buildStep1()`** - Add initialization call
6. **Update `loadExam()`** - Add initialization call

---

## 1. HTML Section - Subcategory UI

**Location:** After line 1250, before `</div>` that closes the form-grid

```html
                <!-- Subcategories for Unit/Résidanat exams -->
                <div id="subcategorySection" class="form-row" style="display:none;margin-top:16px;">
                  <label style="font-weight:700;color:var(--text3);">Subcategories (Unit 1-5 or Résidanat only)</label>
                  <div style="flex:1;gap:8px;">
                    <button type="button" class="btn btn-sm" onclick="addSubcategoryRow()">+ Add Subcategory</button>
                  </div>
                  <div id="subcategoryList" style="display:flex;flex-direction:column;gap:8px;margin-top:8px;"></div>
                </div>
```

---

## 2. JavaScript Functions - Subcategory Management

**Location:** After `getExamContext()` function (around line 1363)

```javascript
      // Subcategory management
      let subcategories = [];

      // Initialize subcategories from Tags.subcategories if available
      function initSubcategories() {
        const tags = parseTags(activeRow);
        try {
          const subcatStr = tags.subcategories || "[]";
          if (subcatStr && subcatStr.trim() !== "[]") {
            subcategories = JSON.parse(subcatStr);
          }
        } catch (e) {
          console.warn("Failed to parse subcategories:", e);
          subcategories = [];
        }
        renderSubcategories();
        checkSubcategoryVisibility();
      }

      // Add a new subcategory row
      function addSubcategoryRow() {
        const id = Date.now();
        subcategories.push({ id, name: "", range: "" });
        renderSubcategories();
      }

      // Remove a subcategory row
      function removeSubcategoryRow(id) {
        subcategories = subcategories.filter(sc => sc.id !== id);
        renderSubcategories();
      }

      // Update subcategory field
      function updateSubcategory(id, field, value) {
        const subcat = subcategories.find(sc => sc.id === id);
        if (subcat) {
          subcat[field] = value;
        }
      }

      // Render all subcategories
      function renderSubcategories() {
        const container = document.getElementById("subcategoryList");
        if (!container) return;

        container.innerHTML = subcategories.map((sc, idx) => `
          <div class="subcategory-row" style="display:flex;gap:8px;align-items:center;padding:8px;background:var(--bg2);border:1px solid var(--border2);border-radius:var(--radius);">
            <input type="text" 
                   placeholder="Subcategory name (e.g., Anatomie)" 
                   value="${sc.name}" 
                   onchange="updateSubcategory(${sc.id}, 'name', this.value)"
                   style="flex:1;padding:8px;border:1px solid var(--border2);border-radius:var(--radius);font-size:13px;">
            <input type="text" 
                   placeholder="Question range (e.g., 1-20)" 
                   value="${sc.range}" 
                   onchange="updateSubcategory(${sc.id}, 'range', this.value)"
                   style="flex:1;padding:8px;border:1px solid var(--border2);border-radius:var(--radius);font-size:13px;">
            <button type="button" 
                    class="btn btn-sm" 
                    onclick="removeSubcategoryRow(${sc.id})"
                    style="color:var(--red-text);border-color:var(--red-border);">✕</button>
          </div>
        `).join('');
      }

      // Show/hide subcategory section based on module
      function checkSubcategoryVisibility() {
        const module = cell(activeRow, "Module") || "";
        const section = document.getElementById("subcategorySection");
        if (!section) return;

        // Show for Unit 1-5 or Résidanat
        const shouldShow = /^(Unit [1-5]|Résidanat)/i.test(module);
        section.style.display = shouldShow ? "block" : "none";

        // Clear subcategories if hidden
        if (!shouldShow && subcategories.length > 0) {
          subcategories = [];
          renderSubcategories();
        }
      }
```

---

## 3. Update `parseTags()` Function

**Find:** Search for `function parseTags(`

**Replace the entire function with:**

```javascript
      function parseTags(tagsStr) {
        if (!tagsStr || tagsStr.trim() === "") return {};

        try {
          const tags = JSON.parse(tagsStr);

          // Ensure subcategories exists
          if (!tags.subcategories) {
            tags.subcategories = [];
          }

          return tags;
        } catch (e) {
          console.error("Failed to parse tags:", e);
          return {
            nQst: 0,
            lang: "Francais",
            missingPos: [],
            schemaQsts: [],
            hasCT: false,
            hasCas: false,
            hasComb: false,
            subcategories: []
          };
        }
      }
```

---

## 4. Update `saveStep1()` Function

**Find:** Search for `function saveStep1()`

**Find the section where tags object is built (around line 1470-1480):**

```javascript
const tags = {
  nQst: parseInt(document.getElementById("tags_nQst")?.value || "0"),
  lang: document.getElementById("tags_lang")?.value || "Francais",
  missingPos: parseAnnotations(document.getElementById("tags_annotations").value || "").missingPos,
  schemaQsts: parseAnnotations(document.getElementById("tags_annotations").value || "").schemaQsts,
  hasCT: document.getElementById("tags_hasCT")?.checked || false,
  hasCas: document.getElementById("tags_hasCas")?.checked || false,
  hasComb: document.getElementById("tags_hasComb")?.checked || false
};
```

**Replace with:**

```javascript
const tags = {
  nQst: parseInt(document.getElementById("tags_nQst")?.value || "0"),
  lang: document.getElementById("tags_lang")?.value || "Francais",
  missingPos: parseAnnotations(document.getElementById("tags_annotations").value || "").missingPos,
  schemaQsts: parseAnnotations(document.getElementById("tags_annotations").value || "").schemaQsts,
  hasCT: document.getElementById("tags_hasCT")?.checked || false,
  hasCas: document.getElementById("tags_hasCas")?.checked || false,
  hasComb: document.getElementById("tags_hasComb")?.checked || false,
  subcategories: JSON.stringify(subcategories)
};
```

---

## 5. Update `buildStep1()` Function

**Find:** Search for `function buildStep1(`

**Find the return statement (around line 1256):**

```javascript
return stepCardWrap(0, examId, state, "Upload PDFs & fill exam data", step1Ready, body, footer);
```

**Replace with:**

```javascript
initSubcategories();
return stepCardWrap(0, examId, state, "Upload PDFs & fill exam data", step1Ready, body, footer);
```

---

## 6. Update `loadExam()` Function

**Find:** Search for `function loadExam(`

**Find the end of the function (before the closing brace):**

```javascript
      }
    });
  }
```

**Replace with:**

```javascript
      }
    });

    // Initialize subcategories
    initSubcategories();
  }
```

---

## Verification Steps

After applying all changes:

1. **Test with normal module (e.g., Dermatologie):**
   - Open exam detail page
   - Verify subcategory section is hidden

2. **Test with Unit 1-5:**
   - Open exam detail page for Unit 2
   - Verify subcategory section is visible
   - Click "+ Add Subcategory"
   - Verify new row appears
   - Fill in name and range
   - Click "Save"
   - Refresh page
   - Verify subcategories persist

3. **Test with Résidanat:**
   - Open exam detail page for Résidanat
   - Verify subcategory section is visible
   - Add multiple subcategories
   - Save and verify persistence

4. **Test removal:**
   - Add multiple subcategories
   - Click ✕ button on one
   - Verify it's removed
   - Save and verify persistence

---

## Troubleshooting

If subcategories don't appear after saving:

1. Check browser console for errors
2. Verify `initSubcategories()` is called
3. Verify `parseTags()` returns subcategories array
4. Check that `Tags` column contains valid JSON
5. Verify `subcategories` variable is properly initialized

If subcategory section doesn't show/hide:

1. Verify `checkSubcategoryVisibility()` is called
2. Check module name format (must be "Unit 1", "Unit 2", etc., or "Résidanat")
3. Verify regex pattern: `/^(Unit [1-5]|Résidanat)/i`
4. Check that `subcategorySection` element exists in DOM
