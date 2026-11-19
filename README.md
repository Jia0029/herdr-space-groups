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
`Work·feature-a` for a repo and its worktree. Rows in the expanded list still
support clicking to select, right-clicking for the space menu, and dragging
to reorder within a machine. A drag changes the underlying space order.
Rename the space to change its group.

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
  glyphs. Prefix groups and their folds apply in the expanded sidebar.
  Machine folding applies in both modes.
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
node --test tests/groups.test.mjs
```

Licensed under Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

## 中文简述

将空间命名为「学习·anki」，宽栏会在对应机器的「学习」组下显示「anki」。
点击组标题可以折叠，标题会显示空间数、组内最紧急的状态和当前选中高亮。
折叠仅保存在当前客户端。窄栏继续使用数字入口。安装时复制 mod 并使用克隆布局。
