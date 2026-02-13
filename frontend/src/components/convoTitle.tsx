import { Button } from "./ui/button";
import { useNavigate } from "react-router";

const ConvoTitle = ({ id, title }: { id: string; title: string }) => {
  const navigate = useNavigate();
  return (
    <Button
      variant="ghost"
      className="pl-0"
      onClick={() => navigate(`/chat/${id}`)}
    >
      {" "}
      {title}{" "}
    </Button>
  );
};

export default ConvoTitle;
