# Subcategory UI Implementation Guide

This guide provides complete instructions for adding subcategory UI to `public/exam.html`.

## What Needs To Be Done

1. Add subcategory input section to Step 1 form
2. Implement JavaScript functions for managing subcategories
3. Show/hide subcategory section based on module type
4. Save subcategories to `Tags.subcategories` in JSON format

## 1. HTML Form Section

Add this HTML section after the "Has Association / Combination questions" checkbox (around line 1250):

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

## 2. JavaScript Functions

Add these functions to the script section (after `getExamContext()` function):

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

## 3. Update `parseTags()` Function

Update the `parseTags()` function to include subcategories:

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

## 4. Update `saveStep1()` Function

Update `saveStep1()` to save subcategories:

```javascript
// In saveStep1(), when building the tags object:
const tags = {
  nQst: parseInt(document.getElementById("tags_nQst")?.value || "0"),
  lang: document.getElementById("tags_lang")?.value || "Francais",
  missingPos: parseAnnotations(document.getElementById("tags_annotations").value || "").missingPos,
  schemaQsts: parseAnnotations(document.getElementById("tags_annotations").value || "").schemaQsts,
  hasCT: document.getElementById("tags_hasCT")?.checked || false,
  hasCas: document.getElementById("tags_hasCas")?.checked || false,
  hasComb: document.getElementById("tags_hasComb")?.checked || false,
  subcategories: JSON.stringify(subcategories)  // NEW: Save subcategories
};

// Then update the Tags column with this JSON
```

## 5. Update `buildStep1()` Function

Add initialization call in `buildStep1()`:

```javascript
// In buildStep1(), after rendering the form:
initSubcategories();
```

## 6. Update `loadExam()` Function

Add initialization call in `loadExam()`:

```javascript
// In loadExam(), after loading the exam data:
initSubcategories();
```

## Testing Checklist

After implementing these changes:

1. ✅ Open exam detail page for a normal module (e.g., Dermatologie)
   - Verify subcategory section is hidden

2. ✅ Open exam detail page for Unit 1-5
   - Verify subcategory section is visible
   - Click "+ Add Subcategory" button
   - Verify new row appears with name and range inputs
   - Fill in name and range
   - Verify inputs save correctly

3. ✅ Test removing subcategories
   - Click ✕ button on a subcategory row
   - Verify row is removed

4. ✅ Test saving
   - Add multiple subcategories
   - Click "Save" button
   - Verify subcategories are saved to Tags column
   - Refresh page
   - Verify subcategories persist

5. ✅ Test with Résidanat
   - Open a Résidanat exam
   - Verify subcategory section is visible
   - Add subcategories
   - Save and verify persistence

## Data Format

Subcategories are stored as JSON in the Tags column:

```json
{
  "nQst": 30,
  "lang": "Francais",
  "missingPos": [5, 12],
  "schemaQsts": [3, 7, 10],
  "hasCT": true,
  "hasCas": false,
  "hasComb": false,
  "subcategories": [
    {
      "name": "Anatomie",
      "range": "1-20"
    },
    {
      "name": "Biochimie",
      "range": "21-40"
    }
  ]
}
```

Each subcategory object contains:
- `name`: string - Subcategory name (e.g., "Anatomie", "Biochimie")
- `range`: string - Question range (e.g., "1-20", "21-40")
