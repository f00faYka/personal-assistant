/** Shared Task and Note card presentation used by the real client and UI fixtures. */
import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import type { ReactNode } from "react";
import { tokens } from "../design-system";

interface SharedProps {
  readonly onPress: () => void;
  readonly onEdit?: () => void;
}
export type CardSaveState = "saved" | "pending" | "error";
export type TaskCardData = { readonly id: string; readonly title: string; readonly dueAt?: string; readonly status: "open" | "completed"; readonly space?: string; readonly tags?: readonly string[] };
export type NoteCardData = { readonly id: string; readonly content: string; readonly reviewState: "none" | "needs_review"; readonly space?: string; readonly tags?: readonly string[] };

export function TaskCard({ task, onPress, onEdit, onSetCompleted, saveState = "saved", onRetry, timeZone, today }: SharedProps & {
  readonly task: TaskCardData;
  readonly onSetCompleted?: (completed: boolean) => void | Promise<boolean>;
  readonly saveState?: CardSaveState;
  readonly onRetry?: () => void;
  readonly timeZone: string;
  readonly today: string;
}) {
  const completed = task.status === "completed";
  const canComplete = !completed && saveState === "saved" && !!onSetCompleted;
  return <CardFrame kind="Task" title={task.title} badge={formatDue(task.dueAt, timeZone, today)} mutedBadge={!task.dueAt}
    completed={completed} onPress={onPress} onEdit={onEdit}
    onComplete={canComplete ? () => onSetCompleted?.(true) : undefined}
    onSetCompleted={completed && saveState === "saved" ? onSetCompleted : undefined}
    metadata={<Metadata space={task.space} tags={task.tags ?? []} />}
    status={saveState === "pending" ? <Text style={styles.pending} accessibilityLiveRegion="polite">Saving Task status…</Text> : saveState === "error" ? <View style={styles.errorRow}><Text style={styles.error} accessibilityRole="alert">Task status unchanged · not saved</Text>{onRetry ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry saving ${task.title}`} onPress={onRetry} style={styles.retry}><Text style={styles.error}>Retry</Text></Pressable> : null}</View> : completed ? <Text style={styles.completedLabel}>✓ Completed</Text> : null} />;
}

export function NoteCard({ note, onPress, onEdit }: SharedProps & { readonly note: NoteCardData }) {
  return <CardFrame kind="Note" title={note.content} badge={note.reviewState === "needs_review" ? "Needs review" : undefined}
    onPress={onPress} onEdit={onEdit}
    metadata={<Metadata space={note.space} tags={note.tags ?? []} />} />;
}

function CardFrame({ kind, title, badge, mutedBadge = false, completed = false, onPress, onEdit, onComplete, onSetCompleted, metadata, status }: {
  readonly kind: "Task" | "Note";
  readonly title: string;
  readonly badge?: string | undefined;
  readonly mutedBadge?: boolean;
  readonly completed?: boolean;
  readonly onPress: () => void;
  readonly onEdit?: (() => void) | undefined;
  readonly onComplete?: (() => void | Promise<boolean>) | undefined;
  readonly onSetCompleted?: ((completed: boolean) => void | Promise<boolean>) | undefined;
  readonly metadata: ReactNode;
  readonly status?: ReactNode;
}) {
  const [dragX, setDragX] = useState(0);
  const [swipedAway, setSwipedAway] = useState(false);
  const swipeDx = useRef(0);
  const [menu, setMenu] = useState(false);
  const [actionsMounted, setActionsMounted] = useState(false);
  const actionProgress = useRef(new Animated.Value(0)).current;
  const suppressPress = useRef(false);
  const note = kind === "Note";
  useEffect(() => {
    if (menu) {
      setActionsMounted(true);
      actionProgress.setValue(0);
      const animation = Animated.timing(actionProgress, { toValue: 1, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false });
      animation.start();
      return () => animation.stop();
    }
    const animation = Animated.timing(actionProgress, { toValue: 0, duration: 170, easing: Easing.out(Easing.cubic), useNativeDriver: false });
    animation.start(({ finished }) => { if (finished) setActionsMounted(false); });
    return () => animation.stop();
  }, [actionProgress, menu]);
  const shouldCaptureSwipe = (_: unknown, gesture: { readonly dx: number; readonly dy: number }) =>
    !!onComplete && Math.abs(gesture.dx) > 14 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.5;
  const swipe = PanResponder.create({
    onMoveShouldSetPanResponder: shouldCaptureSwipe,
    onMoveShouldSetPanResponderCapture: shouldCaptureSwipe,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => { suppressPress.current = true; swipeDx.current = 0; setDragX(0); },
    onPanResponderMove: (_, gesture) => { swipeDx.current = gesture.dx; setDragX(Math.max(-Dimensions.get("window").width, Math.min(0, gesture.dx))); },
    onPanResponderRelease: async (_, gesture) => {
      const dx = swipeDx.current || gesture.dx;
      if (dx < -120) {
        const saved = await onComplete?.();
        if (saved !== false) setSwipedAway(true);
      }
      swipeDx.current = 0;
      setDragX(0);
    },
    onPanResponderTerminate: () => { suppressPress.current = true; swipeDx.current = 0; setDragX(0); },
  });
  const complete = () => { setMenu(false); onComplete?.(); };
  const reopen = () => { setMenu(false); onSetCompleted?.(false); };
  return <View style={styles.wrapper}>
    <View style={styles.clip}>
      <View
        {...swipe.panHandlers}
        style={[styles.card, note && styles.note, onComplete && { transform: [{ translateX: swipedAway ? -Dimensions.get("window").width : dragX }] }]}
      >
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${kind} ${title}`} onPressIn={() => { suppressPress.current = false; }}
          onPress={() => { if (!suppressPress.current) onPress(); }}
          delayLongPress={500} onLongPress={() => { suppressPress.current = true; setMenu((value) => !value); }} style={styles.body}>
          <View style={styles.header}><ItemIcon note={note} />{badge ? <Text numberOfLines={1} style={[styles.badge, note && styles.review, mutedBadge && styles.mutedBadge]}>{badge}</Text> : null}</View>
          <Text numberOfLines={note ? 3 : 2} style={[styles.title, note && styles.preview, completed && styles.struck]}>{title}</Text>
          {metadata}
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Actions for ${kind} ${title}`} accessibilityState={{ expanded: menu }} onPress={() => setMenu((value) => !value)} style={styles.more}><Text style={styles.moreText}>⋯</Text></Pressable>
        {status}
        {actionsMounted ? <Animated.View
          accessibilityLabel={`${kind} actions`}
          accessibilityElementsHidden={false}
          importantForAccessibility="auto"
          pointerEvents={menu ? "auto" : "none"}
          style={[styles.actionReveal, {
            height: actionProgress.interpolate({ inputRange: [0, 1], outputRange: [0, 60] }),
            opacity: actionProgress,
            transform: [{ translateY: actionProgress.interpolate({ inputRange: [0, 1], outputRange: [-6, 0] }) }],
          }]}
        >
          <View style={styles.taskActions}>
            {kind === "Task" && onComplete ? <TaskMenuAction icon="✓" label="Complete" accessibilityLabel={`Mark complete ${title}`} accessibilityHint="Marks this Task complete" onPress={complete} /> : null}
            {kind === "Task" && onSetCompleted ? <TaskMenuAction icon="↶" label="Reopen" accessibilityLabel={`Mark incomplete ${title}`} accessibilityHint="Reopens this Task" onPress={reopen} /> : null}
            <TaskMenuAction icon="↗" label="View" accessibilityLabel={`View ${kind.toLowerCase()} ${title}`} accessibilityHint={`Opens ${kind.toLowerCase()} details`} onPress={() => { setMenu(false); onPress(); }} />
            {onEdit ? <TaskMenuAction icon="✎" label="Edit" accessibilityLabel={`Edit ${kind.toLowerCase()} ${title}`} accessibilityHint={`Opens ${kind.toLowerCase()} details in edit mode`} onPress={() => { setMenu(false); onEdit(); }} /> : null}
          </View>
        </Animated.View> : null}
      </View>
    </View>
  </View>;
}

function TaskMenuAction({ icon, label, accessibilityLabel, accessibilityHint, onPress }: {
  readonly icon: string;
  readonly label: string;
  readonly accessibilityLabel: string;
  readonly accessibilityHint: string;
  readonly onPress: () => void;
}) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} onPress={onPress} style={styles.taskAction}>
    <Text style={styles.taskActionIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">{icon}</Text>
    <Text numberOfLines={1} style={styles.taskActionLabel}>{label}</Text>
  </Pressable>;
}

/** Match the shell's existing View-based outline icons without a new dependency. */
function ItemIcon({ note }: { readonly note: boolean }) {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.icon, note && styles.noteIcon]}>{note ? <View style={styles.fold} /> : <View style={styles.clipboardTop} />}<View style={styles.iconLine} /><View style={styles.iconLine} /><View style={[styles.iconLine, styles.shortLine]} /></View>;
}

function Metadata({ space, tags }: { readonly space: string | undefined; readonly tags: readonly string[] }) {
  const [width, setWidth] = useState(0);
  // Tags have their own bounded row, independent of the Space path length.
  const first = tags[0];
  const showTag = !!first && width >= Math.min(first.length * 7 + 24, 106) + (tags.length > 1 ? 42 : 0);
  const remaining = tags.length - (showTag && first ? 1 : 0);
  return <View onLayout={(event) => setWidth(event.nativeEvent.layout.width)} style={styles.metadata}>
    <Text numberOfLines={1} style={styles.space}>{space ?? "No Space"}</Text>
    {tags.length > 0 ? <View style={styles.tagRow}>
      {showTag && first ? <Text numberOfLines={1} style={styles.tag}>{first}</Text> : null}
      {remaining > 0 ? <Text style={styles.tag} accessibilityLabel={`${remaining} more tags`}>+{remaining}</Text> : null}
    </View> : null}
  </View>;
}

function formatDue(value: string | undefined, timeZone: string, today: string): string {
  if (!value) return "No due date";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const dayKey = ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
  const day = dayKey === today ? "Today" : new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(date);
  return `${day} · ${new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(date)}`;
}

const styles = StyleSheet.create({
  wrapper: { marginHorizontal: tokens.spacing.lg, marginBottom: 12 },
  // The card must be allowed to leave this wrapper during a full-dismiss swipe.
  clip: { overflow: "visible", borderRadius: tokens.radius.card, backgroundColor: tokens.colors.green },
  card: { backgroundColor: tokens.colors.surface, borderColor: tokens.colors.border, borderRadius: tokens.radius.card, borderWidth: 1 },
  note: { backgroundColor: tokens.colors.lavender },
  body: { padding: 16 }, header: { flexDirection: "row", alignItems: "center", gap: 10, paddingRight: 34, minHeight: 28, marginBottom: 10 },
  badge: { flexShrink: 1, overflow: "hidden", borderRadius: 10, backgroundColor: "#E3EEDD", color: tokens.colors.green, paddingHorizontal: 10, paddingVertical: 5, fontSize: 13, fontWeight: "600" },
  review: { backgroundColor: tokens.colors.butter, color: tokens.colors.ink }, mutedBadge: { backgroundColor: "#EEF0F1", color: tokens.colors.muted },
  title: { color: tokens.colors.ink, fontSize: 18, fontWeight: "700", lineHeight: 24 }, preview: { fontWeight: "400" }, struck: { textDecorationLine: "line-through", color: tokens.colors.muted },
  metadata: { gap: 8, marginTop: 13 }, tagRow: { flexDirection: "row", alignItems: "center", gap: 8 }, space: { flexShrink: 1, color: tokens.colors.muted, fontSize: 13 }, meta: { color: tokens.colors.muted, fontSize: 13 },
  tag: { flexShrink: 0, maxWidth: 106, overflow: "hidden", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: "rgba(23,59,47,0.06)", color: tokens.colors.green, fontSize: 12 },
  more: { position: "absolute", top: 8, right: 6, width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 12 }, moreText: { color: tokens.colors.green, fontSize: 25, lineHeight: 30 },
  icon: { width: 19, height: 23, borderColor: tokens.colors.green, borderWidth: 1.7, borderRadius: 3, justifyContent: "center", paddingHorizontal: 3, gap: 3 }, noteIcon: { borderTopRightRadius: 7 },
  clipboardTop: { position: "absolute", top: -4, left: 4, width: 8, height: 5, backgroundColor: tokens.colors.surface, borderColor: tokens.colors.green, borderWidth: 1.5, borderRadius: 2 },
  fold: { position: "absolute", top: 0, right: 0, width: 6, height: 6, borderBottomWidth: 1.5, borderLeftWidth: 1.5, borderColor: tokens.colors.green },
  iconLine: { height: 1.5, backgroundColor: tokens.colors.green }, shortLine: { width: 6 },
  pending: { backgroundColor: tokens.colors.butter, color: "#71521C", padding: 12, fontSize: 12 },
  errorRow: { backgroundColor: "#FFF0EA", paddingLeft: 14, paddingRight: 6, flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }, error: { color: "#9B392B", fontSize: 12 }, retry: { minHeight: 44, paddingHorizontal: 8, justifyContent: "center" }, completedLabel: { paddingHorizontal: 16, paddingBottom: 12, color: tokens.colors.green, fontSize: 12 },
  actionReveal: { overflow: "hidden" }, taskActions: { alignItems: "stretch", backgroundColor: "#F5F5F1", borderTopColor: tokens.colors.border, borderTopWidth: 1, borderBottomLeftRadius: tokens.radius.card, borderBottomRightRadius: tokens.radius.card, flexDirection: "row", gap: 4, paddingHorizontal: 6, paddingVertical: 3 }, taskAction: { alignItems: "center", flex: 1, justifyContent: "center", minHeight: 54, minWidth: 0, paddingHorizontal: 2 }, taskActionIcon: { color: tokens.colors.green, fontSize: 18, fontWeight: "800", lineHeight: 22 }, taskActionLabel: { color: tokens.colors.ink, fontSize: 11, fontWeight: "700", marginTop: 2 },
});
