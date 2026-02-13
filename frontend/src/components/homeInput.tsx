import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";
import { useConvo } from "@/context/convoContext";

const HomeInput = () => {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  const { createConversation, newMessage, handleMsgChange } = convo;

  return (
    <div className="flex items-center gap-2">
      <Textarea
        placeholder="ask away"
        className="min-h-0 rounded-lg resize-none border-2 shadow-none focus-visible:ring-1"
        value={newMessage}
        onChange={handleMsgChange}
      >
        {" "}
      </Textarea>
      <Button className="rounded-lg" onClick={() => createConversation()}>
        <Send />
      </Button>
    </div>
  );
};

export default HomeInput;
