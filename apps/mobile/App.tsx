import { MemberListScreen } from "./src/list/MemberListScreen";

export default function App() {
  return <MemberListScreen apiBaseUrl={process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:3000"} memberId={process.env.EXPO_PUBLIC_MEMBER_ID ?? "member-1"} />;
}
