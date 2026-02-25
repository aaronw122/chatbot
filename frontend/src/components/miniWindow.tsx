import { useEffect } from "react";
import MiniMessageHistory from "./miniChats";
import MiniInput from "./miniInput";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { useMini } from "@/context/miniContext";

const MiniWindow = () => {
  const mini = useMini();

  if (!mini) return null;

  const {
    miniOpen,
    setMiniOpen,
    miniChatHistory,
    setMiniChatHistory,
    selectedText,
    setSelectedText,
    setMiniConvoId,
    setMiniMessage,
  } = mini;

  useEffect(() => {
    setMiniChatHistory(null);
  }, []);

  const handleClose = () => {
    setMiniOpen(false);
    setMiniChatHistory(null);
    setSelectedText(null);
    setMiniConvoId(null);
    setMiniMessage(null);
    //later also add operation to delete from db
  };

  if (!miniOpen) return null;

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[500px] bg-background border rounded-xl shadow-lg flex flex-col z-50">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <span className="text-sm font-medium">Branch</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={handleClose}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {selectedText && (
        <div className="px-4 py-2 border-b bg-muted/50">
          <p className="text-xs text-muted-foreground italic truncate">
            "{selectedText}"
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-2">
        {miniChatHistory && <MiniMessageHistory history={miniChatHistory} />}
      </div>

      <div className="px-4 py-2 border-t">
        <MiniInput />
      </div>
    </div>
  );
};

export default MiniWindow;
