import Anthropic from "@anthropic-ai/sdk";
import Chat from "./chat";

type chatsTypes = {
  history: (Anthropic.MessageParam & { id: string })[];
};

const Chats = ({ history }: chatsTypes) => {
  return (
    <div>
      {history.map((el) => (
        <Chat key={el.id} message={el} />
      ))}
    </div>
  );
};

export default Chats;
