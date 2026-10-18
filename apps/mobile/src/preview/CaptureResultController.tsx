import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { createMemberItemsClient, type MemberItemsClient } from "../list/member-items";
import { createSpacesClient } from "../spaces/spaces";
import { CaptureResultPreview } from "./CaptureResultPreview";
import { beginPreview, expirePreview, openPreviewReview, resolvePreview, savePreview, timeOutPreview, type PreviewItem, type PreviewState } from "./result-preview";

interface CaptureResultControllerValue {
  readonly preview: PreviewState | null;
  readonly reviewUrl: string | null;
  readonly itemsRevision: number;
  readonly setCapturePanel: (panel: ReactNode | null) => void;
  readonly prepareForCapture: () => void;
  readonly begin: (captureId: string, selectedSpaceId: string | null) => void;
  readonly save: () => void;
  readonly openResult: (item: PreviewItem) => void;
  readonly openCaptureReview: (detailUrl: string) => void;
  readonly closeReview: () => void;
}

const CaptureResultContext = createContext<CaptureResultControllerValue | null>(null);

export function useCaptureResultController(): CaptureResultControllerValue {
  const value = useContext(CaptureResultContext);
  if (!value) throw new Error("CaptureResultProvider is required");
  return value;
}

export function CaptureResultProvider({ apiBaseUrl, memberId, timeZone, client: providedClient, children }: {
  readonly apiBaseUrl: string;
  readonly memberId: string;
  readonly timeZone: string;
  readonly client?: MemberItemsClient;
  readonly children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const itemsClient = useMemo(() => providedClient ?? createMemberItemsClient(apiBaseUrl), [apiBaseUrl, providedClient]);
  const spacesClient = useMemo(() => createSpacesClient(apiBaseUrl), [apiBaseUrl]);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [reviewUrl, setReviewUrl] = useState<string | null>(null);
  const [capturePanel, setCapturePanel] = useState<ReactNode | null>(null);
  const [itemsRevision, setItemsRevision] = useState(0);
  const selectedSpaceByCapture = useRef(new Map<string, string | null>());
  const assignedCaptures = useRef(new Set<string>());

  const begin = useCallback((captureId: string, selectedSpaceId: string | null) => {
    selectedSpaceByCapture.current.set(captureId, selectedSpaceId);
    setPreview(beginPreview(captureId));
    setReviewUrl(null);
  }, []);
  const prepareForCapture = useCallback(() => {
    setPreview(null);
    setReviewUrl(null);
  }, []);
  const save = useCallback(() => setPreview((current) => current ? savePreview(current) : current), []);
  const openResult = useCallback((item: PreviewItem) => {
    setPreview((current) => current ? openPreviewReview(current) : current);
    setReviewUrl(item.detailUrl);
  }, []);
  const openCaptureReview = useCallback((detailUrl: string) => setReviewUrl(detailUrl), []);
  const closeReview = useCallback(() => { setReviewUrl(null); setItemsRevision((revision) => revision + 1); }, []);

  useEffect(() => {
    if (!preview || preview.status !== "processing") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const page = await itemsClient.list(memberId);
        if (cancelled) return;
        const next = resolvePreview(preview, page.items, Date.now());
        setPreview((current) => current?.status === "processing" ? resolvePreview(current, page.items, Date.now()) : current);
        if (next.status === "preview") {
          const spaceId = selectedSpaceByCapture.current.get(next.item.captureId);
          if (spaceId && !assignedCaptures.current.has(next.item.captureId)) {
            assignedCaptures.current.add(next.item.captureId);
            void spacesClient.assign(next.item.id, next.item.kind, memberId, spaceId).then(() => setItemsRevision((revision) => revision + 1)).catch(() => assignedCaptures.current.delete(next.item.captureId));
          }
        }
      } catch {
        // Keep the processing state until a later poll confirms the durable result.
      }
      if (!cancelled) timer = globalThis.setTimeout(() => void poll(), 1000);
    };
    void poll();
    return () => { cancelled = true; if (timer !== undefined) globalThis.clearTimeout(timer); };
  }, [itemsClient, memberId, preview, spacesClient]);

  useEffect(() => {
    if (!preview || preview.status !== "preview") return;
    const timer = globalThis.setTimeout(() => setPreview((current) => current ? expirePreview(current, Date.now()) : current), Math.max(0, preview.expiresAt - Date.now()));
    return () => globalThis.clearTimeout(timer);
  }, [preview]);

  useEffect(() => {
    if (!preview || preview.status !== "processing") return;
    const timer = globalThis.setTimeout(() => setPreview((current) => current ? timeOutPreview(current, Date.now()) : current), Math.max(0, preview.startedAt + 30_000 - Date.now()));
    return () => globalThis.clearTimeout(timer);
  }, [preview]);

  const value = useMemo(() => ({ preview, reviewUrl, itemsRevision, setCapturePanel, prepareForCapture, begin, save, openResult, openCaptureReview, closeReview }), [begin, closeReview, itemsRevision, openCaptureReview, openResult, prepareForCapture, preview, reviewUrl, save]);
  const visiblePreview = preview?.status === "saved" ? null : preview;
  const drawerContent = capturePanel ?? (visiblePreview ? <CaptureResultPreview state={visiblePreview} apiBaseUrl={apiBaseUrl} memberId={memberId} timeZone={timeZone} onSave={save} onOpenReview={openCaptureReview} onOpenResultReview={openResult} /> : null);
  return <CaptureResultContext.Provider value={value}>
    <View style={styles.host}>
      {children}
      {!reviewUrl && drawerContent ? <View pointerEvents="box-none" style={[styles.layer, { bottom: 68 + insets.bottom }]}>
        <View accessibilityLabel={capturePanel ? "Voice Capture drawer" : "Capture result drawer"} style={styles.drawer}>
          <View style={styles.handle} />
          {drawerContent}
        </View>
      </View> : null}
    </View>
  </CaptureResultContext.Provider>;
}

const styles = StyleSheet.create({
  host: { flex: 1 },
  layer: { left: 0, position: "absolute", right: 0, zIndex: 10, elevation: 10 },
  drawer: { backgroundColor: "#F7F5F0", borderTopLeftRadius: 25, borderTopRightRadius: 25, paddingTop: 8 },
  handle: { alignSelf: "center", backgroundColor: "#D7D4CE", borderRadius: 3, height: 4, marginBottom: 7, width: 38 },
});
