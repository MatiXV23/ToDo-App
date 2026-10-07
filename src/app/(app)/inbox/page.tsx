import type { Metadata } from "next";
import { InboxList } from "@/components/inbox/inbox-list";

export const metadata: Metadata = { title: "Buzón" };

export default function InboxPage() {
  return <InboxList />;
}
