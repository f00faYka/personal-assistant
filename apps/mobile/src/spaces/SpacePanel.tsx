import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import type { Space, SpacesClient } from "./spaces";

interface SpacePanelProps {
  readonly client: SpacesClient;
  readonly memberId: string;
  readonly selectedSpaceId: string | null;
  readonly onSelect: (spaceId: string | null) => void;
  readonly onSpacesChanged: (spaces: readonly Space[]) => void;
}

export function SpacePanel({ client, memberId, selectedSpaceId, onSelect, onSpacesChanged }: SpacePanelProps) {
  const [open, setOpen] = useState(false);
  const [spaces, setSpaces] = useState<readonly Space[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [parentId, setParentId] = useState<string | undefined>();

  const load = async () => {
    setLoading(true); setError(null);
    try { const next = await client.list(memberId); setSpaces(next); onSpacesChanged(next); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to load Spaces"); }
    finally { setLoading(false); }
  };
  const toggle = () => { setOpen((current) => !current); if (!open && spaces.length === 0) void load(); };
  const create = async () => {
    if (!name.trim()) { setError("Space name is required"); return; }
    setLoading(true); setError(null);
    try { const created = await client.create(memberId, name, parentId); const next = [...spaces, created]; setSpaces(next); onSpacesChanged(next); setName(""); setParentId(undefined); onSelect(created.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to create Space"); }
    finally { setLoading(false); }
  };
  return <View accessibilityLabel="Space organization" style={{ marginHorizontal: 16, marginBottom: 12 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Organize Spaces" onPress={toggle}><Text style={{ color: "#24221F", fontSize: 16, fontWeight: "700", paddingVertical: 10 }}>Spaces {open ? "⌃" : "⌄"}</Text></Pressable>
    {open ? <View style={{ backgroundColor: "#EFEAE2", borderRadius: 14, padding: 14 }}>
      {loading ? <ActivityIndicator accessibilityLabel="Loading Spaces" /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Unassigned root" onPress={() => onSelect(null)}><Text style={{ paddingVertical: 7, fontWeight: selectedSpaceId === null ? "700" : "400" }}>Unassigned (root)</Text></Pressable>
      {spaces.map((space) => <View key={space.id} style={{ paddingLeft: space.parentId ? 18 : 0 }}><Pressable accessibilityRole="button" accessibilityLabel={`Select Space ${space.name}`} onPress={() => onSelect(space.id)}><Text style={{ paddingVertical: 7, fontWeight: selectedSpaceId === space.id ? "700" : "400" }}>{space.name}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel={`Create child Space under ${space.name}`} onPress={() => setParentId(space.id)}><Text style={{ color: "#7A5C36", paddingBottom: 7 }}>Add child</Text></Pressable></View>)}
      <TextInput accessibilityLabel="New Space name" value={name} onChangeText={setName} placeholder={parentId ? "Child Space name" : "New top-level Space"} style={{ borderBottomColor: "#B9A895", borderBottomWidth: 1, paddingVertical: 8 }} />
      <Pressable accessibilityRole="button" accessibilityLabel={parentId ? "Create child Space" : "Create top-level Space"} onPress={() => void create()}><Text style={{ color: "#24221F", fontWeight: "700", paddingVertical: 10 }}>{parentId ? "Create child Space" : "Create top-level Space"}</Text></Pressable>
      {parentId ? <Pressable accessibilityRole="button" accessibilityLabel="Create top-level Space instead" onPress={() => setParentId(undefined)}><Text style={{ color: "#7A5C36" }}>Create at root instead</Text></Pressable> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: "#8C3D25", paddingTop: 8 }}>{error}</Text> : null}
    </View> : null}
  </View>;
}
