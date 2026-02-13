import { Button } from "@/components/ui/button";

import { Pencil } from "lucide-react";

type NewChatProps = {
  newChat: () => void;
};

const NewChat = ({ newChat }: NewChatProps) => {
  return (
    <Button className="ml-auto" variant="outline" onClick={() => newChat()}>
      <Pencil />
    </Button>
  );
};

export default NewChat;
