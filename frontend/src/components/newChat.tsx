import { SquarePen } from "lucide-react";
import { useNavigate } from "react-router";

const NewChat = () => {
  const navigate = useNavigate();

  const openHome = () => {
    navigate("/");
  };

  return (
    <button
      type="button"
      onClick={openHome}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <SquarePen className="size-4" />
      <span className="group-data-[collapsible=icon]:hidden">New chat</span>
    </button>
  );
};

export default NewChat;
