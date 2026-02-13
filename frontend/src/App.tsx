import ConvoList from "./components/convoList";
import Session from "./components/session";
import HomeInput from "./components/homeInput";
import { useConvo } from "./context/convoContext";

function App() {
  const convo = useConvo();

  if (!convo) throw new Error("useConvo not working");

  const { currentView } = convo;

  return (
    <div className="flex flex-row mx-10 my-5 h-screen">
      <ConvoList />
      <div className="flex-1 h-full">
        {currentView === "newChat" ? (
          <div className="flex flex-col justify-center h-full lg:mx-80 md:mx-20 sm:mx-15 my-5 gap-1">
            <h1 className="text-center">
              {"  "}
              bubble{" "}
            </h1>
            <HomeInput />
          </div>
        ) : (
          <div className="mx-10 h-full">
            <Session />
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
