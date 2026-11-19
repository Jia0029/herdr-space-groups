# Space Groups

The left sidebar shows spaces under each machine. Names like `Study·anki`
share a clickable `Study` heading, with `anki` indented beneath it.
A closed heading still shows how many spaces it holds and whether one needs
attention.

![Space Groups](preview.png)

The optional Agents panel below it groups agents from the same named-space
prefix on a machine. Its rows show the short space name and agent detail.

## What you see

- A theme-colored sidebar starts with the existing 31 px Spaces toolbar and
  its new-space button. The list beneath scrolls vertically.
- When another machine is known, 26 px machine headings separate this
  computer and the remote machines. They retain their connection colors,
  add controls and connection guidance.
- Each 26 px prefix heading shows an 11 px arrow, an 11.5 px semibold name
  and a member count. It uses the theme's muted text and its hover and
  selection backgrounds.
- Space rows are 30 px high, with 28 px worktree rows. Group members have
  14 px of extra left padding. Worktrees have another 22 px and a branch
  icon. Other rows have the built-in 18 px colored avatar. Git details appear
  to the right when relevant.
- During a drag in the expanded sidebar, the source machine gets an 18 px
  dashed **Move to end** zone below its spaces. A machine heading or the
  end zone uses the theme's accent when it is a valid drop target.
- Below 160 logical px, the sidebar shows the built-in 32 px wide numbered
  rail cells with machine icons and per-space status glyphs.
- The optional Agents panel keeps the shipped 41 px toolbar and 30 px agent
  rows. A folded Agents header can show a separate 6 px accent dot next
  to its status summary.

## How it behaves

- Click a group heading to fold or unfold it. The arrow points right when
  folded and down when open. A folded group containing the selected space
  has the theme's selected background. An open group shows its selected
  member in the usual way.
- A folded group's status follows the priority blocked, done, working,
  idle. Blocked and done use a filled dot in the corresponding theme color.
  Working and idle use a middle dot in their theme colors. Hover the glyph
  for the status name. A group with no reported status has no glyph.
- Click a space to select it or right-click for its menu. Drag a space to
  a heading to append it to that group, even if folded. Hover over a space
  row's upper or lower half to put the insertion line before or after it.
  Release to insert at the displayed line. The name gains or replaces its
  prefix on entry into a group. Automatic names become explicit names. A drop on a
  standalone row removes the first prefix when the display name is nonempty.
- Drag a heading to move its entire group before or after the target
  without changing names. The dragged row or heading becomes translucent.
  Target headings get an accent outline and row targets get an accent
  insertion line. Drops onto another item leave the fold state as it was.
  Pressing and releasing on the same item counts as a click, even if the
  pointer moved away in between. The drag starts after the pointer moves
  more than 4 logical pixels along either axis.
- Drag and drop works within one machine. Dropping a group on its own
  members does nothing. Herdr shows an error if the resulting name or order
  cannot be confirmed in about two seconds.
- Drop on the end zone to move to the last position of the source
  machine's space list. Where present, the source machine's heading
  acts as a top drop target.
  At these targets a space loses its first prefix if the display name is
  nonempty, and automatic names stay automatic. Groups keep their names
  and member order. The zones disappear when the drag ends.
- The rail gives every space a numbered selection cell, including members
  hidden by prefix folds in the wider sidebar. Machine headings still
  fold their entire machine in both widths. Widening the sidebar restores
  the previous prefix folds. Group drops are available in the expanded
  sidebar. Existing Herdr shortcuts still work.
- In Agents, the sort menu switches between Priority and Grouped by space.
  The latter merges named-space prefixes within each machine. Pinned
  agents and sub-agent trees retain their behavior. The local accent dot
  appears when a folded group has a new, still-current Done or Blocked
  state. Click the header to open the group and clear its fold time.
- Drag an Agents group heading in the wide Grouped by space view. Another
  heading on the same machine shows a line above or below its title
  according to the pointer's position. All the source group's spaces
  move together with their names intact. Dropping on itself leaves the
  group as it was. Pinned and Priority headings and the rail keep their
  existing behavior.

## Built from

- Clone the `main` layout and keep its node tree. Under
  `sidebar → sidebar-lists → spaces`, point the spaces block at
  `space-groups`. The mod has `place: "none"` and takes no props.
