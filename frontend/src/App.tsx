import HomeInput from "./components/homeInput";
import { useConvo } from "./context/convoContext";

function App() {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  return (
    <div className="flex flex-col justify-center h-full flex-1 lg:mx-50 md:mx-20 sm:mx-15 gap-1">
      <h1 className="text-center text-6xl font-bold">forklet</h1>
      <h5 className="text-center pb-5">grow your curiosity.</h5>
      <HomeInput />
    </div>
  );
}

export default App;
