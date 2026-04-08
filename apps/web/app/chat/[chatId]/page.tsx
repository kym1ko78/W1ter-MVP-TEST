"use client";

import { useParams } from "next/navigation";
import { ConversationView } from "../../../components/conversation-view";

export default function ChatDetailsPage() {
  const params = useParams<{ chatId: string }>();
  return <ConversationView chatId={params.chatId} />;
}
