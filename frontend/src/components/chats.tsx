import Chat from "./chat";
import type { CleanMessage } from "../../../types/types";

type ChatsProps = {
  history: CleanMessage[];
};

const Chats = ({ history }: ChatsProps) => {
  console.log("history from chats", history);

  return (
    <div className="flex flex-col pb-15">
      {history.map((el) => (
        <Chat key={el.id} content={el.content} role={el.role} id={el.id} />
      ))}
    </div>
  );
};

export default Chats;
