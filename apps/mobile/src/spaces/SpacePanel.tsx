import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { Space, SpaceTreeView, SpacesClient } from "./spaces";

interface SpacePanelProps {
  readonly client: SpacesClient;
  readonly memberId: string;
  readonly selectedSpaceId: string | null;
  readonly onSelect: (spaceId: string | null) => void;
  readonly onSpacesChanged: (spaces: readonly Space[]) => void;
}

type SpaceMode = "hierarchical" | "flat";

export function SpacePanel({ client, memberId, selectedSpaceId, onSelect, onSpacesChanged }: SpacePanelProps) {
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [parentId, setParentId] = useState<string | undefined>();
  const [mode, setMode] = useState<SpaceMode>("hierarchical");
  const [selectedView, setSelectedView] = useState<SpaceTreeView | null>(null);
  const [activeSpaceId, setActiveSpaceId] = useState<string | null>(selectedSpaceId);

  const tree = useMemo(() => buildTree(spaces), [spaces]);
  const flatSpaces = useMemo(
    () => activeSpaceId === null
      ? spaces.filter((space) => !space.archivedAt)
      : spaces.filter((space) => !space.archivedAt && (space.id === activeSpaceId || isDescendant(space, activeSpaceId, spaces))),
    [activeSpaceId, spaces],
  );
  const archivedRoots = spaces.filter((space) => space.archivedAt && !isArchivedDescendant(space, spaces));

  const publish = (next: readonly Space[]) => {
    setSpaces(next);
    onSpacesChanged(next);
  };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      publish(await client.list(memberId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Spaces");
    } finally {
      setLoading(false);
    }
  };

  const refreshSelectedView = async () => {
    if (activeSpaceId === null) {
      setSelectedView(null);
      return;
    }
    try {
      setSelectedView(await client.read(memberId, activeSpaceId, mode));
    } catch {
      setSelectedView(null);
    }
  };

  const selectSpace = async (spaceId: string | null) => {
    setActiveSpaceId(spaceId);
    onSelect(spaceId);
    if (spaceId === null) {
      setSelectedView(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSelectedView(await client.read(memberId, spaceId, mode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Space contents");
    } finally {
      setLoading(false);
    }
  };

  const changeMode = async (nextMode: SpaceMode) => {
    setMode(nextMode);
    if (activeSpaceId === null) return;
    setLoading(true);
    try {
      setSelectedView(await client.read(memberId, activeSpaceId, nextMode));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load Space contents");
    } finally {
      setLoading(false);
    }
  };

  const run = async (action: () => Promise<Space | void>) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await action();
      if (updated) {
        publish(updateLocalSpaces(spaces, updated));
        if (updated.archivedAt && activeSpaceId === updated.id) {
          setActiveSpaceId(null);
          onSelect(null);
        }
      } else {
        await load();
      }
      await refreshSelectedView();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to update Space");
    } finally {
      setLoading(false);
    }
  };

  const create = async () => {
    if (!name.trim()) {
      setError("Space name is required");
      return;
    }
    await run(async () => {
      const created = await client.create(memberId, name, parentId);
      setName("");
      setParentId(undefined);
      await selectSpace(created.id);
      return created;
    });
  };

  const rename = async (space: Space) => {
    if (!name.trim()) {
      setError("Space name is required");
      return;
    }
    await run(async () => {
      const updated = await client.update(memberId, space.id, { name });
      setName("");
      setEditingId(null);
      return updated;
    });
  };

  const move = async (space: Space, nextParentId: string | null) => {
    await run(() => client.update(memberId, space.id, { parentId: nextParentId }));
    setMovingId(null);
  };

  const deleteOrArchive = async (space: Space) => {
    await run(async () => {
      const view = await client.read(memberId, space.id, "hierarchical");
      if (view.children.length > 0 || view.items.length > 0) {
        return client.archive(memberId, space.id);
      }
      await client.remove(memberId, space.id);
      if (activeSpaceId === space.id) {
        setActiveSpaceId(null);
        onSelect(null);
      }
      return undefined;
    });
  };

  const rowProps = {
    selectedSpaceId,
    editingId,
    movingId,
    name,
    spaces,
    onNameChange: setName,
    onSelect: (id: string) => void selectSpace(id),
    onEdit: (space: Space) => {
      setEditingId(space.id);
      setName(space.name);
    },
    onRename: rename,
    onMove: move,
    onStartMove: setMovingId,
    onAddChild: setParentId,
    onArchive: (space: Space) => void run(() => client.archive(memberId, space.id)),
    onDelete: (space: Space) => void deleteOrArchive(space),
  };

  return (
    <View accessibilityLabel="Space organization" style={{ marginHorizontal: 16, marginBottom: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Organize Spaces" onPress={() => { setOpen((current) => !current); if (!open && spaces.length === 0) void load(); }}>
        <Text style={{ color: "#24221F", fontSize: 16, fontWeight: "700", paddingVertical: 10 }}>Spaces {open ? "⌃" : "⌄"}</Text>
      </Pressable>
      {open ? (
        <View style={{ backgroundColor: "#EFEAE2", borderRadius: 14, padding: 14 }}>
          {loading ? <ActivityIndicator accessibilityLabel="Loading Spaces" /> : null}
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Hierarchical Space view" onPress={() => void changeMode("hierarchical")}>
              <Text style={{ fontWeight: mode === "hierarchical" ? "700" : "400" }}>Tree</Text>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Flat Space view" onPress={() => void changeMode("flat")}>
              <Text style={{ fontWeight: mode === "flat" ? "700" : "400" }}>All paths</Text>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Unassigned root" onPress={() => void selectSpace(null)}>
            <Text style={{ paddingVertical: 9, fontWeight: selectedSpaceId === null ? "700" : "400" }}>Unassigned (root)</Text>
          </Pressable>
          {mode === "hierarchical"
            ? tree.map((node) => <SpaceRow key={node.space.id} node={node} depth={0} {...rowProps} />)
            : flatSpaces.map((space) => <SpaceRow key={space.id} node={{ space, children: [] }} depth={0} path={spacePath(space, spaces)} {...rowProps} />)}
          {selectedView ? <SpaceContents view={selectedView} mode={mode} /> : null}
          {archivedRoots.length > 0 ? <View>
            <Text style={{ fontWeight: "700", marginTop: 12 }}>Archived Spaces</Text>
            {archivedRoots.map((space) => <View key={space.id} style={{ paddingVertical: 6 }}>
              <Text>{spacePath(space, spaces)}</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={`Restore Space ${space.name}`} onPress={() => void run(() => client.restore(memberId, space.id))}>
                <Text style={{ color: "#7A5C36", marginTop: 4 }}>Restore subtree</Text>
              </Pressable>
            </View>)}
          </View> : null}
          <TextInput accessibilityLabel="New Space name" value={editingId ? "" : name} onChangeText={setName} placeholder={parentId ? "Child Space name" : "New top-level Space"} style={{ borderBottomColor: "#B9A895", borderBottomWidth: 1, paddingVertical: 8 }} />
          <Pressable accessibilityRole="button" accessibilityLabel={parentId ? "Create child Space" : "Create top-level Space"} onPress={() => void create()}>
            <Text style={{ color: "#24221F", fontWeight: "700", paddingVertical: 10 }}>{parentId ? "Create child Space" : "Create top-level Space"}</Text>
          </Pressable>
          {parentId ? <Pressable accessibilityRole="button" accessibilityLabel="Create top-level Space instead" onPress={() => setParentId(undefined)}>
            <Text style={{ color: "#7A5C36" }}>Create at root instead</Text>
          </Pressable> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: "#8C3D25", paddingTop: 8 }}>{error}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

interface SpaceNode {
  readonly space: Space;
  readonly children: readonly SpaceNode[];
}

interface SpaceRowProps {
  readonly node: SpaceNode;
  readonly depth: number;
  readonly path?: string;
  readonly selectedSpaceId: string | null;
  readonly editingId: string | null;
  readonly movingId: string | null;
  readonly name: string;
  readonly spaces: readonly Space[];
  readonly onNameChange: (value: string) => void;
  readonly onSelect: (id: string) => void;
  readonly onEdit: (space: Space) => void;
  readonly onRename: (space: Space) => Promise<void>;
  readonly onMove: (space: Space, parentId: string | null) => Promise<void>;
  readonly onStartMove: (id: string) => void;
  readonly onAddChild: (id: string) => void;
  readonly onArchive: (space: Space) => void;
  readonly onDelete: (space: Space) => void;
}

function SpaceRow({ node, depth, path, selectedSpaceId, editingId, movingId, name, spaces, onNameChange, onSelect, onEdit, onRename, onMove, onStartMove, onAddChild, onArchive, onDelete }: SpaceRowProps) {
  const { space } = node;
  const isEditing = editingId === space.id;
  const moveTargets = spaces.filter((candidate) => !candidate.archivedAt && candidate.id !== space.id && !isDescendant(candidate, space.id, spaces));
  return (
    <View style={{ paddingLeft: depth * 18, paddingVertical: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Select Space ${space.name}`} onPress={() => onSelect(space.id)}>
        <Text style={{ fontWeight: selectedSpaceId === space.id ? "700" : "400" }}>{path ?? space.name}</Text>
      </Pressable>
      {isEditing ? (
        <View>
          <TextInput accessibilityLabel={`Rename Space ${space.name}`} value={name} onChangeText={onNameChange} />
          <Pressable accessibilityRole="button" accessibilityLabel={`Save Space ${space.name}`} onPress={() => void onRename(space)}>
            <Text>Save name</Text>
          </Pressable>
        </View>
      ) : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Rename Space ${space.name}`} onPress={() => onEdit(space)}>
            <Text style={{ color: "#7A5C36" }}>Rename</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Create child Space under ${space.name}`} onPress={() => onAddChild(space.id)}>
            <Text style={{ color: "#7A5C36" }}>Add child</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move Space ${space.name}`} onPress={() => onStartMove(space.id)}>
            <Text style={{ color: "#7A5C36" }}>Move</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Archive Space ${space.name}`} onPress={() => onArchive(space)}>
            <Text style={{ color: "#8C3D25" }}>Archive</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel={`Delete Space ${space.name}`} onPress={() => onDelete(space)}>
            <Text style={{ color: "#8C3D25" }}>Delete</Text>
          </Pressable>
        </View>
      )}
      {movingId === space.id ? (
        <View>
          <Text>Move this Space to:</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={`Move Space ${space.name} to root`} onPress={() => void onMove(space, null)}>
            <Text>Root</Text>
          </Pressable>
          {moveTargets.map((target) => <Pressable key={target.id} accessibilityRole="button" accessibilityLabel={`Move Space ${space.name} to ${target.name}`} onPress={() => void onMove(space, target.id)}><Text>{target.name}</Text></Pressable>)}
        </View>
      ) : null}
      {node.children.map((child) => (
        <SpaceRow
          key={child.space.id}
          node={child}
          depth={depth + 1}
          selectedSpaceId={selectedSpaceId}
          editingId={editingId}
          movingId={movingId}
          name={name}
          spaces={spaces}
          onNameChange={onNameChange}
          onSelect={onSelect}
          onEdit={onEdit}
          onRename={onRename}
          onMove={onMove}
          onStartMove={onStartMove}
          onAddChild={onAddChild}
          onArchive={onArchive}
          onDelete={onDelete}
        />
      ))}
    </View>
  );
}

function SpaceContents({ view, mode }: { readonly view: SpaceTreeView; readonly mode: SpaceMode }) {
  return (
    <View accessibilityLabel="Selected Space contents">
      <Text style={{ fontWeight: "700", marginTop: 10 }}>{view.path}</Text>
      {mode === "hierarchical" ? view.children.map((child) => (
        <Text key={child.space.id}>Child Space: {child.space.name}</Text>
      )) : null}
      {view.items.map((item) => (
        <Text key={`${item.itemKind}:${item.itemId}`}>
          {mode === "flat" ? `${item.path}: ` : ""}
          {item.title ?? item.content ?? item.itemId}
        </Text>
      ))}
    </View>
  );
}

function buildTree(spaces: readonly Space[]): readonly SpaceNode[] {
  const nodes = new Map(spaces.filter((space) => !space.archivedAt).map((space) => [space.id, { space, children: [] as SpaceNode[] }]));
  const roots: SpaceNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.space.parentId ? nodes.get(node.space.parentId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  }
  return roots;
}

function spacePath(space: Space, spaces: readonly Space[]): string {
  const names: string[] = [];
  let current: Space | undefined = space;
  while (current) {
    names.unshift(current.name);
    current = current.parentId ? spaces.find((candidate) => candidate.id === current?.parentId) : undefined;
  }
  return names.join(" / ");
}

function isDescendant(space: Space, ancestorId: string, spaces: readonly Space[]): boolean {
  let parentId = space.parentId;
  while (parentId) {
    if (parentId === ancestorId) return true;
    parentId = spaces.find((candidate) => candidate.id === parentId)?.parentId;
  }
  return false;
}

function isArchivedDescendant(space: Space, spaces: readonly Space[]): boolean {
  return Boolean(space.parentId && spaces.some((candidate) => candidate.id === space.parentId && candidate.archivedAt));
}

function updateLocalSpaces(spaces: readonly Space[], updated: Space): readonly Space[] {
  if (!spaces.some((space) => space.id === updated.id)) return [...spaces, updated];
  return spaces.map((space) => {
    if (space.id === updated.id) return updated;
    if (!isDescendant(space, updated.id, spaces)) return space;
    if (updated.archivedAt) return { ...space, archivedAt: updated.archivedAt };
    const { archivedAt: _archivedAt, ...active } = space;
    return active;
  });
}
