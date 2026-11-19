# space-groups

A replacement for Herdr's Spaces sidebar that groups named spaces by prefix.
Each machine gets its own groups. A folded group shows its member count, its
highest-priority agent status, and a highlight if it contains the selected
space. Fold state is kept locally by Herdr for this mod copy.

## Naming

Name a space `Study·anki` to display `anki` under `Study`. The first middle dot
(`·`, U+00B7) splits the name and surrounding whitespace is trimmed on each side.
For example, ` Study · Languages·Anki ` appears as `Languages·Anki` under
`Study`. Names without a middle dot and automatic space names stay standalone.
An empty prefix appears as `(empty group)` and an empty suffix gives a blank
row label.

Groups appear where their first member occurs. Members keep their order,
with the usual exception that linked worktrees sit under their first main
checkout when both share a group. For example, use `Work·repo` and
`Work·feature-a` for a repo and its worktree.

## Drag and drop

Drag within one machine in the expanded sidebar. Hover over a space row's
upper half to insert before it, or its lower half to insert after it. The
insertion line shows where the space or group will move.

- Drop a space on a group heading, including a folded one, to move it to
  the end of that group. Drop it on a member to insert it before or after
  that member. Moving between groups replaces the old name prefix. Moving
  between members of the same group keeps the name.
- Drop a grouped space on a standalone space to remove its first prefix.
  An empty display name keeps the existing name. If the remaining name
  contains another middle dot, that dot still defines a group.
- An automatic name becomes an explicit name when dropped into a group.
  The new name uses the group's prefix and the space's current display name.
- Drag a group heading to move all of its members in their original order.
  Their names stay the same. Drop on another heading to place the group
  before its first member or after its last member. Press and release on
  the same heading to fold it, or on the same space to select it.
- While dragging, use **Move to top** or **Move to end** in an expanded
  machine section to place a space or group at that section's edge.
  The machine heading also accepts drops at the top. A grouped space
  dropped there loses its first prefix if its display name is nonempty.
  An automatic name stays automatic. A whole group keeps its names and
  member order. This works even when every space has a prefix.

The order is changed in Herdr. Worktree nesting still affects the visible
order. Herdr shows an error if the planned name or order cannot be confirmed
within about two seconds.

## Install

1. Locate the app home. On macOS the default is `~/.config/herdr-app`. On
   Windows, see **Home** in the output of `herdr-app --help`.
2. Copy this project's `mods/space-groups` directory into the app home's
   `mods` directory. If you have a Git checkout, copy that same subdirectory
   from the checkout. The result should be `<app home>/mods/space-groups/main.js`.
3. With Herdr Desktop open on the client, clone the built-in layout.

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"main-groups"}'
   ```

   In Windows shells where quoting JSON is awkward, the app also accepts
   `herdr-app do layout.clone --name main --as main-groups`.
4. In `<app home>/layouts/main-groups.json`, change the Spaces block from
   `"mod": "spaces"` to `"mod": "space-groups"` and save. The clone command
   switches to `main-groups`. You can also select it from Herdr's layout picker.

## Uninstall

Switch the window back to the `main` layout. Remove the
`<app home>/mods/space-groups` directory and, if you no longer use the cloned
layout, `<app home>/layouts/main-groups.json`.

## Known limits

- The narrow rail uses the original numbered cells and per-space status
  glyphs. Group drops are available in the expanded sidebar. Machine
  folding applies in both modes.
- The expanded sidebar nests linked worktrees within their own prefix group.
  A workspace whose main checkout has a different prefix, or has no prefix,
  appears in its own group or as a standalone row according to its name.
  Nesting within a prefix group affects the sidebar presentation. Ungrouped
  worktrees retain the built-in automatic ordering.
- This is a copy of the Spaces mod shipped with Herdr 0.1.15. Herdr upgrades
  do not merge fixes into this mod automatically. The mod uses the shipped
  `menu` overlay and `workspace-chrome` icons.
- Preview screenshot pending client-side acceptance. This is the placeholder
  for `preview.png`.

## Development

Run `herdr-app check ./mods/space-groups` to load and render the mod once.
Herdr may generate `gpui-kit.d.ts` in the mod directory when checking or
loading it. The generated declaration is ignored by Git. The pure grouping
tests use Node.js 22+ and require no dependencies.

```sh
node --test tests/
```

Licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## 中文简述

将空间命名为「学习·anki」，宽栏会在对应机器的「学习」组下显示「anki」。
点击组标题可以折叠，标题会显示空间数、组内最紧急的状态和当前选中高亮。
折叠仅保存在当前客户端。窄栏继续使用数字入口。安装时复制 mod 并使用克隆布局。
宽栏可在同一机器内拖动。拖入其他组会换前缀，拖到未分组空间上会去掉首个前缀，
指针在目标空间行的上半区时插到该行之前，下半区时插到该行之后。
自动命名的空间拖入组后会变为手动命名。拖动组标题可移动全组。拖动时，展开的机器块会显示
置顶和置底区域，机器标题也可置顶。单个空间放到首尾会去掉首个前缀（空显示名除外），
整组放到首尾保留名称和成员顺序。窄栏不显示放置区。
