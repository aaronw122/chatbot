import Message from "./message";
import type { CleanMessage } from "../../../types/types";

type MessageHistoryProps = {
  history: CleanMessage[];
};

const MessageHistory = ({ history }: MessageHistoryProps) => {
  return (
    <div className="flex flex-col gap-6">
      {history.map((el) => (
        <Message key={el.id} content={el.content} role={el.role} id={el.id} />
      ))}
    </div>
  );
};

export default MessageHistory;
