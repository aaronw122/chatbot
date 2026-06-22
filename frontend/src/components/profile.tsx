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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronsUpDown, LogOut, Settings as SettingsIcon } from "lucide-react";
import Settings from "./settings";
import { useSettings } from "@/context/settingsContext";

export const Profile = () => {
  const { isMobile } = useSidebar();
  const settings = useSettings();

  const { data: session, isPending } = authClient.useSession();
  let firstLetter = "";

  const navigate = useNavigate();

  if (isPending) {
    return (
      <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (session) {
    firstLetter = session.user.name.charAt(0).toUpperCase();
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
                <>
                  <Avatar className="size-8 rounded-full">
                    <AvatarFallback className="rounded-full bg-primary text-sm text-primary-foreground">
                      {firstLetter}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">
                      {session.user.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {session.user.email}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4 text-muted-foreground" />
                </>
              ) : (
                <div />
              )}
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg shadow-md"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuItem onClick={() => settings?.openSettings()}>
              <SettingsIcon className="size-4" />
              Settings
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => logOut()}>
              <LogOut className="size-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
      <Settings />
    </SidebarMenu>
  );
};
