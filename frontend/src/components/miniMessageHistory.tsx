import MiniMessage from "./miniMessage";
import type { CleanMessage } from "../../../types/types";
import { useConvo } from "@/context/convoContext";

type MessageHistoryProps = {
  history: CleanMessage[];
};

const MessageHistory = () => {
  const convo = useConvo();

  if (!convo) return null;

  const { miniChatHistory } = convo;

  console.log("history from MessageHistory", history);

  return (
    <div className="flex flex-col pb-15">
      {miniChatHistory.map((el) => (
        <MiniMessage
          key={el.id}
          content={el.content}
          role={el.role}
          id={el.id}
        />
      ))}
    </div>
  );
};

export default MessageHistory;
