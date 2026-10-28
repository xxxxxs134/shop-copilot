import { ChatWindow } from '@/components/ChatWindow';

export default function ChatPage() {
  return (
    <main className="flex h-[calc(100vh-3.5rem)] flex-col overflow-hidden md:h-screen">
      <ChatWindow />
    </main>
  );
}
