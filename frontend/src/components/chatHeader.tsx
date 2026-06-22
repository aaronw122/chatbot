// PLACEHOLDER — owned by the header agent (B4).
// The real chatHeader.tsx (provider + model switcher) is being built in parallel
// and will replace this file at integration. This minimal stub exists ONLY so the
// chat column (B2) builds and mounts <ChatHeader /> with the correct contract:
// a default-exported, no-props component rendering a slim top bar per DESIGN.md (§3).
const ChatHeader = () => {
  return (
    <header className="flex h-14 items-center border-b border-border bg-background" />
  );
};

export default ChatHeader;
