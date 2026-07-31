import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installTauriBridgeApi } from "./tauriBridge";
import "./styles.css";

installTauriBridgeApi();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
