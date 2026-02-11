import { useState, useEffect, useRef, useCallback } from "react";

import Session from "./components/session";

function App() {
  //websocket wikll automatically send back new message, update all messages

  return (
    <div className="lg:mx-80 md:mx-20 sm: mx-15 my-5">
      <h1 className="flex items-center justify-center min-h-screen">
        {" "}
        threader{" "}
      </h1>
      <Session />
    </div>
  );
}

export default App;
