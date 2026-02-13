import { Button } from "@/components/ui/button";

import { Pencil } from "lucide-react";
import { useNavigate } from "react-router";

const NewChat = () => {
  const navigate = useNavigate();

  const openHome = () => {
    navigate("/");
  };

  return (
    <Button className="ml-auto" variant="outline" onClick={() => openHome()}>
      <Pencil />
    </Button>
  );
};

export default NewChat;
