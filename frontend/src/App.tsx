import HomeInput from "./components/homeInput";
import { useConvo } from "./context/convoContext";
import { authClient } from "@/lib/auth-client";
import SignIn from "./pages/signIn";

function App() {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <p>Loading...</p>;

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-1">
        <h1 className="text-center text-6xl font-bold text-primary">forklet</h1>
        <h5 className="text-center text-muted-foreground">
          grow your curiosity.
        </h5>
      </div>
      <div className="w-full">{session ? <HomeInput /> : <SignIn />}</div>
    </div>
  );
}

export default App;
