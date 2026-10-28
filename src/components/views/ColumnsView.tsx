import { useCallback, useMemo } from "react";
import { fileNode, type BrowserNode } from "../../lib/columnBrowser";
import { folderItemId, placeSteps, type FolderTree } from "../../lib/folderTree";
import ColumnBrowser from "./columns/ColumnBrowser";
import type { MenuEntry } from "../../lib/nativeMenu";

interface Props {
  /** The view's files as its folders. */
  tree: FolderTree;
  /** The folder you're in (a path of folder values). */
  place: string[];
  onPlace: (path: string[]) => void;
  /** A folder's right-click menu (by its path). */
  folderMenu?: (path: string[]) => MenuEntry[];
  /** Where opening a folder lands (on past single folders, when they're skipped). */
  opens?: (path: string[]) => string[];
  /** Empty space in a column showing the folder at `path`: New Folder and its level's settings. */
  placeMenu?: (path: string[]) => MenuEntry[];
}

/**
 * The view's folders as Finder columns: each column is a folder's contents,
 * its folders (in their level's order) then the files sitting in it. A
 * folder's contents are worked out only when it's opened.
 */
const AS_IS = (path: string[]) => path;

export default function ColumnsView({ tree, place, onPlace, folderMenu, opens = AS_IS, placeMenu }: Props) {
  /** Each folder node's place (the folder it opens into), for opening and its menu; nodes of an old tree drop out by themselves. */
  const paths = useMemo(() => new WeakMap<BrowserNode, string[]>(), []);
  const root = useMemo(() => {
    const nodesAt = (path: string[]): BrowserNode[] => {
      const { folders, files } = tree.contents(path);
      const folderNodes = folders.map((entry, order): BrowserNode => {
        // With single folders skipped, a folder opens on into the one it holds, and is named for both
        const lands = opens([...path, entry.value]);
        const name =
          lands.length === path.length + 1
            ? entry.label
            : placeSteps(tree, lands).slice(path.length).map((s) => s.label).join(" › ");
        let children: BrowserNode[] | undefined;
        const node: BrowserNode = {
          id: folderItemId(entry.value),
          name,
          order,
          get children() {
            return (children ??= nodesAt(lands));
          },
        };
        paths.set(node, lands);
        return node;
      });
      return [...folderNodes, ...files.map(fileNode)];
    };
    return nodesAt([]);
  }, [tree, paths, opens]);

  // Columns open along the place: each column's folder on the way there
  const folderPath = useMemo(() => {
    const ids: string[] = [];
    let nodes = root;
    for (;;) {
      const node = nodes.find((n) => {
        const p = paths.get(n);
        return p && p.length <= place.length && p.every((v, i) => v === place[i]);
      });
      if (!node?.children) break;
      ids.push(node.id);
      if (paths.get(node)!.length === place.length) break;
      nodes = node.children;
    }
    return ids;
  }, [root, paths, place]);
  // Opening folders here moves the place: to the last folder opened
  const placeOf = useCallback(
    (ids: string[]) => {
      let at: string[] = [];
      let nodes = root;
      for (const id of ids) {
        const node = nodes.find((n) => n.id === id);
        if (!node?.children) break;
        at = paths.get(node) ?? at;
        nodes = node.children;
      }
      return at;
    },
    [root, paths]
  );

  return (
    <ColumnBrowser
      root={root}
      folderPath={folderPath}
      onFolderPathChange={(ids) => onPlace(placeOf(ids))}
      nodeMenu={(node) => {
        const path = paths.get(node);
        return path && folderMenu ? folderMenu(path) : null;
      }}
      columnMenu={(parent) => {
        const path = parent ? paths.get(parent) : [];
        return path && placeMenu ? placeMenu(path) : [];
      }}
    />
  );
}
