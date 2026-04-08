"use client";

import { useParams } from "next/navigation";
import { ConversationView } from "../../../components/conversation-view";

export default function ChatDetailsPage() {
  const params = useParams<{ chatId: string }>();
  const chatId = params?.chatId;

  if (!chatId) {
    return null;
  }

  return <ConversationView chatId={chatId} />;
}
