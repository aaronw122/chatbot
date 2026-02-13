import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

type HomeInputProps = {
  createConversation: () => void;
  handleMsgChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => void;
  newMessage: string;
};

const HomeInput = ({
  createConversation,
  newMessage,
  handleMsgChange,
}: HomeInputProps) => {
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
