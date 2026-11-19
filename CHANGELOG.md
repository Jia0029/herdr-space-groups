# Changelog

## 0.5.1

- Add a Spaces toggle to the wide Agents toolbar. Its chevron points up to
  hide Spaces and down to show it when visibility is available. Document
  keyboard shortcuts for macOS and Windows.

## 0.5.0

- Default to remote machines first and keep draggable machine order per client.
- Show matching machine sections in the grouped Agents view.
- Add Spaces header menus for renaming, ungrouping and creating groups or spaces.

## 0.4.0

- Rebase both mods on the built-in panels in Herdr 0.1.16, the new
  minimum supported release.
- Scroll the active space or its folded group heading into view.
  Improve Git refresh limits, stale watch cleanup, and small-width labels.
- Preserve meaningful brackets and quotes in Agents titles and recover
  from invalid stored panel state.

## 0.3.1

- Show only the source machine's end drop zone in Spaces. A machine
  heading still accepts drops at the top.
- Drag a group heading in the grouped Agents view to reorder its spaces
  on the same machine while keeping their names.

## 0.3.0

- Add the optional `agent-groups` mod for the Agents sidebar. Grouped by
  space combines agents from spaces with the same prefix on a machine.
- Keep Agents group folds on the current client and show an accent dot
  when an agent becomes done or blocked after the group was folded.

## 0.2.2

- Use the pointer's position within a space row to insert above or below it.

## 0.2.1

- Show top and end drop zones in expanded machine sections while dragging.
- Drop on a machine heading to move to the top. Dropping a space at either
  edge removes its prefix when its display name is nonempty, even when all
  spaces are grouped. A group keeps its names and member order.

## 0.2.0

- Drag spaces into a group, onto another group's member or out to an ungrouped row. Membership changes rename the space.
- Drag group headings to move an entire group within the same machine. Folded groups accept drops.
- Show a drop cue and check the resulting name and order, with an error notification if Herdr cannot confirm them.

## 0.1.0

- Add collapsible space groups based on the first `·` in each named space.
- Show the member count, highest-priority agent status and active selection on folded groups.
- Store folds locally, keep worktrees nested inside their groups and retain the numbered rail.
