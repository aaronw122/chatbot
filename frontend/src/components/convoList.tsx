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
      services
        .getConversations()
        .then((conversations) => setConvos(conversations));
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
          {renderConversationListContent(convos)}
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <Profile />
      </SidebarFooter>
    </Sidebar>
  );
};

const renderConversationListContent = (conversations: Conversation[] | null) => {
  if (conversations === null) {
    return (
      <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading…</p>
    );
  }

  if (conversations.length === 0) {
    return (
      <p className="px-2 py-1.5 text-sm text-muted-foreground group-data-[collapsible=icon]:hidden">
        No conversations yet.
      </p>
    );
  }

  return (
    <SidebarMenu>
      {conversations.map((conversation) => (
        <ConvoTitle
          key={conversation.id}
          title={conversation.title}
          id={conversation.id}
        />
      ))}
    </SidebarMenu>
  );
};

export default ConvoList;
