import { useEffect } from "react";
import { authClient } from "@/lib/auth-client";
import { type Conversation } from "../../../types/types";
import services from "../services/index";
import ConvoTitle from "./convoTitle";
import NewChat from "./newChat";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarMenu,
} from "./ui/sidebar";

import { useConvo } from "@/context/convoContext";
import { Profile } from "./profile";

const ConvoList = () => {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  const { convos, setConvos } = convo;

  const { data: session } = authClient.useSession();

  useEffect(() => {
    if (session) {
      services.getConversations().then((r) => setConvos(r));
    }
  }, [session, setConvos]);

  return (
    <Sidebar collapsible="offcanvas">
      <SidebarHeader className="gap-3 px-3 pt-3">
        <div className="flex items-center gap-2 px-1">
          <img src="/logo.png" alt="" className="size-6 w-auto shrink-0" />
          <h1 className="text-base font-bold tracking-tight text-primary group-data-[collapsible=icon]:hidden">
            easybranch
          </h1>
        </div>
        <NewChat />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          {convos === null ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              Loading…
            </p>
          ) : convos.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
              No conversations yet.
            </p>
          ) : (
            <SidebarMenu>
              {convos.map((el: Conversation) => (
                <ConvoTitle key={el.id} title={el.title} id={el.id} />
              ))}
            </SidebarMenu>
          )}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Profile />
      </SidebarFooter>
    </Sidebar>
  );
};

export default ConvoList;
