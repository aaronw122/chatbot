import { useEffect, useRef } from "react";
import HomeInput from "./components/homeInput";
import { useConvo } from "./context/convoContext";
import { authClient } from "@/lib/auth-client";

function App() {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  const { data: session, isPending } = authClient.useSession();

  // Anonymous-first bootstrap. There is no login wall anymore: a visitor with no
  // session is silently signed in as an anonymous user so they can chat right
  // away. `signIn.anonymous()` is fired exactly once (the ref guards against the
  // double-invoke that StrictMode / re-renders would otherwise cause).
  const mintingRef = useRef(false);
  useEffect(() => {
    if (isPending) return;
    if (session) return;
    if (mintingRef.current) return;
    mintingRef.current = true;
    void authClient.signIn.anonymous().catch(() => {
      // Allow a retry on the next render if minting failed (e.g. transient
      // network error) instead of locking the visitor out forever.
      mintingRef.current = false;
    });
  }, [isPending, session]);

  // While the session is resolving or the anonymous session is being minted,
  // show a lightweight loading state rather than the (now removed) login wall.
  if (isPending || !session) return <p>Loading...</p>;

  return (
    <div className="flex h-full w-full flex-col items-center justify-start gap-6 pt-[20vh]">
      <div className="flex flex-col items-center gap-1">
        <img src="/logo.png" alt="easybranch logo" className="h-24 w-auto" />
        <h1 className="text-center text-6xl font-medium text-primary">easybranch</h1>
        <h5 className="text-center text-muted-foreground">
          forking made easy
        </h5>
      </div>
      <div className="w-full">
        <HomeInput />
      </div>
    </div>
  );
}

export default App;
