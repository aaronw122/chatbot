import { useContext, createContext, useState } from "react";
import { type CleanMessage, type miniContext } from "../../../types/types";

const MiniContext = createContext<miniContext | null>(null);

export const useMini = () => {
  return useContext(MiniContext);
};

export const MiniProvider = ({ children }: { children: React.ReactNode }) => {
  const [miniMessage, setMiniMessage] = useState<null | string>(null);
  const [miniChatHistory, setMiniChatHistory] = useState<null | CleanMessage[]>(
    null,
  );
  const [miniOpen, setMiniOpen] = useState<true | false>(false);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [miniConvoId, setMiniConvoId] = useState<string | null>(null);
  // pending highlight anchor (set by the reply button, consumed on first send)
  const [sourceMessageId, setSourceMessageId] = useState<string | null>(null);
  const [highlightRange, setHighlightRange] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const [quote, setQuote] = useState<string | null>(null);
  // Anchor offset for the floating desktop branch panel (see miniContext type).
  const [anchorTop, setAnchorTop] = useState<number | null>(null);
  const [highlightRevision, setHighlightRevision] = useState(0);
  const notifyHighlightCreated = () => {
    setHighlightRevision((revision) => revision + 1);
  };

  return (
    <MiniContext.Provider
      value={{
        miniMessage,
        setMiniMessage,
        miniChatHistory,
        setMiniChatHistory,
        miniOpen,
        setMiniOpen,
        selectedText,
        setSelectedText,
        miniConvoId,
        setMiniConvoId,
        sourceMessageId,
        setSourceMessageId,
        highlightRange,
        setHighlightRange,
        quote,
        setQuote,
        anchorTop,
        setAnchorTop,
        highlightRevision,
        notifyHighlightCreated,
      }}
    >
      {children}
    </MiniContext.Provider>
  );
};
