import Message from "./message";
import type { CleanMessage, Highlight } from "../../../types/types";

type MessageHistoryProps = {
  history: CleanMessage[];
  // highlights keyed by message id, so each Message renders its own marks
  highlightsByMessage?: Record<string, Highlight[]>;
};

const MessageHistory = ({
  history,
  highlightsByMessage,
}: MessageHistoryProps) => {
  return (
    <div className="flex flex-col gap-6">
      {history.map((el) => (
        <Message
          key={el.id}
          content={el.content}
          role={el.role}
          id={el.id}
          highlights={highlightsByMessage?.[el.id] ?? []}
        />
      ))}
    </div>
  );
};

export default MessageHistory;
