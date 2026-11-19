# Changelog

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
