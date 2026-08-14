import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, SafeAreaView, StyleSheet, Text, View } from "react-native";

import { createMemberItemsClient, initialListState, listItemLabel, listStateFromError, listStateFromPage, type ListState, type MemberListItem } from "./member-items";

interface MemberListScreenProps {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly onOpenDetail?: (detailUrl: string) => void;
}

export function MemberListScreen({ apiBaseUrl, memberId, onOpenDetail }: MemberListScreenProps) {
  const client = useMemo(() => createMemberItemsClient(apiBaseUrl), [apiBaseUrl]);
  const [state, setState] = useState<ListState>(initialListState);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingCursor = useRef<string | null>(null);

  const load = useCallback(async (isRefresh = false, cursor?: string) => {
    if (isRefresh) setRefreshing(true);
    else if (cursor) {
      if (loadingCursor.current === cursor) return;
      loadingCursor.current = cursor;
      setLoadingMore(true);
    }
    else setState((current) => ({ status: "loading", items: current.items }));
    try {
      const page = await client.list(memberId, cursor);
      setState((current) => {
        const nextPage = listStateFromPage(page);
        return { ...nextPage, items: cursor ? [...current.items, ...nextPage.items] : nextPage.items };
      });
    } catch (error) {
      setState((current) => listStateFromError(current.items, error));
    } finally {
      setRefreshing(false);
      setLoadingMore(false);
      if (cursor) loadingCursor.current = null;
    }
  }, [client, memberId]);

  useEffect(() => { void load(); }, [load]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>D · SUMMARY TIMELINE</Text>
        <Text style={styles.title}>Your items</Text>
      </View>
      {state.status === "loading" && state.items.length === 0 ? <LoadingState /> : null}
      {state.status === "error" && state.items.length === 0 ? <ErrorState message={state.message} onRetry={() => void load()} /> : null}
      {state.status === "ready" && state.items.length === 0 ? <EmptyState /> : null}
      {state.status === "error" && state.items.length > 0 ? <ErrorBanner message={state.message} /> : null}
      {state.items.length > 0 ? (
        <FlatList
          data={state.items}
          keyExtractor={(item) => `${item.kind}:${item.id}`}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} />}
          onEndReached={state.status === "ready" && state.nextCursor && !loadingMore ? () => void load(false, state.nextCursor ?? undefined) : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} /> : null}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => <ListCard item={item} onPress={onOpenDetail} />}
        />
      ) : null}
    </SafeAreaView>
  );
}

function ListCard({ item, onPress }: { readonly item: MemberListItem; readonly onPress: ((detailUrl: string) => void) | undefined }) {
  const label = listItemLabel(item);
  const title = item.kind === "task" ? item.title : item.kind === "note" ? item.content : item.state === "failed" ? "This Capture could not be processed" : "Processing your Capture";
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${title}`} onPress={() => onPress?.(item.detailUrl)} style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}>
      <View style={styles.cardHeader}><Text style={styles.label}>{label}</Text><Text style={styles.date}>{formatDate(item.createdAt)}</Text></View>
      <Text style={styles.cardTitle}>{title}</Text>
      {item.kind === "task" && item.dueAt ? <Text style={styles.detail}>Due {formatDate(item.dueAt)}</Text> : null}
      {item.kind === "note" && item.state === "needs_review" ? <Text style={styles.reviewHint}>Review this item to confirm what it means.</Text> : null}
    </Pressable>
  );
}

function LoadingState() { return <View style={styles.state}><ActivityIndicator accessibilityLabel="Loading items" /><Text style={styles.stateText}>Loading your items…</Text></View>; }
function EmptyState() { return <View style={styles.state}><Text style={styles.stateTitle}>Nothing here yet</Text><Text style={styles.stateText}>Your Tasks and Notes will appear here after your first Capture.</Text></View>; }
function ErrorBanner({ message }: { readonly message: string }) { return <View accessibilityRole="alert" style={styles.errorBanner}><Text style={styles.errorText}>Refresh failed: {message}</Text></View>; }
function ErrorState({ message, onRetry }: { readonly message: string; readonly onRetry: () => void }) { return <View style={styles.state}><Text style={styles.stateTitle}>Couldn’t load your items</Text><Text style={styles.stateText}>{message}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.retry}><Text style={styles.retryText}>Try again</Text></Pressable></View>; }
function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, { month: "short", day: "numeric" }); }

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F7F5F0" }, header: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 16 }, eyebrow: { color: "#8B7355", fontSize: 11, fontWeight: "700", letterSpacing: 1.4 }, title: { color: "#24221F", fontSize: 34, fontWeight: "700", marginTop: 6 }, list: { padding: 16, paddingTop: 4, gap: 12 }, card: { backgroundColor: "#FFFFFF", borderColor: "#E5E0D8", borderRadius: 16, borderWidth: 1, padding: 18 }, cardPressed: { opacity: 0.7 }, cardHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }, label: { color: "#7A5C36", fontSize: 12, fontWeight: "700", textTransform: "uppercase" }, date: { color: "#908A82", fontSize: 12 }, cardTitle: { color: "#24221F", fontSize: 18, fontWeight: "600", lineHeight: 24 }, detail: { color: "#716B64", fontSize: 14, marginTop: 8 }, reviewHint: { color: "#A15B2A", fontSize: 14, marginTop: 8 }, errorBanner: { backgroundColor: "#FCE8DF", marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 10 }, errorText: { color: "#8C3D25", fontSize: 14 }, state: { alignItems: "center", flex: 1, justifyContent: "center", padding: 32 }, stateTitle: { color: "#24221F", fontSize: 20, fontWeight: "700", textAlign: "center" }, stateText: { color: "#716B64", fontSize: 16, lineHeight: 23, marginTop: 8, maxWidth: 300, textAlign: "center" }, retry: { backgroundColor: "#24221F", borderRadius: 12, marginTop: 20, paddingHorizontal: 20, paddingVertical: 12 }, retryText: { color: "#FFFFFF", fontSize: 16, fontWeight: "600" }, footer: { padding: 16 },
});
