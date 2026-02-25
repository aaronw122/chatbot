import MiniMessage from "./miniMessage";
import type { CleanMessage } from "../../../types/types";
import { useMini } from "@/context/miniContext";

const MessageHistory = () => {
  const mini = useMini();

  if (!mini) return null;

  const { miniChatHistory } = mini;

  if (!miniChatHistory) return null;

  return (
    <div className="flex flex-col pb-15">
      {miniChatHistory.map((el: CleanMessage) => (
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
