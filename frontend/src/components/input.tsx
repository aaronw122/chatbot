import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

type inputType = {
  sendMessage: () => void;
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  newMessage: string;
};

const Input = ({ sendMessage, newMessage, handleMsgChange }: inputType) => {
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
      <Button className="rounded-lg" onClick={() => sendMessage()}>
        <Send />
      </Button>
    </div>
  );
};

export default Input;
