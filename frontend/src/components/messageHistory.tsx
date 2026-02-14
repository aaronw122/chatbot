import Message from "./message";
import type { CleanMessage } from "../../../types/types";

type MessageHistoryProps = {
  history: CleanMessage[];
};

const MessageHistory = ({ history }: MessageHistoryProps) => {
  console.log("history from MessageHistory", history);

  return (
    <div className="flex flex-col pb-15">
      {history.map((el) => (
        <Message key={el.id} content={el.content} role={el.role} id={el.id} />
      ))}
    </div>
  );
};

export default MessageHistory;
