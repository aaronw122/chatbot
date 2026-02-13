import ConvoList from "./components/convoList";
import HomeInput from "./components/homeInput";
import { useConvo } from "./context/convoContext";

function App() {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  return (
    <div className="flex flex-row mx-10 my-5 h-screen">
      <ConvoList />
      <div className="flex-1 h-full">
        <div className="flex flex-col justify-center h-full lg:mx-80 md:mx-20 sm:mx-15 my-5 gap-1">
          <h1 className="text-center">
            {"  "}
            bubble{" "}
          </h1>
          <HomeInput />
        </div>
      </div>
    </div>
  );
}

export default App;
