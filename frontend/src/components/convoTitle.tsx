import { useLocation, useNavigate } from "react-router";
import { SidebarMenuButton, SidebarMenuItem } from "./ui/sidebar";

const ConvoTitle = ({ id, title }: { id: string; title: string }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = location.pathname === `/chat/${id}`;

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        isActive={isActive}
        onClick={() => navigate(`/chat/${id}`)}
        className="text-sm"
      >
        <span className="truncate">{title || "Untitled"}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
};

export default ConvoTitle;
