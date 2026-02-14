import { Button } from "@/components/ui/button";

import { Plus } from "lucide-react";
import { useNavigate } from "react-router";

const NewChat = () => {
  const navigate = useNavigate();

  const openHome = () => {
    console.log("click event working");
    navigate("/");
  };

  return (
    <Button variant="outline" onClick={() => openHome()}>
      new conversation
      <Plus />
    </Button>
  );
};

export default NewChat;
