import { authClient } from "@/lib/auth-client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useNavigate } from "react-router";
import {
  useSidebar,
  SidebarMenuItem,
  SidebarMenu,
  SidebarMenuButton,
} from "./ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown } from "lucide-react";

export const Profile = () => {
  const { isMobile } = useSidebar();

  const { data: session, isPending } = authClient.useSession();
  let firstLetter = "";

  const navigate = useNavigate();

  if (isPending) return <p>Loading...</p>;
  if (session) {
    const name = session.user.name;

    console.log("name", name);

    firstLetter = name.charAt(0).toUpperCase();

    console.log("first letter", firstLetter);
  }

  const logOut = async () => {
    await authClient.signOut();
    navigate("/");
  };

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {session ? (
                <div className="flex flex-row items-center">
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarFallback className="rounded-lg">
                      {firstLetter}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight ml-2 justify-center items-center">
                    <span className="truncate font-medium">
                      {session.user.name}
                    </span>
                    <span className="truncate text-xs">
                      {session.user.email}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-3 size-4" />
                </div>
              ) : (
                <div />
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logOut()}>
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
};
