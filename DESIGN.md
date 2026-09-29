# Pantry design

Pantry uses familiar storage locations and readable stock rows. The working
inventory is the focus: item names, quantities, dates and actions take priority
over branding or decoration.

## Visual contract

- Forest green `#183e31` is used for app navigation and primary controls.
- Warm canvas `#f2eadb` and cream `#fbf6eb` keep the inventory readable.
- Tomato `#ad402b` identifies stock and date issues. The plain yellow shopping
  panel uses `#f0db8c`, with no simulated binding, torn edge, rotation or signature.
- Manrope is the working UI typeface. Source Serif is reserved for the small
  Pantry wordmark and page title. Both fonts are served locally.
- Body and control text is generally 14–16px; supporting text is 12px.
  Use direct, sentence-case labels. Avoid slogans and decorative counters.
- Ingredient thumbnails help identify records without competing with names,
  amounts and actions. Unknown names use a generic jar.

## Inventory and shopping

Inventory appears in this order: Fridge, Cupboard, Freezer, Counter. Locations
with no matching items are omitted. Search and filters apply before grouping;
within each location, past dates, upcoming dates and low stock appear first.
Location counts reflect the visible records, while the overview and shopping
list continue to reflect all inventory.

The desktop layout uses a single dense column of stock rows next to the
shopping list. Each row shows a small ingredient image, name, date, current
quantity, restock target and both stock actions. On narrower screens, actions
move below the item details; on phones the shopping list follows inventory.
The interface preserves touch targets, visible focus and reduced-motion support.

Dialogs use normal labelled forms and direct errors. The stock dialog repeats
the selected ingredient and current quantity. Empty and error states give a
clear next action. With JavaScript disabled, the separate no-script stylesheet
hides inert controls and presents an explanation and reload link without
exposing or duplicating raw inventory records.

## Ingredient atlas

`/assets/pantry-ingredients.webp` is a 1254 × 1254 atlas with nine equal cells.
CSS overscans at `background-size: 340% 340%` to trim neighboring cell slivers.
Positions are 2.778%, 50%, 97.222% on each axis. Thumbnail backgrounds match
the sampled atlas paper, `#fdf6e9`, without a blend effect.

| Row | Left | Centre | Right |
|---|---|---|---|
| 1 | Oats | Yogurt | Chickpeas |
| 2 | Lemons | Rice | Spinach |
| 3 | Olive oil | Peas | Generic pantry jar |

`ingredientArt()` matches familiar names to these decorative previews. Images
are hidden from assistive technology; the adjacent text is authoritative.

## Data and evidence boundaries

The presentation preserves the raw collection, declared rules and shapes,
ETag mutation contract, conflict recovery and local/public sample disclosures.
Eight focused jsdom checks pass, including grouping and filtering by storage
location and keyboard focus preservation across refreshes. Focus returns to
the same enabled item action; unavailable actions fall back to Search without
overriding focus the user moved during the request. Browser accessibility and
visual reviews are recorded separately.
Local checks do not establish Pagelove authorization or schema enforcement.
