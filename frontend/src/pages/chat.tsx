import { useEffect } from "react";
import MessageHistory from "../components/messageHistory";
import Input from "../components/input";
import MiniWindow from "../components/miniWindow";
import { useParams } from "react-router";
import { useConvo } from "@/context/convoContext";

import services from "../services/index";
import { useMessage } from "@/context/messageContext";

const Session = () => {
  const convo = useConvo();
  const message = useMessage();

  if (!convo) throw new Error("useConvo not working");
  if (!message) throw new Error("useMessage not working");
  //pull id from react router link when clicked

  const { id } = useParams();

  const { setChatHistory, chatHistory } = convo;

  const { handleMsgChange, sendMessage, newMessage, setOptimisticMsg } =
    message;

  //on initial render, we getMessageHistory
  useEffect(() => {
    setOptimisticMsg(null);
    services.getMessages(id!).then((r) => setChatHistory(r));
  }, []);

  //then, on subsequent chat messages, we update

  //will have new deps in future,
  return (
    <div>
      {chatHistory ? (
        <div className="flex flex-col h-full pb-5 mx-auto w-full max-w-3xl px-4">
          <div className="flex-1 overflow-y-auto my-15">
            <MessageHistory history={chatHistory} />
          </div>
          <Input
            sendMessage={sendMessage}
            newMessage={newMessage}
            handleMsgChange={handleMsgChange}
            id={id!}
          />
          <MiniWindow />
        </div>
      ) : (
        <p> loading </p>
      )}
    </div>
  );
};

export default Session;
