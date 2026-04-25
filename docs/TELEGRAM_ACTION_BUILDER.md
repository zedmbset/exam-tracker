# Telegram Action Builder

The Telegram page now includes a structured action builder for sheet rows.

## Goal

Instead of typing raw action strings manually in Google Sheets, the UI lets you:

- load rows from a selected sheet
- select a row to edit
- choose transfer mode and `Pub_lnk` options with structured controls
- preview the exact canonical action string before saving
- create or break groups visually

The sheet `Action` column is still the source of truth.

## Main behavior

- the UI reads rows from the selected sheet
- each row is shown as an action card
- clicking a row opens it in the editor panel
- saving writes the canonical action string back into the sheet

## Group behavior

- select multiple rows from the action list
- click `Create Group`
- the first selected row becomes the leader
- followers are written as `Grp`
- the leader keeps the real action configuration

Ungrouping:

- select one or more grouped rows
- click `Ungroup Selected`
- the selected editor row keeps its action but loses `Grp`
- the other selected rows are cleared back to empty action values

## Canonical action generation

The UI generates canonical strings such as:

```text
Grp, "Transfer[Cmts], Pub_lnk[Num_Sequence_, Punct__, Joinus_CHN_LNK[Cmts__Joinus]]"
```

Supported structured options in the UI:

- `Grp`
- `Transfer[Posts]`
- `Transfer[Cmts]`
- `Pub_lnk[...]`
- `Num_Sequence_`
- `Punct__`
- `Joinus_CHN_LNK`
- `Joinus_CHN_LNK[Cmts_Desp_Joinus]`
- `Joinus_CHN_LNK[Cmts__Joinus]`
