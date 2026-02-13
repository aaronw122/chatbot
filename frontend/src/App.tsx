import ConvoList from "./components/convoList";
import HomeInput from "./components/homeInput";
import { useConvo } from "./context/convoContext";

function App() {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  return (
    <div className="flex flex-col justify-center h-full flex-1 lg:mx-40 md:mx-20 sm:mx-15 my-5 gap-1">
      <h1 className="text-center">
        {"  "}
        bubble{" "}
      </h1>
      <h5 className="text-center pb-5">expand your curiosity.</h5>
      <HomeInput />
    </div>
  );
}

export default App;
