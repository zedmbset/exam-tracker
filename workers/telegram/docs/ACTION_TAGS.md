# Telegram Worker Action Tags

This document explains the action syntax used in the sheet `Action` column.

The parsing logic comes from:

- [legacy_fetcher/Config_Tlg/google_sheets_helper.py](../legacy_fetcher/Config_Tlg/google_sheets_helper.py)
- [legacy_fetcher/telegram_client/action_executor.py](../legacy_fetcher/telegram_client/action_executor.py)

## Important note

These are not really "hashtags".

In this workflow, values like `Grp`, `Transfer[Posts]`, and `Pub_lnk[...]` are action tags stored in the sheet `Action` column.

They tell the worker what to do with a row.

## Core tags

### `Grp`

Means the row belongs to a group of rows that should be processed together.

How it works:

- the first row is the leader
- the leader has `Grp` plus the real action tags
- following rows often contain only `Grp`
- follower rows inherit the leader's main actions and destination

Example:

```text
Row 10: Grp, Transfer[Posts], Pub_lnk[Num_Sequence_,Punct__,Joinus_CHN_LNK]
Row 11: Grp
Row 12: Grp
```

Meaning:

- rows 10, 11, and 12 are one logical group
- row 10 decides how the whole group is processed

### `Transfer[Posts]`

Means transfer the source content as normal post(s) into the destination.

For grouped rows:

- each row in the group is transferred as a post
- if `Pub_lnk[...]` is also present, the worker may create one extra publication-link post after transfer

### `Transfer[Cmts]`

Means transfer the grouped content as comments under a hub post in the destination discussion group.

This is different from normal post transfer.

### `Pub_lnk[...]`

Means build a publication-link style post.

This usually creates a formatted summary/list post based on transferred items.

It can be used:

- by itself
- with `Transfer[Posts]`
- with `Grp`

## Your example

### `Grp, "Transfer[Posts], Pub_lnk[Num_Sequence_, Punct__, Joinus_CHN_LNK]"`

This means:

1. `Grp`
   This row starts a grouped set of rows.

2. `Transfer[Posts]`
   Transfer each item in the group as a normal post to the destination.

3. `Pub_lnk[Num_Sequence_, Punct__, Joinus_CHN_LNK]`
   After or around that transfer flow, build a publication-link post with formatting options.

In plain English:

- treat this and following `Grp` rows as one package
- send the package items as posts
- then generate one formatted link/summary style publication post

## `Pub_lnk[...]` options

### `Num_Sequence_`

Automatically number the publication items.

Example idea:

```text
1. Topic A
2. Topic B
3. Topic C
```

### `Punct__`

Removes the default leading punctuation marker.

Think of it as "no bullet symbol".

There are also variants like `Punct_"..."` to replace the bullet with a custom symbol.

### `Joinus_CHN_LNK`

Append a join-us line based on the destination channel link.

This is used to add a follow/join call-to-action to the publication-link post.

Typical meaning:

- add a line that points users to the destination channel

### Comment-specific Join Us modes

These options are used with `Transfer[Cmts]` inside `Pub_lnk[...]`.

### `Joinus_CHN_LNK[Cmts_Desp_Joinus]`

For transferred comments:

- keep the original description/content
- append the Join Us block at the end

### `Joinus_CHN_LNK[Cmts__Joinus]`

For transferred comments:

- remove the original description/content
- keep only the Join Us block in the comment

Backward compatibility:

- `Joinus_CHN_LNK[Cmts]` still behaves like append mode
- it is treated like `Joinus_CHN_LNK[Cmts_Desp_Joinus]`

## Common combinations

### `Grp, Transfer[Posts]`

Grouped rows are transferred as normal posts.

### `Grp, Transfer[Cmts]`

Grouped rows are posted as comments under one hub post.

### `Grp, Transfer[Cmts], Pub_lnk[Num_Sequence_, Punct__, Joinus_CHN_LNK[Cmts__Joinus]]`

Grouped rows are posted as comments under one hub post.

In this exact mode:

- each comment contains only the Join Us block
- the hub post still receives the final pub-link list
- `Num_Sequence_` and `Punct__` still affect the final pub-link formatting

### `Grp, Transfer[Posts], Pub_lnk[...]`

Grouped rows are transferred as posts, then a publication-link post is generated.

### `Pub_lnk[...]` without `Transfer[Posts]`

Create a publication-link style post from qualifying rows without doing normal transfer-post flow.

## Practical rule

If you see:

```text
Grp, Transfer[Posts], Pub_lnk[...]
```

read it as:

```text
Group these rows together
→ transfer their content as posts
→ then create one formatted publication/link post
```

## Why quotes sometimes appear

Google Sheets may wrap action text in quotes when the cell contains commas.

So these mean the same thing:

```text
Grp, "Transfer[Posts], Pub_lnk[Joinus_CHN_LNK]"
```

```text
Grp, Transfer[Posts], Pub_lnk[Joinus_CHN_LNK]
```

The parser handles both.
