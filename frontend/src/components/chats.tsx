import Anthropic from "@anthropic-ai/sdk";
import Chat from "./chat";
import type { CleanMessage } from "../../../types/types";

type chatsTypes = {
  history: CleanMessage[];
};

const Chats = ({ history }: chatsTypes) => {
  console.log("history", history);

  return (
    <div className="flex flex-col">
      {history.map((el) => (
        <Chat key={el.id} content={el.content} role={el.role} />
      ))}
    </div>
  );
};

export default Chats;