- Build from the Spaces mod in Herdr 0.1.15. Reuse the `menu` overlay with
  `{ tab: "space", target: { id } }` and the supplied `workspace-chrome`
  SVGs for chevrons, the branch, machine icons and plus buttons. There is no
  custom artwork.
- Read `spaces()`, `panes()`, `machines()`, `theme()`, `layout()`,
  and `window()`. Keep the upstream `space.colors` shared state,
  `watchFolder()` ref watches, `openOverlay()`, and `run()` for space
  selection, movement, creation and machine settings. Keep upstream Git
  ref queries through `exec()` and machine listing/reconnection through
  `hc()`. Prefix grouping itself uses no external programs.
- Use the first `SEP` (`·`, U+00B7) in a named space's name. Trim both
  parts. Use the pair of machine name and prefix as the group identity.
  Keep the folded keys as a JSON array in this mod copy's `localStorage`
  at `space-groups.folded`.
- Plan drops from the current `spaces()` order. Use `run("space.rename", {id, name})`
  for a membership change and `run("space.move", {id, index})` for each move.
  Simulate each move before computing the next 1-based index. Use
  `cx.timer.after()` with a short deadline to verify the live name and order,
  and `notify()` for an unconfirmed drop.
- Route the end zone and the machine heading through the same
  `planEdgeDrop()` logic, with `edge: "top"` for the heading. Confirm
  placement at the actual edge of the machine's live space order.
- Optionally point `sidebar → sidebar-lists → agents` at `agent-groups`,
  a standalone copy of the Herdr 0.1.15 Agents mod. Its sort popup uses
  the same mod with `{sortMenu: true}` and writes `agent-groups.sort`.
  Group by the machine and parsed prefix from `spaces()`; use `agents()`
  and the live sub-agent tree from `terminals()` to observe changes.
  Group fold times are stored at `agent-groups.folded` in local storage.
- For an Agents group move, use `spaces()` to resolve every member of
  the source and target groups. Simulate the resulting 1-based
  `space.move` indexes and read back the resulting space order.
  `agents()` follows space order, so the panel uses the resulting order.

## Watch out

- Automatic names bypass the split. Subsequent middle dots are part of the
  displayed suffix. Empty prefixes get the label `(empty group)`.
- A worktree with a different prefix from its main checkout follows its own
  name. Grouped worktree nesting is a display rule so it need not shuffle
  other groups. Keep the shipped ordering behavior for ungrouped worktrees.
- Use the underlying space index for drag destinations and rail numbering.
  A drag target must be visible. A folded heading still represents all of
  its hidden members when computing the insertion point. Worktree nesting
  can affect the visible order. A remaining middle dot after prefix
  removal is still interpreted as a group separator.
- Machine folding and prefix folding are separate. Never put prefix fold
  state in shared space data. The client needs a Herdr version with the
  shipped menu and icon paths used by the 0.1.15 baseline.
- Keep the Agents panel's elapsed-time behavior for Done and Idle.
  Track the actual status separately for the dot, using only the most
  recent observed transition. A transition while the panel is away is
  visible only if the panel next observes a different status. Sorting
  and folds belong to this mod's client.

## Done when

- `herdr-app check` passes for the mod folder and the pure grouping tests pass.
- Two machines with a common prefix show separate headings, and an
  unprefixed or automatically named space stays outside the headings.
- Folding a group leaves the count, highest-priority status, and selected
  highlight visible. Closing and reopening the same layout retains the fold.
- Selecting and opening a context menu work. A space can enter a folded
  group, enter another group at a visible member, reorder within a group
  or leave at a standalone row. A heading can move the whole group.
- A same-group worktree nests beneath its repo and displays its Git details.
- Narrowing the sidebar reveals the rail entries even for folded groups.
  Widening it restores the folds.
- A fully grouped machine can accept a space at its end zone or machine
  heading. A group can move intact to the same targets. The end zone
  appears only under the source machine's spaces in the expanded sidebar.
- Agents in two same-prefix spaces appear under one heading with distinct
  short labels, and a same-prefix space on another machine stays separate.
  A folded Agents group shows a dot for a new Done or Blocked state, clears
  on open, and keeps its fold when the client is reopened.
- Reordering a grouped Agents heading updates Spaces in the same order.
  The move includes spaces without agents and keeps all space names.
