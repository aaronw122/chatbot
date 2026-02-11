import { Button } from "@/components/ui/button";

import { Pencil } from "lucide-react";

type newChatType = {
  newChat: () => void;
};

const NewChat = ({ newChat }: newChatType) => {
  return (
    <Button className="ml-auto" variant="outline" onClick={() => newChat()}>
      <Pencil />
    </Button>
  );
};

export default NewChat;
