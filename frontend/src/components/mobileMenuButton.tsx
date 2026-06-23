import { Menu } from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";

// Mobile-only hamburger that opens the conversation drawer. On mobile the
// shadcn Sidebar renders as an off-canvas Sheet; this button opens it so the
// user can reach their conversation list, "New chat", and account. Hidden on
// desktop (md:hidden) where the sidebar is persistent.
export function MobileMenuButton() {
  const { setOpenMobile } = useSidebar();
  return (
    <button
      type="button"
      aria-label="Open menu"
      onClick={() => setOpenMobile(true)}
      className="md:hidden -ml-1 rounded-md p-2 text-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <Menu className="size-5" />
    </button>
  );
}

export default MobileMenuButton;
