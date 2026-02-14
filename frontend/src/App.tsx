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
    <div className="flex flex-col justify-center h-full flex-1 lg:mx-50 md:mx-20 sm:mx-15 gap-1 pb-40">
      {session ? (
        <div className="flex flex-col items-center w-full">
          <h1 className="text-center text-6xl font-bold">forklet</h1>
          <h5 className="text-center pb-5">grow your curiosity.</h5>
          <HomeInput />
        </div>
      ) : (
        <div className="flex flex-col items-center w-full">
          <h1 className="text-center text-6xl font-bold">easy branch</h1>
          <h5 className="text-center pb-5">grow your curiosity.</h5>
          <SignIn />
        </div>
      )}
    </div>
  );
}

export default App;
