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
    <div className="flex h-full w-full flex-col items-center justify-start gap-6 pt-[20vh]">
      <div className="flex flex-col items-center gap-1">
        <img src="/logo.png" alt="easybranch logo" className="h-24 w-auto" />
        <h1 className="text-center text-6xl font-medium text-primary">easybranch</h1>
        <h5 className="text-center text-muted-foreground">
          forking made easy
        </h5>
      </div>
      <div className="w-full">{session ? <HomeInput /> : <SignIn />}</div>
    </div>
  );
}

export default App;
